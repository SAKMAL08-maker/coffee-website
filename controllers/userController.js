const { getAuthClient, getAdminClient } = require("../config/supabase");
const {
    normalizeConfiguration,
    getComposition,
    classifyDrink,
    calculateNutrition
} = require("../services/coffeeService");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBody(body, allowedKeys) {
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((key) => !allowedKeys.includes(key))) {
        throw Object.assign(new Error("Request body is invalid or contains unsupported fields."), { statusCode: 400 });
    }
}

function respondWithSafeAuthError(response, error, action) {
    if (action === "login" && ["invalid_credentials", "user_not_found", "invalid_grant", "email_not_confirmed"].includes(error.code)) {
        return response.status(401).json({ error: "Email or password is incorrect." });
    }
    if (action === "signup" && [
        "user_already_exists",
        "email_exists",
        "weak_password",
        "validation_failed",
        "email_address_invalid"
    ].includes(error.code)) {
        return response.status(400).json({ error: "Sign-up could not be completed with those details." });
    }
    throw error;
}

async function signUp(request, response, next) {
    try {
        validateBody(request.body, ["name", "email", "password"]);
        const { name, email, password } = request.body;
        if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
            return response.status(400).json({ error: "Name is required and must be 80 characters or fewer." });
        }
        if (typeof email !== "string" || !emailPattern.test(email.trim()) || email.length > 254) {
            return response.status(400).json({ error: "A valid email address is required." });
        }
        if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
            return response.status(400).json({ error: "Password must be at least 12 characters and no more than 72 UTF-8 bytes." });
        }

        const { data, error } = await getAuthClient().auth.signUp({
            email: email.trim().toLowerCase(),
            password,
            options: { data: { name: name.trim() } }
        });
        if (error) return respondWithSafeAuthError(response, error, "signup");

        response.status(201).json({
            accessToken: data.session?.access_token || null,
            requiresEmailConfirmation: !data.session,
            user: { id: data.user.id, name: name.trim(), email: data.user.email }
        });
    } catch (error) {
        next(error);
    }
}

async function logIn(request, response, next) {
    try {
        validateBody(request.body, ["email", "password"]);
        const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
        const password = request.body.password;
        if (!emailPattern.test(email) || typeof password !== "string") {
            return response.status(400).json({ error: "A valid email and password are required." });
        }

        const { data, error } = await getAuthClient().auth.signInWithPassword({ email, password });
        if (error) return respondWithSafeAuthError(response, error, "login");
        const { data: profile, error: profileError } = await getAdminClient()
            .from("profiles")
            .select("name, role")
            .eq("id", data.user.id)
            .maybeSingle();
        if (profileError) throw profileError;

        response.json({
            accessToken: data.session.access_token,
            expiresAt: data.session.expires_at,
            user: { id: data.user.id, name: profile?.name || "", email: data.user.email }
        });
    } catch (error) {
        next(error);
    }
}

async function getCurrentUser(request, response, next) {
    try {
        const { data, error } = await getAdminClient()
            .from("profiles")
            .select("id, name, role, created_at")
            .eq("id", request.user.id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(404).json({ error: "User profile not found." });
        response.json({ user: { ...data, email: request.user.email } });
    } catch (error) {
        next(error);
    }
}

async function logOut(request, response, next) {
    try {
        const { error } = await getAdminClient().auth.admin.signOut(request.accessToken, "local");
        if (error) throw error;
        response.json({ message: "Session ended." });
    } catch (error) {
        next(error);
    }
}

async function listSavedBar(request, response, next) {
    try {
        const { data, error } = await getAdminClient()
            .from("coffees")
            .select("id, name, configuration, classification, nutrition, created_at")
            .eq("user_id", request.user.id)
            .order("created_at", { ascending: false });
        if (error) throw error;
        response.json({ savedBar: data });
    } catch (error) {
        next(error);
    }
}

async function addSavedRecipe(request, response, next) {
    try {
        validateBody(request.body, ["name", "configuration"]);
        const name = typeof request.body.name === "string" ? request.body.name.trim() : "";
        if (!name || name.length > 48) {
            return response.status(400).json({ error: "Recipe name is required and must be 48 characters or fewer." });
        }
        const configuration = normalizeConfiguration(request.body.configuration);
        const composition = getComposition(configuration);
        const { data, error } = await getAdminClient()
            .from("coffees")
            .insert({
                user_id: request.user.id,
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
            .eq("user_id", request.user.id)
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
    getCurrentUser,
    logOut,
    listSavedBar,
    addSavedRecipe,
    removeSavedRecipe
};
