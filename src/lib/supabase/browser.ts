/**
 * Supabase browser client (anon key, safe for RSC/client components).
 *
 * Uses @supabase/ssr to support the Next.js App Router and cookie-based auth.
 * The anon key is intentionally public; RLS on every table enforces access.
 *
 * NEVER pass the service_role key here or export it via NEXT_PUBLIC_*.
 */

import { createBrowserClient } from "@supabase/ssr";

/**
 * Returns a Supabase client configured with the public anon key.
 * Call from Client Components and RSC that only need anon/authenticated access.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in your Supabase project values."
    );
  }

  return createBrowserClient(url, anonKey);
}
