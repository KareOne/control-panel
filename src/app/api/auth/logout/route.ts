import { NextRequest, NextResponse } from "next/server";
import { COOKIE, extractJti, revokeSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  if (token) {
    const jti = extractJti(token);
    if (jti) await revokeSession(jti);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
