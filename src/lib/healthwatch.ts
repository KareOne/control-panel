import { prisma } from "./prisma";
import { raiseAlert } from "./alerts";
import { hostExec } from "./server";

export interface HealthWatchConfig {
  healthPath: string;
  watchMinutes: number;
  intervalSec: number;
  failThreshold: number;
}

export const DEFAULT_HEALTH_WATCH: HealthWatchConfig = {
  healthPath: "/health",
  watchMinutes: 5,
  intervalSec: 30,
  failThreshold: 3,
};

/** Fire-and-forget: starts a background health watch for a completed DeployRun. */
export function startHealthWatch(
  deployRunId: string,
  greenPort: number,
  cfg: HealthWatchConfig,
  logFn: (s: string) => Promise<void>,
  onDegrade?: () => Promise<void>
): void {
  runWatch(deployRunId, greenPort, cfg, logFn, onDegrade).catch(async (err) => {
    logFn(`[health-watch] fatal: ${(err as Error).message}`).catch(() => {});
    prisma.deployRun
      .update({ where: { id: deployRunId }, data: { healthStatus: "error" } })
      .catch(() => {});
  });
}

async function runWatch(
  deployRunId: string,
  greenPort: number,
  cfg: HealthWatchConfig,
  logFn: (s: string) => Promise<void>,
  onDegrade?: () => Promise<void>
): Promise<void> {
  const url = `http://127.0.0.1:${greenPort}${cfg.healthPath}`;

  await prisma.deployRun.update({
    where: { id: deployRunId },
    data: { healthStatus: "watching", healthPort: greenPort },
  });
  await logFn(`[health-watch] started — watching ${url} for ${cfg.watchMinutes} min`);

  const deadline = Date.now() + cfg.watchMinutes * 60 * 1000;
  let fails = 0;

  while (Date.now() < deadline) {
    const t0 = Date.now();
    let ok = false;
    let httpStatus: number | null = null;
    let error: string | null = null;

    try {
      const { stdout } = await hostExec(
        `curl -sf -o /dev/null -w "%{http_code}" --max-time 5 "${url}"`,
        8000
      );
      httpStatus = parseInt(stdout.trim(), 10);
      ok = httpStatus >= 200 && httpStatus < 300;
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }

    const durationMs = Date.now() - t0;

    await prisma.postDeployCheck.create({
      data: { deployRunId, url, httpStatus, durationMs, ok, error },
    });

    if (ok) {
      fails = 0;
      await logFn(`[health-watch] ${httpStatus} OK (${durationMs}ms)`);
    } else {
      fails++;
      const detail = error ?? String(httpStatus);
      await logFn(`[health-watch] FAIL ${fails}/${cfg.failThreshold}: ${detail}`);

      if (fails >= cfg.failThreshold) {
        await prisma.deployRun.update({
          where: { id: deployRunId },
          data: { healthStatus: "degraded" },
        });
        await raiseAlert({
          source: "health-watch",
          severity: "CRITICAL",
          title: `Post-deploy health degraded after ${fails} failures`,
          payload: { deployRunId, url, fails, lastError: error },
        });
        if (onDegrade) {
          await logFn(`[health-watch] DEGRADED — triggering auto-rollback…`);
          try {
            await onDegrade();
            await logFn(`[health-watch] auto-rollback completed`);
          } catch (rbErr) {
            await logFn(`[health-watch] auto-rollback FAILED: ${(rbErr as Error).message}`);
          }
        } else {
          await logFn(
            `[health-watch] DEGRADED after ${fails} consecutive failures — alert raised, manual rollback recommended`
          );
        }
        return;
      }
    }

    const elapsed = Date.now() - t0;
    const wait = Math.max(0, cfg.intervalSec * 1000 - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }

  await prisma.deployRun.update({
    where: { id: deployRunId },
    data: { healthStatus: "healthy" },
  });
  await logFn(`[health-watch] watch period complete — service HEALTHY`);
}
