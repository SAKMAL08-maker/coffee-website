// ESLint "flat config". Lint catches likely bugs (undefined variables, unused
// code, unreachable branches); formatting is left to Prettier, which is why
// eslint-config-prettier is applied last to switch off style rules that overlap.
const js = require("@eslint/js");
const globals = require("globals");
const eslintConfigPrettier = require("eslint-config-prettier/flat");

module.exports = [
    { ignores: ["node_modules/", "coverage/"] },
    js.configs.recommended,
    {
        // Server code, tests, scripts, and config: CommonJS modules running on Node.
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals: { ...globals.node }
        },
        rules: {
            // `const { name, ...rest } = obj` is the idiomatic way to drop a key; don't flag `name`.
            "no-unused-vars": ["error", { ignoreRestSiblings: true }]
        }
    },
    {
        // Browser code: classic <script> files that share state through `window`.
        files: ["public/js/**/*.js"],
        languageOptions: {
            sourceType: "script",
            globals: { ...globals.browser }
        }
    },
    eslintConfigPrettier
];
