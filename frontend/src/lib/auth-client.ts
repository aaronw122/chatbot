import { createAuthClient } from "better-auth/react";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const baseURL = configuredApiUrl || (import.meta.env.DEV ? "http://localhost:3000" : window.location.origin);

export const authClient = createAuthClient({
  baseURL,
});
