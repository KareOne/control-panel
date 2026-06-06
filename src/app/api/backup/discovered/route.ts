import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { listVolumes, listContainers } from "@/lib/docker";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");

  const [containers, volumes] = await Promise.all([
    listContainers().catch(() => []),
    listVolumes().catch(() => []),
  ]);

  const usedVolumeNames = new Set<string>();
  for (const c of containers) {
    for (const m of c.mounts) {
      if (m.type === "volume") usedVolumeNames.add(m.source);
    }
  }

  const dbContainers = containers
    .filter((c) =>
      /(postgres|mysql|mariadb|mongo|redis|mssql|oracle|elastic|cassandra)/i.test(c.image)
    )
    .map((c) => ({
      id: c.id.slice(0, 12),
      name: c.name,
      image: c.image,
      tag: c.tag,
      state: c.state,
      dbType:
        c.image.match(/(postgres|mysql|mariadb|mongo|redis|mssql|elastic|cassandra)/i)?.[1]?.toLowerCase() ??
        "database",
    }));

  const allContainers = containers.map((c) => ({
    id: c.id.slice(0, 12),
    name: c.name,
    image: c.image,
    tag: c.tag,
    state: c.state,
  }));

  const volumeList = volumes.map((v) => ({
    name: v.name,
    driver: v.driver,
    mountpoint: v.mountpoint,
    createdAt: v.createdAt,
    inUse: usedVolumeNames.has(v.name),
  }));

  return json({ dbContainers, allContainers, volumes: volumeList });
});
