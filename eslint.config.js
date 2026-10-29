const globals = {
  AbortController: "readonly",
  AbortSignal: "readonly",
  Array: "readonly",
  ArrayBuffer: "readonly",
  BigInt: "readonly",
  Boolean: "readonly",
  Buffer: "readonly",
  Date: "readonly",
  DataView: "readonly",
  Error: "readonly",
  Intl: "readonly",
  JSON: "readonly",
  Map: "readonly",
  Math: "readonly",
  Number: "readonly",
  Object: "readonly",
  Promise: "readonly",
  Proxy: "readonly",
  Reflect: "readonly",
  RegExp: "readonly",
  Set: "readonly",
  String: "readonly",
  Symbol: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  Uint8Array: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  WeakMap: "readonly",
  WeakSet: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  atob: "readonly",
  btoa: "readonly",
  clearImmediate: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  crypto: "readonly",
  fetch: "readonly",
  global: "readonly",
  globalThis: "readonly",
  module: "readonly",
  performance: "readonly",
  process: "readonly",
  queueMicrotask: "readonly",
  require: "readonly",
  setImmediate: "readonly",
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
