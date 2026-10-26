const { getAdminClient, createServerAuthClient } = require("../config/supabase");
const { createHash, timingSafeEqual } = require("node:crypto");

function hashSetupToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

function hasValidSetupToken(account, token, now = Date.now()) {
    if (!account.admin_mfa_setup_token_hash
        || !account.admin_mfa_setup_token_expires_at
        || !/^[a-f0-9]{64}$/i.test(account.admin_mfa_setup_token_hash)
        || !token) return false;
    const expiresAt = Date.parse(account.admin_mfa_setup_token_expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
    const actualHash = Buffer.from(hashSetupToken(token), "hex");
    const expectedHash = Buffer.from(account.admin_mfa_setup_token_hash, "hex");
    return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

function hasActiveSetupAuthorization(account, now = Date.now()) {
    const expiresAt = Date.parse(account.admin_mfa_setup_token_expires_at);
    return Boolean(account.admin_mfa_setup_token_hash)
        && Number.isFinite(expiresAt)
        && expiresAt > now;
}

function isOnlyTrustedFactor(factors, factorId, status = "verified") {
    return factors.length === 1
        && factors[0].id === factorId
        && factors[0].factor_type === "totp"
        && factors[0].status === status;
}

function isInvalidPasswordError(error) {
    return ["invalid_credentials", "email_not_confirmed", "user_not_found"].includes(error.code);
}

async function startAdminLogin(username, password) {
    const { data: account, error: accountError } = await getAdminClient()
        .from("coffee_users")
        .select("id, username, role, supabase_auth_user_id, admin_mfa_factor_id, admin_mfa_pending_factor_id, admin_mfa_setup_token_hash, admin_mfa_setup_token_expires_at")
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
    const accountFactors = factors.all;
    if (account.admin_mfa_factor_id) {
        if (!isOnlyTrustedFactor(accountFactors, account.admin_mfa_factor_id)) {
            return { blocked: true, username: account.username };
        }
        return {
            session: loginData.session,
            username: account.username,
            setupRequired: false,
            factorId: account.admin_mfa_factor_id
        };
    }
    if (account.admin_mfa_pending_factor_id) {
        if (!hasActiveSetupAuthorization(account)
            || !isOnlyTrustedFactor(accountFactors, account.admin_mfa_pending_factor_id, "unverified")) {
            return { blocked: true, username: account.username };
        }
        return {
            session: loginData.session,
            username: account.username,
            setupRequired: false,
            setupInProgress: true,
            factorId: account.admin_mfa_pending_factor_id
        };
    }
    if (accountFactors.length > 0 || !hasActiveSetupAuthorization(account)) {
        return { blocked: true, username: account.username };
    }
    return {
        session: loginData.session,
        username: account.username,
        setupRequired: true,
        factorId: null
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

async function enrollAdminTotp(accessToken, refreshToken, setupToken) {
    const { authClient, session } = await createMfaSession(accessToken, refreshToken);
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(session.access_token);
    if (claimsError) throw claimsError;
    const { data: account, error: accountError } = await getAdminClient()
        .from("coffee_users")
        .select("id, role, supabase_auth_user_id, admin_mfa_factor_id, admin_mfa_pending_factor_id, admin_mfa_setup_token_hash, admin_mfa_setup_token_expires_at")
        .eq("supabase_auth_user_id", claimsData.claims.sub)
        .maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.role !== "admin") {
        throw Object.assign(new Error("Administrator access is not permitted."), { statusCode: 403 });
    }
    if (account.admin_mfa_factor_id || account.admin_mfa_pending_factor_id
        || !hasValidSetupToken(account, setupToken)) {
        throw Object.assign(new Error("A valid owner-issued setup authorization is required to enroll this administrator authenticator."), { statusCode: 403 });
    }
    const { data: factors, error: factorsError } = await authClient.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    if (factors.all.length > 0) {
        throw Object.assign(new Error("Unapproved authenticator factors exist. Contact the project owner to reset MFA setup."), { statusCode: 403 });
    }
    const { data, error } = await authClient.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Coffee Lab administrator"
    });
    if (error) throw error;
    const { data: pending, error: pendingError } = await getAdminClient()
        .from("coffee_users")
        .update({ admin_mfa_pending_factor_id: data.id })
        .eq("id", account.id)
        .eq("role", "admin")
        .is("admin_mfa_factor_id", null)
        .is("admin_mfa_pending_factor_id", null)
        .eq("admin_mfa_setup_token_hash", hashSetupToken(setupToken))
        .gt("admin_mfa_setup_token_expires_at", new Date().toISOString())
        .select("id")
        .maybeSingle();
    if (pendingError) throw pendingError;
    if (!pending) {
        throw Object.assign(new Error("Setup authorization expired or was already used. Contact the project owner to restart enrollment."), { statusCode: 403 });
    }
    return {
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret
    };
}

async function verifyAdminTotp(accessToken, refreshToken, factorId, code) {
    const { authClient, session } = await createMfaSession(accessToken, refreshToken);
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(session.access_token);
    if (claimsError) throw claimsError;
    const { data: account, error: accountError } = await getAdminClient()
        .from("coffee_users")
        .select("id, username, role, created_at, supabase_auth_user_id, admin_mfa_factor_id, admin_mfa_pending_factor_id, admin_mfa_setup_token_hash, admin_mfa_setup_token_expires_at")
        .eq("supabase_auth_user_id", claimsData.claims.sub)
        .maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.role !== "admin") {
        throw Object.assign(new Error("Administrator access is not permitted."), { statusCode: 403 });
    }
    const isBootstrap = !account.admin_mfa_factor_id
        && account.admin_mfa_pending_factor_id === factorId
        && hasActiveSetupAuthorization(account);
    if (!isBootstrap && account.admin_mfa_factor_id !== factorId) {
        throw Object.assign(new Error("This authenticator is not approved for administrator access."), { statusCode: 403 });
    }
    const { data: factorData, error: factorError } = await authClient.auth.mfa.listFactors();
    if (factorError) throw factorError;
    const expectedStatus = isBootstrap ? "unverified" : "verified";
    if (!isOnlyTrustedFactor(factorData.all, factorId, expectedStatus)) {
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
    const { data: verifiedClaims, error: verifiedClaimsError } = await authClient.auth.getClaims(verified.access_token);
    if (verifiedClaimsError) throw verifiedClaimsError;
    if (verifiedClaims?.claims?.aal !== "aal2") {
        throw new Error("Supabase did not issue a multi-factor administrator session.");
    }

    if (isBootstrap) {
        const { data: approved, error: approvalError } = await getAdminClient()
            .from("coffee_users")
            .update({
                admin_mfa_factor_id: factorId,
                admin_mfa_pending_factor_id: null,
                admin_mfa_setup_token_hash: null,
                admin_mfa_setup_token_expires_at: null
            })
            .eq("id", account.id)
            .eq("role", "admin")
            .is("admin_mfa_factor_id", null)
            .eq("admin_mfa_pending_factor_id", factorId)
            .gt("admin_mfa_setup_token_expires_at", new Date().toISOString())
            .select("id")
            .maybeSingle();
        if (approvalError) throw approvalError;
        if (!approved) {
            throw Object.assign(new Error("Administrator enrollment authorization expired. Contact the project owner."), { statusCode: 403 });
        }
    }
    return { valid: true, session: verified, user: account };
}

module.exports = {
    hashSetupToken,
    hasValidSetupToken,
    hasActiveSetupAuthorization,
    isOnlyTrustedFactor,
    startAdminLogin,
    createMfaSession,
    enrollAdminTotp,
    verifyAdminTotp
};
