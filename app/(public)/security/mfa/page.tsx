import { requireMe } from "@/lib/auth";
import { MfaPanel } from "./panel";

export default async function Mfa() {
  const me = await requireMe();
  return (<><h1>Two-factor sign-in</h1><p className="muted">School and system admins must use an authenticator app (Google Authenticator, Microsoft Authenticator or similar) before they can use admin pages.</p><MfaPanel aal={me.aal ?? "aal1"} /></>);
}
