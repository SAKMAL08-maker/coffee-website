const globals = {
    AbortController: "readonly",
    Buffer: "readonly",
    __dirname: "readonly",
    __filename: "readonly",
    URL: "readonly",
    clearInterval: "readonly",
    clearTimeout: "readonly",
    console: "readonly",
    fetch: "readonly",
    module: "readonly",
    process: "readonly",
    require: "readonly",
    setImmediate: "readonly",
    clearImmediate: "readonly",
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
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }]
        }
    }
];
