import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/drift/compare?env1=production&env2=staging
 * Compares two environments by looking at the latest snapshot for each.
 * Returns per-key diff: same / different / only_env1 / only_env2.
 */
export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");

  const url = new URL(req.url);
  const env1 = url.searchParams.get("env1");
  const env2 = url.searchParams.get("env2");

  if (!env1 || !env2) {
    return json({ error: "env1 and env2 query params are required" }, { status: 400 });
  }

  // Fetch latest snapshot rows for both environments
  const rawAll = await prisma.envSnapshot.findMany({
    where: { environment: { in: [env1, env2] } },
    orderBy: { capturedAt: "desc" },
  });

  // Build: env -> service -> key -> latest snapshot
  type SnapRow = {
    environment: string;
    service: string;
    key: string;
    value: string | null;
    masked: boolean;
    capturedAt: Date;
  };

  const latest: Record<string, Record<string, Record<string, SnapRow>>> = {};
  for (const s of rawAll) {
    if (!latest[s.environment]) latest[s.environment] = {};
    if (!latest[s.environment][s.service]) latest[s.environment][s.service] = {};
    if (!latest[s.environment][s.service][s.key]) {
      latest[s.environment][s.service][s.key] = s as SnapRow;
    }
  }

  const snap1 = latest[env1] ?? {};
  const snap2 = latest[env2] ?? {};

  // Collect all services across both envs
  const allServices = Array.from(new Set([...Object.keys(snap1), ...Object.keys(snap2)]));

  type DiffStatus = "same" | "different" | "only_env1" | "only_env2";
  type DiffRow = {
    service: string;
    key: string;
    env1Value: string | null;
    env1Masked: boolean;
    env2Value: string | null;
    env2Masked: boolean;
    status: DiffStatus;
  };

  const diffs: DiffRow[] = [];

  for (const service of allServices) {
    const svc1 = snap1[service] ?? {};
    const svc2 = snap2[service] ?? {};
    const allKeys = Array.from(new Set([...Object.keys(svc1), ...Object.keys(svc2)]));

    for (const key of allKeys) {
      const r1 = svc1[key];
      const r2 = svc2[key];

      if (r1 && !r2) {
        diffs.push({
          service,
          key,
          env1Value: r1.masked ? null : r1.value,
          env1Masked: r1.masked,
          env2Value: null,
          env2Masked: false,
          status: "only_env1",
        });
      } else if (!r1 && r2) {
        diffs.push({
          service,
          key,
          env1Value: null,
          env1Masked: false,
          env2Value: r2.masked ? null : r2.value,
          env2Masked: r2.masked,
          status: "only_env2",
        });
      } else if (r1 && r2) {
        // Both present — compare values (masked keys are always "same" if both masked)
        let status: DiffStatus = "same";
        if (r1.masked && r2.masked) {
          status = "same"; // can't compare, assume same
        } else if (r1.masked || r2.masked) {
          status = "different"; // one is masked, one isn't — treat as different
        } else if (r1.value !== r2.value) {
          status = "different";
        }
        diffs.push({
          service,
          key,
          env1Value: r1.masked ? null : r1.value,
          env1Masked: r1.masked,
          env2Value: r2.masked ? null : r2.value,
          env2Masked: r2.masked,
          status,
        });
      }
    }
  }

  const summary = {
    same: diffs.filter((d) => d.status === "same").length,
    different: diffs.filter((d) => d.status === "different").length,
    only_env1: diffs.filter((d) => d.status === "only_env1").length,
    only_env2: diffs.filter((d) => d.status === "only_env2").length,
  };

  return json({ env1, env2, diffs, summary });
});
