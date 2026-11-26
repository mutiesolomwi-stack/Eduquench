import "server-only";
import { createClient } from "@supabase/supabase-js";
import { need } from "../env";

/** Service-role client. Server code only: bypasses row-level security. Never import from a client component. */
export const admin = () =>
  createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
