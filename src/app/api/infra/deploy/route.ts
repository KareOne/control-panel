import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole, audit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createJob, runJob } from "@/lib/jobs";
import { hostExec } from "@/lib/server";

export const dynamic = "force-dynamic";

const MN_DIR = "/opt/marketnavigator";
const COMPOSE_FILE = `${MN_DIR}/docker-compose.yml`;

// Detect which compose file exists on the host
async function resolveComposeFile(): Promise<string> {
  try {
    const { stdout } = await hostExec(
      `ls ${MN_DIR}/docker-compose.prod.yml ${MN_DIR}/docker-compose.yml 2>/dev/null | head -1`,
      5000
    );
    const f = stdout.trim();
    return f || COMPOSE_FILE;
  } catch {
    return COMPOSE_FILE;
  }
}

// Run a command on the host and stream its output to the job log
async function runHostStreaming(
  cmd: string,
  logFn: (line: string) => Promise<void>,
  timeoutMs = 300000
): Promise<void> {
  // hostExec waits for completion but captures full stdout+stderr together
  // For long-running docker builds we chunk output every few seconds
  let settled = false;
  const resultP = hostExec(cmd, timeoutMs);

  // While waiting for the command, periodically log a heartbeat so the UI isn't blank
  const heartbeatId = setInterval(async () => {
    if (!settled) await logFn("…building (this may take a few minutes)…");
  }, 15000);

  try {
    const { stdout, stderr } = await resultP;
    settled = true;
    clearInterval(heartbeatId);
    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    for (const line of combined.split("\n")) {
      await logFn(line);
    }
  } catch (e: any) {
    settled = true;
    clearInterval(heartbeatId);
    const msg = e?.stderr || e?.stdout || e?.message || String(e);
    for (const line of msg.split("\n")) {
      await logFn(`ERROR: ${line}`);
    }
    throw new Error(msg.slice(0, 400));
  }
}

export const POST = handler(async (req: NextRequest) => {
  const u = await requireRole(req, "ADMIN");
  const body = await req.json().catch(() => ({}));
  const services: string[] = Array.isArray(body?.services) ? body.services : [];
  const dryRun: boolean = !!body?.dryRun;

  // One MN deploy at a time
  const inProgress = await prisma.backgroundJob.findFirst({
    where: { kind: "infra.deploy", state: { in: ["QUEUED", "RUNNING"] } },
  });
  if (inProgress) {
    return json({ error: "A deploy is already in progress", jobId: inProgress.id }, { status: 409 });
  }

  const job = await createJob({
    kind: "infra.deploy",
    label: dryRun ? "MN infra dry-run" : `MN infra deploy${services.length ? ` (${services.join(",")})` : ""}`,
    params: { services, dryRun },
    createdById: u.id,
  });

  runJob(job.id, async (ctx) => {
    await ctx.log(`=== Market Navigator deploy started ===`);
    await ctx.log(`Dir: ${MN_DIR}`);
    if (dryRun) await ctx.log(`Mode: DRY RUN (build only, no restart)`);
    await ctx.log(`Triggered by: ${u.email}`);
    await ctx.log("");

    // Step 1: git pull
    await ctx.log(">>> git pull origin main");
    ctx.progress(5);
    await runHostStreaming(
      `git -C ${MN_DIR} pull origin main 2>&1`,
      ctx.log,
      60000
    );
    ctx.progress(30);

    // Step 2: resolve compose file
    const composeFile = await resolveComposeFile();
    await ctx.log(`>>> Using compose file: ${composeFile}`);

    // Step 3: build / up
    if (dryRun) {
      await ctx.log(">>> docker compose build --no-cache (dry run)");
      const svcArgs = services.length ? services.join(" ") : "";
      await runHostStreaming(
        `docker compose -f ${composeFile} build --no-cache ${svcArgs} 2>&1`,
        ctx.log,
        600000
      );
      ctx.progress(100);
      await ctx.log("=== DRY RUN complete — containers NOT restarted ===");
    } else {
      const svcArgs = services.length ? services.join(" ") : "";
      await ctx.log(`>>> docker compose up -d --build ${svcArgs}`);
      await runHostStreaming(
        `docker compose -f ${composeFile} up -d --build ${svcArgs} 2>&1`,
        ctx.log,
        600000
      );
      ctx.progress(85);

      // Clean up dangling images
      await ctx.log(">>> docker image prune -f");
      await runHostStreaming(`docker image prune -f 2>&1`, ctx.log, 30000);
      ctx.progress(95);

      // Final status
      await ctx.log(">>> docker compose ps");
      await runHostStreaming(
        `docker compose -f ${composeFile} ps 2>&1`,
        ctx.log,
        15000
      );
      ctx.progress(100);
      await ctx.log("=== Deploy complete ===");
    }

    return { dryRun, services };
  });

  await audit(u.id, "infra.deploy.triggered", job.id, { dryRun, services });
  return json({ jobId: job.id }, { status: 202 });
});

// List recent MN deploy jobs
export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const jobs = await prisma.backgroundJob.findMany({
    where: { kind: "infra.deploy" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      label: true,
      state: true,
      progress: true,
      error: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      params: true,
      createdById: true,
    },
  });

  // Enrich with user emails in one query
  const seen = new Set<string>();
  const userIds: string[] = [];
  for (const j of jobs) {
    if (j.createdById && !seen.has(j.createdById)) {
      seen.add(j.createdById);
      userIds.push(j.createdById);
    }
  }
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.email]));

  const enriched = jobs.map(({ createdById, ...j }) => ({
    ...j,
    createdBy: createdById ? { email: userMap[createdById] ?? createdById } : null,
  }));

  return json({ jobs: enriched });
});
