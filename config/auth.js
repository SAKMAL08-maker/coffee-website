import { betterAuth } from "better-auth";

export const auth = betterAuth({
  baseURL: {
    allowedHosts: [
      "localhost:3000",
      "https://coffee-lab-4-coffee-lovers.onrender.com"
    ],
    protocol: process.env.NODE_ENV === "development" ? "http" : "https",
    fallback: process.env.BETTER_AUTH_URL,
  },
  advanced: {
    trustedProxyHeaders: true,
  },
});
