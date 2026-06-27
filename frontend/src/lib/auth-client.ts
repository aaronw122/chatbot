import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const baseURL = configuredApiUrl || (import.meta.env.DEV ? "http://localhost:3000" : window.location.origin);

export const authClient = createAuthClient({
  baseURL,
  // Anonymous-first free tier: lets us mint a throwaway anonymous session on first
  // load so visitors can chat immediately. `signUp.email` / `signIn.social` then
  // auto-trigger the anonymous→real account link (backend migrates the data).
  plugins: [anonymousClient()],
});
