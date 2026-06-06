import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { hostExec } from "@/lib/server";
import { getGitConfig } from "@/lib/git";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const url = new URL(req.url);
  const from = url.searchParams.get("from")?.trim() || "";
  const to = url.searchParams.get("to")?.trim() || "";

  if (!from || !to) {
    return json({ error: "Both `from` and `to` query params are required." }, { status: 400 });
  }

  const config = await getGitConfig();
  const repoPath = config.repoPath?.trim();
  if (!repoPath) {
    return json({ error: "No git repository configured. Set repoPath in Settings." }, { status: 409 });
  }

  try {
    const logCmd = `git -C ${JSON.stringify(repoPath)} log ${JSON.stringify(from)}..${JSON.stringify(to)} --oneline --no-merges --pretty=format:"%H\t%an\t%ai\t%s"`;
    const shortstatCmd = `git -C ${JSON.stringify(repoPath)} diff --shortstat ${JSON.stringify(from)}..${JSON.stringify(to)}`;

    const [logOut, statOut] = await Promise.all([
      hostExec(logCmd).then((r) => r.stdout),
      hostExec(shortstatCmd).then((r) => r.stdout).catch(() => ""),
    ]);

    const commits = logOut
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [hash, author, date, ...rest] = l.split("\t");
        return { hash: hash.slice(0, 8), fullHash: hash, author, date, message: rest.join("\t") };
      });

    const filesMatch = /(\d+) file/.exec(statOut);
    const insMatch = /(\d+) insertion/.exec(statOut);
    const delMatch = /(\d+) deletion/.exec(statOut);

    const stat = {
      filesChanged: filesMatch ? Number(filesMatch[1]) : 0,
      insertions: insMatch ? Number(insMatch[1]) : 0,
      deletions: delMatch ? Number(delMatch[1]) : 0,
    };

    return json({ from, to, commits, stat });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ from, to, commits: [], stat: { filesChanged: 0, insertions: 0, deletions: 0 }, error: msg });
  }
});
