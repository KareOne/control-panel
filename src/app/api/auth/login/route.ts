import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPassword, createSession, COOKIE, audit } from "@/lib/auth";
import { handler } from "@/lib/api";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/ratelimit";
import { verifyTotp } from "@/lib/totp";
import { decryptSecret } from "@/lib/crypto";

export const POST = handler(async (req: NextRequest) => {
  const { email, password, totpCode } = await req.json();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Rate limit: check before touching the DB
  const limit = await checkLoginRateLimit(email ?? "", ip);
  if (limit.limited) {
    return NextResponse.json(
      {
        error: `Too many failed attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await checkPassword(password, user.passwordHash))) {
    await recordLoginFailure(email ?? "", ip);
    await audit(null, "LOGIN_FAILED", email, undefined, ip);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // 2FA gate — if enabled, require a valid TOTP code before issuing a session
  if (user.totpEnabled) {
    if (!totpCode) {
      // Signal to the client that a TOTP code is required (no session issued yet)
      return NextResponse.json({ requiresTotp: true }, { status: 200 });
    }
    let secret: string;
    try {
      secret = decryptSecret(user.totpSecret!);
    } catch {
      return NextResponse.json(
        { error: "2FA misconfigured — contact admin." },
        { status: 500 }
      );
    }
    if (!verifyTotp(secret, String(totpCode))) {
      await recordLoginFailure(email, ip);
      await audit(user.id, "LOGIN_TOTP_FAILED", user.email, undefined, ip);
      return NextResponse.json(
        { error: "Invalid authenticator code." },
        { status: 401 }
      );
    }
  }

  await clearLoginFailures(email, ip);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const sessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as any,
  };
  const token = await createSession(sessionUser, req);
  await audit(user.id, "LOGIN", user.email, undefined, ip);

  const res = NextResponse.json({ user: sessionUser });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
});
