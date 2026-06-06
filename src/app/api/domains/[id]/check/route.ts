import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as https from "https";
import * as dns from "dns";

export const dynamic = "force-dynamic";

function checkSsl(hostname: string): Promise<{ status: string; expiry: Date | null; issuer: string | null }> {
  return new Promise((resolve) => {
    const req = https.get(
      { host: hostname, port: 443, path: "/", method: "GET", rejectUnauthorized: false, timeout: 8000 },
      (res) => {
        const cert = (res.socket as any).getPeerCertificate?.();
        if (!cert || !cert.valid_to) {
          resolve({ status: "INVALID", expiry: null, issuer: null });
          return;
        }
        const expiry = new Date(cert.valid_to);
        const daysLeft = (expiry.getTime() - Date.now()) / 86400000;
        let status = "VALID";
        if (daysLeft < 0) status = "EXPIRED";
        else if (daysLeft < 14) status = "EXPIRING_SOON";
        const issuer = cert.issuer?.O ?? cert.issuer?.CN ?? null;
        resolve({ status, expiry, issuer });
      }
    );
    req.on("error", () => resolve({ status: "UNKNOWN", expiry: null, issuer: null }));
    req.on("timeout", () => { req.destroy(); resolve({ status: "UNKNOWN", expiry: null, issuer: null }); });
  });
}

function checkDns(hostname: string): Promise<{ status: string; ip: string | null }> {
  return dns.promises.lookup(hostname).then(
    (result) => ({ status: "OK", ip: result.address }),
    () => ({ status: "UNREACHABLE", ip: null })
  );
}

export const POST = handler(async (req: NextRequest, { params }: { params: { id: string } }) => {
  await requireRole(req, "ENGINEER");
  const domain = await prisma.domain.findUniqueOrThrow({ where: { id: params.id } });

  const [ssl, dns_] = await Promise.all([
    checkSsl(domain.name).catch(() => ({ status: "UNKNOWN", expiry: null, issuer: null })),
    checkDns(domain.name).catch(() => ({ status: "UNKNOWN", ip: null })),
  ]);

  const updated = await prisma.domain.update({
    where: { id: params.id },
    data: {
      sslStatus: ssl.status as any,
      sslExpiry: ssl.expiry,
      sslIssuer: ssl.issuer,
      dnsStatus: dns_.status as any,
      dnsResolvesTo: dns_.ip,
      lastCheckedAt: new Date(),
    },
  });
  return json(updated);
});
