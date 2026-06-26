import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { Pool } from "pg";
import { storage } from "../db/storage";

const trustedOrigins = Array.from(
  new Set(
    [
      process.env.FRONTEND_URL,
      process.env.BETTER_AUTH_URL,
      "http://localhost:5173",
      "http://localhost:3000",
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/\/+$/, ""))
  )
);

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL, // your Supabase connection string
  }),
  trustedOrigins,
  emailAndPassword: {
      enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  plugins: [
    // Anonymous-first free tier: lets the frontend mint a throwaway session via
    // signIn.anonymous() so a brand-new visitor can use their free replies before
    // signing up. When they later sign up / log in, better-auth fires this hook to
    // link the accounts; we carry the anon user's app data (free-usage count first
    // and fail-closed, then conversations/highlights/keys) onto the real user.
    anonymous({
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await storage.reassignUserData({
          fromUserId: anonymousUser.user.id,
          toUserId: newUser.user.id,
        });
      },
    }),
  ],
});
