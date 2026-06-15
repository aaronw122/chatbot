import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// Lazily instantiate the client so importing this module (e.g. via the storage
// layer in unit tests) does not crash when Supabase env vars are absent. The
// client is only constructed on first access, i.e. when USE_SUPABASE is on.
let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
  }
  return client
}

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver)
  }
})
