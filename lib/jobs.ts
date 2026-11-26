import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "./crypto";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Anything else is refused. */
export function authorisedJob(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  const h = req.headers.get("authorization") ?? "";
  return !!s && safeEqual(h, `Bearer ${s}`);
}
export const denied = () => NextResponse.json({ error: "forbidden" }, { status: 403 });
