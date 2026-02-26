import { betterAuth } from "better-auth";
import { Pool } from "pg";

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
});
