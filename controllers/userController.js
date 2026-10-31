const { getAdminClient } = require("../config/supabase");
const { startAdminLogin, createMfaSession, enrollAdminTotp, verifyAdminTotp } = require("../services/adminMfa");
const { signInSuperadmin } = require("../services/superadminService");
const {
    createRecoveryCode,
    normalizeRecoveryCode,
    hashRecoveryCode,
    hashPassword,
    verifyPassword,
    createSessionToken,
    hashSessionToken
} = require("../services/accountSecurity");
const {
    sessionCookie,
    clearSessionCookie,
    readSessionToken,
    readCookie,
    ADMIN_MFA_ACCESS_COOKIE_NAME,
    ADMIN_MFA_REFRESH_COOKIE_NAME,
    ADMIN_ACCESS_COOKIE_NAME,
    ADMIN_REFRESH_COOKIE_NAME,
    setPendingAdminCookies,
    setVerifiedAdminCookies,
    clearAdminCookies
} = require("../middleware/authenticate");
const {
    normalizeConfiguration,
    getComposition,
    classifyDrink,
    calculateNutrition
} = require("../services/coffeeService");

const PERSISTENT_SESSION_DAYS = 30;
const TEMPORARY_SESSION_HOURS = 12;
const recoveryCodesToIssue = 10;
let dummyPasswordHash;

function normalizedUsername(username) {
    return username.trim().toLowerCase();
}

function sessionExpiration(staySignedIn) {
    const duration = staySignedIn
        ? PERSISTENT_SESSION_DAYS * 24 * 60 * 60 * 1000
        : TEMPORARY_SESSION_HOURS * 60 * 60 * 1000;
    return new Date(Date.now() + duration).toISOString();
}

async function createSession(response, user, staySignedIn) {
    const token = createSessionToken();
    const expiresAt = sessionExpiration(staySignedIn);
    const { error } = await getAdminClient()
        .from("coffee_sessions")
        .insert({
            user_id: user.id,
            token_hash: hashSessionToken(token),
            expires_at: expiresAt
        });
    if (error) throw error;
    response.set("Set-Cookie", sessionCookie(token, staySignedIn));
}

async function signUp(request, response, next) {
    try {
        const username = normalizedUsername(request.body.username);
        const recoveryCodes = Array.from({ length: recoveryCodesToIssue }, createRecoveryCode);
        const passwordHash = await hashPassword(request.body.password);
        const { data: userId, error } = await getAdminClient().rpc("create_coffee_account", {
            p_username: username,
            p_password_hash: passwordHash,
            p_recovery_code_hashes: recoveryCodes.map(hashRecoveryCode)
        });
        if (error) {
            if (error.code === "23505") {
                return response.status(409).json({ error: "That username is unavailable. Choose another." });
            }
            throw error;
        }
        response.status(201).json({
            user: { id: userId, username, role: "customer" },
            recoveryCodes
        });
    } catch (error) {
        next(error);
    }
}

async function logIn(request, response, next) {
    try {
        const username = normalizedUsername(request.body.username);
        const { data: user, error } = await getAdminClient()
            .from("coffee_users")
            .select("id, username, password_hash, role, created_at, supabase_auth_user_id")
            .eq("username_key", username)
            .maybeSingle();
        if (error) throw error;

        if (user?.role === "admin") {
            const result = await startAdminLogin(username, request.body.password);
            if (!result) {
                clearAdminCookies(response);
                return response.status(401).json({ error: "Username or password is incorrect." });
            }
            if (result.blocked) {
                clearAdminCookies(response);
                return response.status(403).json({
                    error: "Administrator authenticator setup is not authorized or needs owner recovery. Contact the Supabase project owner."
                });
            }
            setPendingAdminCookies(response, result.session);
            return response.json({
                mfaRequired: true,
                setupRequired: result.setupRequired,
                setupInProgress: result.setupInProgress || false,
                factorId: result.factorId,
                username: result.username
            });
        }

        // The superadmin must use its own screen (password + security questions).
        if (user?.role === "superadmin") {
            return response.status(401).json({ error: "Username or password is incorrect." });
        }

        const storedPasswordHash =
            user?.password_hash ||
            (await (dummyPasswordHash ||= hashPassword("Coffee Lab invalid-account timing value")));
        const passwordMatches = await verifyPassword(request.body.password, storedPasswordHash);
        if (!user || !passwordMatches) {
            return response.status(401).json({ error: "Username or password is incorrect." });
        }

        await createSession(response, user, request.body.staySignedIn);
        response.json({ user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
        next(error);
    }
}

async function logInSuperadmin(request, response, next) {
    try {
        const result = await signInSuperadmin(getAdminClient(), request.body);
        if (result.user) {
            // Never "stay signed in": a superadmin session ends after 12 hours.
            await createSession(response, result.user, false);
            return response.json({ user: { id: result.user.id, username: result.user.username, role: "superadmin" } });
        }
        if (result.locked) {
            return response.status(423).json({
                error: "This account is locked after too many failed attempts. Unlock it in Supabase (superadmin_security → locked)."
            });
        }
        const left = result.attemptsLeft;
        return response.status(401).json({
            error:
                left === null
                    ? "Those details don't match."
                    : `Those details don't match. ${left} attempt${left === 1 ? "" : "s"} left before the account locks.`
        });
    } catch (error) {
        next(error);
    }
}

async function enrollAdminMfa(request, response, next) {
    try {
        const result = await enrollAdminTotp(
            readCookie(request, ADMIN_MFA_ACCESS_COOKIE_NAME),
            readCookie(request, ADMIN_MFA_REFRESH_COOKIE_NAME),
            request.body.bootstrapToken
        );
        response.json(result);
    } catch (error) {
        next(error);
    }
}

async function verifyAdminMfa(request, response, next) {
    try {
        const result = await verifyAdminTotp(
            readCookie(request, ADMIN_MFA_ACCESS_COOKIE_NAME),
            readCookie(request, ADMIN_MFA_REFRESH_COOKIE_NAME),
            request.body.factorId,
            request.body.code
        );
        if (!result.valid) {
            return response
                .status(401)
                .json({ error: "That authenticator code is invalid or expired. Try the latest code." });
        }
        setVerifiedAdminCookies(response, result.session);
        response.json({
            user: {
                id: result.user.id,
                username: result.user.username,
                role: result.user.role
            }
        });
    } catch (error) {
        next(error);
    }
}

async function getCurrentUser(request, response) {
    response.json({
        user: {
            id: request.user.id,
            username: request.user.username,
            role: request.user.role,
            createdAt: request.user.created_at
        }
    });
}

async function logOut(request, response, next) {
    try {
        const token = readSessionToken(request);
        if (token) {
            const { error } = await getAdminClient()
                .from("coffee_sessions")
                .delete()
                .eq("token_hash", hashSessionToken(token));
            if (error) throw error;
        }
        const accessToken =
            readCookie(request, ADMIN_ACCESS_COOKIE_NAME) || readCookie(request, ADMIN_MFA_ACCESS_COOKIE_NAME);
        const refreshToken =
            readCookie(request, ADMIN_REFRESH_COOKIE_NAME) || readCookie(request, ADMIN_MFA_REFRESH_COOKIE_NAME);
        if (accessToken && refreshToken) {
            const { authClient } = await createMfaSession(accessToken, refreshToken);
            const { error } = await authClient.auth.signOut({ scope: "local" });
            if (error) throw error;
        }
        response.set("Set-Cookie", clearSessionCookie());
        clearAdminCookies(response);
        response.json({ message: "Session ended." });
    } catch (error) {
        response.set("Set-Cookie", clearSessionCookie());
        clearAdminCookies(response);
        next(error);
    }
}

async function resetPassword(request, response, next) {
    try {
        const { data: account, error: accountError } = await getAdminClient()
            .from("coffee_users")
            .select("role")
            .eq("username_key", normalizedUsername(request.body.username))
            .maybeSingle();
        if (accountError) throw accountError;
        if (account?.role === "admin" || account?.role === "superadmin") {
            return response.status(400).json({
                error: "Username or recovery code is invalid or already used. Administrator passwords are managed through Supabase Auth; contact the project owner for a reset."
            });
        }
        const { data, error } = await getAdminClient().rpc("reset_coffee_account_password", {
            p_username_key: normalizedUsername(request.body.username),
            p_recovery_code_hash: hashRecoveryCode(normalizeRecoveryCode(request.body.recoveryCode)),
            p_password_hash: await hashPassword(request.body.password)
        });
        if (error) throw error;
        if (!data) {
            return response.status(400).json({ error: "Username or recovery code is invalid or already used." });
        }
        response.json({ message: "Password reset. Sign in with your new password." });
    } catch (error) {
        next(error);
    }
}

async function listSavedBar(request, response, next) {
    try {
        const { data, error } = await getAdminClient()
            .from("coffees")
            .select("id, name, configuration, classification, nutrition, created_at")
            .eq("account_id", request.user.id)
            .order("created_at", { ascending: false });
        if (error) throw error;
        response.json({ savedBar: data });
    } catch (error) {
        next(error);
    }
}

async function addSavedRecipe(request, response, next) {
    try {
        const name = request.body.name.trim();
        const configuration = normalizeConfiguration(request.body.configuration);
        const composition = getComposition(configuration);
        const { data, error } = await getAdminClient()
            .from("coffees")
            .insert({
                account_id: request.user.id,
                name,
                configuration,
                classification: classifyDrink(configuration, composition),
                nutrition: calculateNutrition(configuration)
            })
            .select("id, name, configuration, classification, nutrition, created_at")
            .single();
        if (error) throw error;
        response.status(201).json({ recipe: data });
    } catch (error) {
        next(error);
    }
}

async function removeSavedRecipe(request, response, next) {
    try {
        const { data, error } = await getAdminClient()
            .from("coffees")
            .delete()
            .eq("id", request.params.recipeId)
            .eq("account_id", request.user.id)
            .select("id")
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(404).json({ error: "Saved recipe not found." });
        response.json({ message: "Saved recipe removed." });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    signUp,
    logIn,
    logInSuperadmin,
    enrollAdminMfa,
    verifyAdminMfa,
    getCurrentUser,
    logOut,
    resetPassword,
    listSavedBar,
    addSavedRecipe,
    removeSavedRecipe
};
