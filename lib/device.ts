import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { admin } from "./supabase/admin";
import { sha256, toBytea } from "./crypto";

export const DEVICE_COOKIE = "eq_device";

/** Reads (or creates) the browser's random device token and checks it against the student's registered device. */
export async function deviceState(userId: string, label = "browser"): Promise<"active" | "pending" | "unknown"> {
  const store = await cookies();
  let tok = store.get(DEVICE_COOKIE)?.value;
  if (!tok) {
    tok = randomBytes(32).toString("base64url");
    store.set(DEVICE_COOKIE, tok, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 400, path: "/" });
    const { data } = await admin().rpc("rpc_register_device", { p_user: userId, p_token_hash: toBytea(sha256(tok)), p_label: label });
    return (data as "active" | "pending") ?? "unknown";
  }
  const { data } = await admin().rpc("rpc_device_status", { p_user: userId, p_token_hash: toBytea(sha256(tok)) });
  return (data as "active" | "pending" | "unknown") ?? "unknown";
}
