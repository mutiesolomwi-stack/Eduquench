import QRCode from "qrcode";
import Link from "next/link";
import { requireMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { sha256, toBytea } from "@/lib/crypto";

/** Opens the access pack from the emailed or in-app link. Only the beneficiary's own login can open it. */
export default async function AccessLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const me = await requireMe();
  const { data } = await admin().rpc("rpc_open_access_link", { p_student: me.id, p_token_hash: toBytea(sha256(token)) });
  const pack = data as { class_name: string; valid_until: string | null } | null;
  if (!pack) return <div className="card"><h1>This access link is not for this account</h1><p>Sign in as the student it was issued to, or ask the payer to check the beneficiary name.</p><Link className="btn" href="/dashboard">Go to my classes</Link></div>;
  const url = `${process.env.APP_URL}/access/${token}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 220, color: { dark: "#0B3D91", light: "#FFFFFF" } });
  return (
    <div className="card" style={{ maxWidth: 520, margin: "1rem auto" }}>
      <h1>Access confirmed</h1>
      <p><strong>{pack.class_name}</strong>{pack.valid_until ? ` · valid until ${new Date(pack.valid_until).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" })}` : ""}</p>
      <div role="img" aria-label="QR code for this access link" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="muted">The QR code opens this page. You still sign in on your own registered device to join a lesson.</p>
      <Link className="btn big" href="/dashboard">Go to my classes</Link>
    </div>
  );
}
