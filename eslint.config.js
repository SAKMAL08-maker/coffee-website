const globals = {
    AbortController: "readonly",
    Buffer: "readonly",
    URL: "readonly",
    clearInterval: "readonly",
    clearTimeout: "readonly",
    console: "readonly",
    fetch: "readonly",
    module: "readonly",
    process: "readonly",
    require: "readonly",
    setInterval: "readonly",
    setTimeout: "readonly",
    structuredClone: "readonly"
};

module.exports = [
    {
        ignores: ["node_modules/**", "coverage/**"]
    },
    {
        files: [
            "server.js",
            "config/**/*.js",
            "controllers/**/*.js",
            "middleware/**/*.js",
            "routes/**/*.js",
            "schemas/**/*.js",
            "services/**/*.js",
            "test/**/*.js"
        ],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals
        },
        rules: {
            "no-undef": "error",
            "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }]
        }
    }
];
