import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when the app has been pointed at a Supabase project (.env.local). */
export const isConfigured = Boolean(url && anon && !url.includes("YOUR-PROJECT"));

let client: SupabaseClient | null = null;

/** Browser Supabase client. All data access goes through Row-Level Security as the signed-in user. */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(url || "http://localhost:54321", anon || "public-anon-key", {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
