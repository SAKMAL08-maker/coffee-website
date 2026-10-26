const { getAdminClient, createServerAuthClient } = require("../config/supabase");

function isInvalidPasswordError(error) {
    return ["invalid_credentials", "email_not_confirmed", "user_not_found"].includes(error.code);
}

async function startAdminLogin(username, password) {
    const { data: account, error: accountError } = await getAdminClient()
        .from("coffee_users")
        .select("id, username, role, supabase_auth_user_id")
        .eq("username_key", username.trim().toLowerCase())
        .maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.role !== "admin" || !account.supabase_auth_user_id) return null;

    const { data: authUserResult, error: authUserError } = await getAdminClient()
        .auth.admin.getUserById(account.supabase_auth_user_id);
    if (authUserError) throw authUserError;
    if (!authUserResult.user?.email || !authUserResult.user.email_confirmed_at) return null;

    const authClient = createServerAuthClient();
    const { data: loginData, error: loginError } = await authClient.auth.signInWithPassword({
        email: authUserResult.user.email,
        password
    });
    if (loginError) {
        if (isInvalidPasswordError(loginError)) return null;
        throw loginError;
    }
    if (!loginData.session || loginData.user?.id !== account.supabase_auth_user_id) return null;

    const { data: factors, error: factorsError } = await authClient.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verifiedFactor = factors.totp.find((factor) => factor.status === "verified");
    return {
        session: loginData.session,
        username: account.username,
        setupRequired: !verifiedFactor,
        factorId: verifiedFactor?.id || null
    };
}

async function createMfaSession(accessToken, refreshToken) {
    if (!accessToken || !refreshToken) {
        throw Object.assign(new Error("Administrator MFA session is missing or expired."), { statusCode: 401 });
    }
    const authClient = createServerAuthClient();
    const { data, error } = await authClient.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
    });
    if (error) {
        if ([400, 401].includes(error.status)) {
            throw Object.assign(new Error("Administrator MFA session expired. Sign in again."), { statusCode: 401 });
        }
        throw error;
    }
    if (!data.session) {
        throw Object.assign(new Error("Administrator MFA session expired. Sign in again."), { statusCode: 401 });
    }
    return { authClient, session: data.session };
}

async function enrollAdminTotp(accessToken, refreshToken) {
    const { authClient } = await createMfaSession(accessToken, refreshToken);
    const { data, error } = await authClient.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Coffee Lab administrator"
    });
    if (error) throw error;
    return {
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret
    };
}

async function verifyAdminTotp(accessToken, refreshToken, factorId, code) {
    const { authClient } = await createMfaSession(accessToken, refreshToken);
    const { data: factorData, error: factorError } = await authClient.auth.mfa.listFactors();
    if (factorError) throw factorError;
    const factor = factorData.all.find((candidate) =>
        candidate.id === factorId
        && candidate.factor_type === "totp"
        && ["verified", "unverified"].includes(candidate.status)
    );
    if (!factor) {
        throw Object.assign(new Error("The authenticator factor is invalid. Start sign-in again."), { statusCode: 400 });
    }

    const { data: challenge, error: challengeError } = await authClient.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;
    if (!challenge?.id) throw new Error("Supabase did not create an authenticator challenge.");
    const { data: verified, error: verifyError } = await authClient.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code
    });
    if (verifyError) {
        if (["mfa_verification_failed", "bad_code"].includes(verifyError.code)) {
            return { valid: false };
        }
        throw verifyError;
    }
    if (!verified?.access_token || !verified.refresh_token) {
        throw new Error("Supabase did not issue a verified administrator session.");
    }
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(verified.access_token);
    if (claimsError) throw claimsError;
    if (claimsData?.claims?.aal !== "aal2") {
        throw new Error("Supabase did not issue a multi-factor administrator session.");
    }

    const { data: account, error: accountError } = await getAdminClient()
        .from("coffee_users")
        .select("id, username, role, created_at")
        .eq("supabase_auth_user_id", claimsData.claims.sub)
        .maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.role !== "admin") {
        throw Object.assign(new Error("Administrator access is not permitted."), { statusCode: 403 });
    }
    return { valid: true, session: verified, user: account };
}

module.exports = {
    startAdminLogin,
    createMfaSession,
    enrollAdminTotp,
    verifyAdminTotp
};
