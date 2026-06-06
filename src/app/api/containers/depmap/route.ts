import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { groupByCompose } from "@/lib/docker";

export const dynamic = "force-dynamic";

export interface DepNode {
  id: string;
  name: string;
  state: string;
  health: string | null;
  composeProject: string | null;
  composeService: string | null;
  image: string;
  tag: string;
  networks: string[];
  ports: { privatePort: number; publicPort?: number; type: string }[];
  mounts: { source: string; destination: string; type: string }[];
}

export interface DepEdge {
  from: string;
  to: string;
  inferred: boolean;
  reason: "dependsOn" | "network";
}

export interface DepMapPayload {
  nodes: DepNode[];
  edges: DepEdge[];
  projects: string[];
}

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");

  const { projects, ungrouped } = await groupByCompose();

  // Flatten all containers into a single list
  const allContainers = [
    ...projects.flatMap((p) => p.services.flatMap((s) => s.containers)),
    ...ungrouped,
  ];

  // Build nodes
  const nodes: DepNode[] = allContainers.map((c) => ({
    id: c.id,
    name: c.name,
    state: c.state,
    health: c.health,
    composeProject: c.composeProject,
    composeService: c.composeService,
    image: c.image,
    tag: c.tag,
    networks: c.networks,
    ports: c.ports.map((p) => ({
      privatePort: p.privatePort,
      publicPort: p.publicPort,
      type: p.type,
    })),
    mounts: c.mounts.map((m) => ({
      source: m.source,
      destination: m.destination,
      type: m.type,
    })),
  }));

  const edges: DepEdge[] = [];
  const edgeSet = new Set<string>();

  const addEdge = (from: string, to: string, inferred: boolean, reason: DepEdge["reason"]) => {
    const key = `${from}->${to}:${reason}`;
    if (!edgeSet.has(key) && from !== to) {
      edgeSet.add(key);
      edges.push({ from, to, inferred, reason });
    }
  };

  // Build name→container map for resolution
  const byName = new Map<string, (typeof allContainers)[0]>();
  for (const c of allContainers) byName.set(c.name, c);

  // Edges from dependsOn labels (per service in compose projects)
  for (const project of projects) {
    for (const svc of project.services) {
      for (const container of svc.containers) {
        for (const depServiceName of svc.dependsOn) {
          // Find any container whose composeService matches depServiceName in the same project
          const target = allContainers.find(
            (c) =>
              c.composeProject === project.project &&
              c.composeService === depServiceName
          );
          if (target) {
            addEdge(container.name, target.name, svc.dependsInferred, "dependsOn");
          }
        }
      }
    }
  }

  // Also add direct dependsOn from container labels (for ungrouped or when labels exist)
  for (const c of allContainers) {
    for (const dep of c.dependsOn) {
      // dep may be a service name or container name
      const target = byName.get(dep) || allContainers.find((x) => x.composeService === dep);
      if (target) {
        addEdge(c.name, target.name, false, "dependsOn");
      }
    }
  }

  // Edges for shared networks (containers on the same non-default network)
  const SKIP_NETWORKS = new Set(["bridge", "host", "none"]);
  const networkMap = new Map<string, string[]>(); // network → [containerName, ...]
  for (const c of allContainers) {
    for (const net of c.networks) {
      if (SKIP_NETWORKS.has(net)) continue;
      if (!networkMap.has(net)) networkMap.set(net, []);
      networkMap.get(net)!.push(c.name);
    }
  }
  for (const [, members] of Array.from(networkMap)) {
    if (members.length < 2) continue;
    // Add edges only between containers in different compose projects (or ungrouped)
    // to avoid cluttering same-project containers that already have dependsOn edges
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = byName.get(members[i]);
        const b = byName.get(members[j]);
        if (!a || !b) continue;
        if (a.composeProject && a.composeProject === b.composeProject) continue;
        addEdge(a.name, b.name, true, "network");
      }
    }
  }

  const projectNames = projects.map((p) => p.project);

  return json({ nodes, edges, projects: projectNames } satisfies DepMapPayload);
});
