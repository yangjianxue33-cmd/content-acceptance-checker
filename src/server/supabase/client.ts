import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database.generated";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing public Supabase environment variables");
  }

  return createBrowserClient<Database>(url, anonKey);
}
