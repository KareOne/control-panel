import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole, audit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/** GET — generate a new TOTP secret and return the otpauth URI for QR enrollment. */
export const GET = handler(async (req: NextRequest) => {
  const u = await requireRole(req, "READONLY");
  const secret = generateTotpSecret();
  const uri = totpUri(u.email, secret);
  // Store the pending secret encrypted but NOT yet enabled (enabled on verify)
  await prisma.user.update({
    where: { id: u.id },
    data: { totpSecret: encryptSecret(secret), totpEnabled: false },
  });
  return json({ uri, secret });
});

/** POST — verify the provided code and enable TOTP for the current user. */
export const POST = handler(async (req: NextRequest) => {
  const u = await requireRole(req, "READONLY");
  const { code } = await req.json();

  const user = await prisma.user.findUnique({ where: { id: u.id } });
  if (!user?.totpSecret) {
    return new Response(
      JSON.stringify({ error: "No pending TOTP enrollment. Request GET first." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (user.totpEnabled) {
    return new Response(JSON.stringify({ error: "2FA is already enabled." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  let secret: string;
  try {
    secret = decryptSecret(user.totpSecret);
  } catch {
    return new Response(
      JSON.stringify({ error: "Secret storage error — re-enroll." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!verifyTotp(secret, String(code))) {
    return new Response(JSON.stringify({ error: "Invalid code — try again." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  await prisma.user.update({
    where: { id: u.id },
    data: { totpEnabled: true },
  });
  await audit(u.id, "TOTP_ENABLED", u.email);
  return json({ ok: true });
});

/** DELETE — disable TOTP (requires the current valid code as confirmation). */
export const DELETE = handler(async (req: NextRequest) => {
  const u = await requireRole(req, "READONLY");
  const { code } = await req.json();

  const user = await prisma.user.findUnique({ where: { id: u.id } });
  if (!user?.totpEnabled) {
    return new Response(JSON.stringify({ error: "2FA is not enabled." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let secret: string;
  try {
    secret = decryptSecret(user.totpSecret!);
  } catch {
    return new Response(
      JSON.stringify({ error: "Secret storage error — contact admin." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!verifyTotp(secret, String(code))) {
    return new Response(
      JSON.stringify({ error: "Invalid code — 2FA not disabled." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  await prisma.user.update({
    where: { id: u.id },
    data: { totpEnabled: false, totpSecret: null },
  });
  await audit(u.id, "TOTP_DISABLED", u.email);
  return json({ ok: true });
});
