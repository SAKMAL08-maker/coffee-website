const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { normalizeConfiguration } = require("../services/coffeeService");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBody(body, allowedKeys) {
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((key) => !allowedKeys.includes(key))) {
        throw Object.assign(new Error("Request body is invalid or contains unsupported fields."), { statusCode: 400 });
    }
}

function createToken(user) {
    return jwt.sign(
        { sessionVersion: user.sessionVersion },
        process.env.JWT_SECRET,
        { subject: user.id, expiresIn: "1h" }
    );
}

function publicUser(user) {
    return { id: user.id, name: user.name, email: user.email, savedBar: user.savedBar };
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

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await User.create({ name: name.trim(), email: email.trim().toLowerCase(), passwordHash });
        response.status(201).json({ token: createToken(user), user: publicUser(user) });
    } catch (error) {
        next(error);
    }
}

async function logIn(request, response, next) {
    try {
        validateBody(request.body, ["email", "password"]);
        const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
        const password = request.body.password;
        if (!emailPattern.test(email) || typeof password !== "string" || Buffer.byteLength(password, "utf8") > 72) {
            return response.status(400).json({ error: "A valid email and password are required." });
        }

        const user = await User.findOne({ email }).select("+passwordHash +sessionVersion");
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return response.status(401).json({ error: "Email or password is incorrect." });
        }
        response.json({ token: createToken(user), user: publicUser(user) });
    } catch (error) {
        next(error);
    }
}

async function getCurrentUser(request, response) {
    response.json({ user: publicUser(request.user) });
}

async function logOut(request, response, next) {
    try {
        request.user.sessionVersion += 1;
        await request.user.save();
        response.json({ message: "Session ended." });
    } catch (error) {
        next(error);
    }
}

async function listSavedBar(request, response) {
    response.json({ savedBar: request.user.savedBar });
}

async function addSavedRecipe(request, response, next) {
    try {
        validateBody(request.body, ["name", "configuration"]);
        const name = typeof request.body.name === "string" ? request.body.name.trim() : "";
        if (!name || name.length > 48) {
            return response.status(400).json({ error: "Recipe name is required and must be 48 characters or fewer." });
        }
        const configuration = normalizeConfiguration(request.body.configuration);
        request.user.savedBar.push({ name, configuration });
        await request.user.save();
        response.status(201).json({ recipe: request.user.savedBar.at(-1) });
    } catch (error) {
        next(error);
    }
}

async function removeSavedRecipe(request, response, next) {
    try {
        const recipe = request.user.savedBar.id(request.params.recipeId);
        if (!recipe) return response.status(404).json({ error: "Saved recipe not found." });
        recipe.deleteOne();
        await request.user.save();
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
