import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED = ["/dashboard", "/sessions", "/overview", "/audit"];

/** Next.js 16 proxy: refresh the session and keep signed-out visitors out of role areas.
 *  This is a convenience filter only; every page and handler re-checks, and row-level security is the real wall. */
export async function proxy(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => { req.cookies.set(name, value); res.cookies.set(name, value, options); }),
    },
  });
  const { data } = await sb.auth.getClaims();
  const path = req.nextUrl.pathname;
  if (!data?.claims && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    const url = req.nextUrl.clone(); url.pathname = "/sign-in"; url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|api/daraja|api/jobs).*)"] };
