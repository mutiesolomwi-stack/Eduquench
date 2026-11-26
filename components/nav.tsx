import Link from "next/link";
import { getMe, hasRole } from "@/lib/auth";

export async function Nav() {
  const me = await getMe();
  return (
    <nav className="top" aria-label="Main">
      <div className="wrap">
        <Link href="/">Eduquench</Link>
        <span style={{ display: "flex", gap: "1rem" }}>
          {me && hasRole(me, "student") && <Link href="/dashboard">My classes</Link>}
          {me && hasRole(me, "teacher", "assistant") && <><Link href="/sessions">Sessions</Link><Link href="/approvals">Requests</Link></>}
          {me && hasRole(me, "school_admin") && <Link href="/overview">School</Link>}
          {me && hasRole(me, "system_admin") && <Link href="/audit">Audit</Link>}
          {me ? <form action="/api/auth/sign-out" method="post"><button className="btn ghost" style={{ color: "#fff", borderColor: "#fff" }}>Sign out</button></form> : <Link href="/sign-in">Sign in</Link>}
        </span>
      </div>
    </nav>
  );
}
