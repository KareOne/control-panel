import { prisma } from "./prisma";

export interface GateResult {
  allowed: boolean;
  reasons: string[];
  details: {
    testPassRate: number | null;
    failedTests: number;
    p0Incomplete: number;
    gateEnabled: boolean;
  };
}

export async function checkQualityGate(
  environment: string,
  commitSha?: string | null
): Promise<GateResult> {
  const gate = await prisma.qualityGate.findUnique({
    where: { environment: environment as any },
  });

  if (!gate || !gate.enabled) {
    return { allowed: true, reasons: [], details: { testPassRate: null, failedTests: 0, p0Incomplete: 0, gateEnabled: false } };
  }

  const reasons: string[] = [];
  let testPassRate: number | null = null;
  let failedTests = 0;

  // Check latest test run
  const run = await prisma.testRun.findFirst({
    where: commitSha ? { commitSha } : {},
    orderBy: { startedAt: "desc" },
    select: { total: true, passed: true, failed: true },
  });

  if (run && run.total > 0) {
    testPassRate = run.passed / run.total;
    failedTests = run.failed;

    if (gate.blockOnFailing && run.failed > 0) {
      reasons.push(
        `${run.failed} test${run.failed === 1 ? "" : "s"} currently failing.`
      );
    } else if (!gate.blockOnFailing && testPassRate < gate.minPassRate) {
      reasons.push(
        `Test pass rate ${(testPassRate * 100).toFixed(0)}% is below the required ${(gate.minPassRate * 100).toFixed(0)}%.`
      );
    }
  }

  // Check P0 checklist items for this environment
  let p0Incomplete = 0;
  if (gate.requireP0Checks) {
    const checklist = await prisma.releaseChecklist.findFirst({
      where: { environment: environment as any },
      orderBy: { createdAt: "desc" },
      include: {
        items: { where: { priority: "P0" } },
      },
    });
    if (checklist) {
      const incomplete = checklist.items.filter((i) => i.status !== "PASSING");
      p0Incomplete = incomplete.length;
      if (incomplete.length > 0) {
        reasons.push(
          `${incomplete.length} P0 QA checklist item${incomplete.length === 1 ? "" : "s"} not passing for ${environment}.`
        );
      }
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    details: { testPassRate, failedTests, p0Incomplete, gateEnabled: true },
  };
}
