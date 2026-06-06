import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listContainers } from "@/lib/docker";

export const dynamic = "force-dynamic";

/** Keys whose values should be stored as null (masked). */
function isSensitive(key: string): boolean {
  const up = key.toUpperCase();
  return (
    up.includes("SECRET") ||
    up.includes("_KEY") ||
    up.includes("PASSWORD") ||
    up.includes("TOKEN") ||
    up.includes("PASS")
  );
}

/**
 * POST /api/drift/snapshot
 * Takes a fresh snapshot of all running containers' env vars.
 * Sensitive keys are stored with value=null and masked=true.
 * Returns { saved, services }.
 */
export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, "ENGINEER");

  const containers = await listContainers();
  const running = containers.filter((c) => c.state === "running");

  const rows: {
    environment: string;
    service: string;
    key: string;
    value: string | null;
    masked: boolean;
  }[] = [];

  for (const c of running) {
    const service = c.composeService ?? c.name;
    const environment = c.composeProject ?? "dev";

    for (const [key, value] of Object.entries(c.env)) {
      const masked = isSensitive(key);
      rows.push({
        environment,
        service,
        key,
        value: masked ? null : value,
        masked,
      });
    }
  }

  // Bulk insert — createMany ignores duplicates via skipDuplicates but here
  // we always want a new snapshot row so we use createMany without skip.
  await prisma.envSnapshot.createMany({ data: rows });

  const services = Array.from(new Set(rows.map((r) => `${r.environment}/${r.service}`)));

  return json({ ok: true, count: rows.length, services });
});
