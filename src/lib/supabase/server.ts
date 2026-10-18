/**
 * Supabase server client.
 *
 * Two factory functions:
 *
 * - `createSupabaseServerClient()` — uses the ANON key + cookie-based auth.
 *   Safe for Route Handlers and Server Components that need user context.
 *
 * - `createSupabaseServiceClient()` — uses the SERVICE_ROLE key.
 *   Only call from trusted server code (webhook handlers, admin RPCs).
 *   NEVER expose to the browser or return in a client component.
 *
 * @supabase/ssr is used for App Router compatibility (cookies API).
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        "Copy .env.example to .env.local and fill in your values."
    );
  }
  return value;
}

/**
 * Anon-key server client — inherits auth context from the request cookies.
 * Use in Route Handlers and Server Components for user-authenticated queries.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}

/**
 * Service-role client — bypasses RLS.
 *
 * ⚠️  Use ONLY in:
 *   - Stripe webhook handler (after signature verification)
 *   - Admin-only server actions that explicitly require privilege escalation
 *
 * Never call this from a public Route Handler or expose its return value
 * to a client component.
 */
export function createSupabaseServiceClient() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
