import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json } from "@/lib/api";
import { requireRole, audit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const Body = z.object({ owner: z.string().nullable() });

// Parses the notes string to extract owner and free-text parts.
// Owner is stored as the first line: "[OWNER:name]"
function parseNotes(raw: string | null): { owner: string | null; text: string } {
  if (!raw) return { owner: null, text: "" };
  const match = raw.match(/^\[OWNER:([^\]]*)\]\n?([\s\S]*)$/);
  if (match) return { owner: match[1] || null, text: match[2] };
  return { owner: null, text: raw };
}

function buildNotes(owner: string | null, text: string): string | null {
  const base = text.trim();
  if (!owner) return base || null;
  return base ? `[OWNER:${owner}]\n${base}` : `[OWNER:${owner}]`;
}

export const PATCH = handler(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    const u = await requireRole(req, "ENGINEER");
    const { id } = ctx.params;
    const ev = await prisma.alertEvent.findUnique({ where: { id } });
    if (!ev) throw new Response("Not found", { status: 404 });
    const { owner } = Body.parse(await req.json());
    const { text } = parseNotes(ev.notes);
    const updated = await prisma.alertEvent.update({
      where: { id },
      data: { notes: buildNotes(owner, text) },
    });
    await audit(u.id, "alerts.event.owner", id, { owner });
    return json({ event: updated });
  }
);
