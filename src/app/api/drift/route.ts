import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listContainers } from "@/lib/docker";

export const dynamic = "force-dynamic";

/** Keys whose values are masked in snapshots */
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
 * GET /api/drift
 * Scans running Docker containers, reads their env vars, compares against
 * stored snapshots (last capture per environment+service+key).
 * Returns { services, drifts }.
 */
export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");

  let containers: Awaited<ReturnType<typeof listContainers>> = [];
  try {
    containers = await listContainers();
  } catch {
    // Docker may be unreachable; return empty live state with snapshots
  }

  // Build live env map: service -> { key -> value }
  const liveMap: Record<string, Record<string, string>> = {};
  for (const c of containers) {
    if (c.state !== "running") continue;
    const serviceName = c.composeService ?? c.name;
    liveMap[serviceName] = { ...c.env };
  }

  // Pull latest snapshot per (environment, service, key)
  const rawSnapshots = await prisma.envSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
  });

  // Group snapshots: environment -> service -> key -> latest snapshot row
  type SnapRow = {
    id: string;
    environment: string;
    service: string;
    key: string;
    value: string | null;
    masked: boolean;
    capturedAt: Date;
  };

  const latestSnap: Record<string, Record<string, Record<string, SnapRow>>> = {};
  for (const s of rawSnapshots) {
    if (!latestSnap[s.environment]) latestSnap[s.environment] = {};
    if (!latestSnap[s.environment][s.service]) latestSnap[s.environment][s.service] = {};
    // Because ordered desc, first occurrence = latest
    if (!latestSnap[s.environment][s.service][s.key]) {
      latestSnap[s.environment][s.service][s.key] = s as SnapRow;
    }
  }

  // Collect known environments from snapshots
  const environments = Object.keys(latestSnap);

  // Build services list with drift indicators per service
  type DriftStatus = "clean" | "changed" | "new_key" | "missing_key" | "no_snapshot";
  type ServiceInfo = {
    service: string;
    state: string;
    environment: string | null;
    liveKeyCount: number;
    snapshotKeyCount: number;
    lastSnapshotAt: string | null;
    status: DriftStatus;
    drifts: { key: string; status: "changed" | "new_key" | "missing_key" }[];
  };

  const servicesMap: Record<string, ServiceInfo> = {};

  // Populate from live containers
  for (const c of containers) {
    const svc = c.composeService ?? c.name;
    const env = c.composeProject ?? "dev";
    const liveEnv = liveMap[svc] ?? {};
    const snapshotEnv = latestSnap[env]?.[svc] ?? {};

    const snapKeys = new Set(Object.keys(snapshotEnv));
    const liveKeys = new Set(Object.keys(liveEnv));

    let lastSnapshotAt: string | null = null;
    for (const snap of Object.values(snapshotEnv)) {
      if (!lastSnapshotAt || snap.capturedAt > new Date(lastSnapshotAt)) {
        lastSnapshotAt = snap.capturedAt.toISOString();
      }
    }

    const drifts: ServiceInfo["drifts"] = [];

    if (snapKeys.size === 0 && liveKeys.size === 0) {
      // nothing to compare
    } else if (snapKeys.size === 0) {
      // no snapshot taken yet
    } else {
      for (const key of Array.from(liveKeys)) {
        if (!snapKeys.has(key)) {
          drifts.push({ key, status: "new_key" });
        } else {
          const snap = snapshotEnv[key];
          if (!snap.masked && snap.value !== null) {
            const liveVal = liveEnv[key];
            if (liveVal !== snap.value) {
              drifts.push({ key, status: "changed" });
            }
          }
        }
      }
      for (const key of Array.from(snapKeys)) {
        if (!liveKeys.has(key)) {
          drifts.push({ key, status: "missing_key" });
        }
      }
    }

    let status: DriftStatus = "clean";
    if (snapKeys.size === 0) status = "no_snapshot";
    else if (drifts.some((d) => d.status === "new_key" || d.status === "missing_key")) status = "new_key";
    else if (drifts.some((d) => d.status === "changed")) status = "changed";

    servicesMap[`${env}/${svc}`] = {
      service: svc,
      state: c.state,
      environment: env,
      liveKeyCount: liveKeys.size,
      snapshotKeyCount: snapKeys.size,
      lastSnapshotAt,
      status,
      drifts,
    };
  }

  // Also include services that exist in snapshots but have no running container
  for (const [env, services] of Object.entries(latestSnap)) {
    for (const [svc, keys] of Object.entries(services)) {
      const compositeKey = `${env}/${svc}`;
      if (!servicesMap[compositeKey]) {
        let lastSnapshotAt: string | null = null;
        for (const snap of Object.values(keys)) {
          if (!lastSnapshotAt || snap.capturedAt > new Date(lastSnapshotAt)) {
            lastSnapshotAt = snap.capturedAt.toISOString();
          }
        }
        const missingDrifts = Object.keys(keys).map((k) => ({
          key: k,
          status: "missing_key" as const,
        }));
        servicesMap[compositeKey] = {
          service: svc,
          state: "stopped",
          environment: env,
          liveKeyCount: 0,
          snapshotKeyCount: Object.keys(keys).length,
          lastSnapshotAt,
          status: "missing_key",
          drifts: missingDrifts,
        };
      }
    }
  }

  const services = Object.values(servicesMap);
  const allDrifts = services.flatMap((s) =>
    s.drifts.map((d) => ({ service: s.service, environment: s.environment, ...d }))
  );

  return json({ services, drifts: allDrifts, environments });
});
