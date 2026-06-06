"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/Shell";
import { useUI } from "@/components/Providers";
import { fetcher } from "@/lib/fetcher";

/* ── Types ─────────────────────────────────────────────────────────────── */
interface DepNode {
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
interface DepEdge {
  from: string;
  to: string;
  inferred: boolean;
  reason: "dependsOn" | "network";
}
interface DepMap {
  nodes: DepNode[];
  edges: DepEdge[];
  projects: string[];
}

/* ── Palette ────────────────────────────────────────────────────────────── */
const PROJECT_COLORS = [
  "#088395", "#7c3aed", "#0e7490", "#065f46", "#92400e",
  "#831843", "#374151", "#1e3a5f", "#4a1d96", "#064e3b",
];
function projectColor(project: string, projects: string[]): string {
  const i = projects.indexOf(project);
  return PROJECT_COLORS[i % PROJECT_COLORS.length] ?? "#374151";
}

/* ── State dot color ────────────────────────────────────────────────────── */
function stateDot(node: DepNode): string {
  if (node.health === "unhealthy") return "var(--warning)";
  if (node.state === "running") return "var(--success)";
  return "var(--danger)";
}

/* ── Layout: deterministic grid ─────────────────────────────────────────── */
const NODE_W = 160;
const NODE_H = 64;
const H_GAP = 80;
const V_GAP = 48;

interface Pos { x: number; y: number }

function computeLayout(nodes: DepNode[]): Map<string, Pos> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const pos = new Map<string, Pos>();
  nodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    pos.set(n.name, {
      x: 40 + col * (NODE_W + H_GAP),
      y: 40 + row * (NODE_H + V_GAP),
    });
  });
  return pos;
}

function svgSize(nodes: DepNode[]): { w: number; h: number } {
  if (!nodes.length) return { w: 400, h: 200 };
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.ceil(nodes.length / cols);
  return {
    w: 40 + cols * (NODE_W + H_GAP) - H_GAP + 40,
    h: 40 + rows * (NODE_H + V_GAP) - V_GAP + 40,
  };
}

/* ── Edge bezier between two node rects ─────────────────────────────────── */
function edgePath(from: Pos, to: Pos): string {
  const fx = from.x + NODE_W / 2;
  const fy = from.y + NODE_H / 2;
  const tx = to.x + NODE_W / 2;
  const ty = to.y + NODE_H / 2;
  const cx = (fx + tx) / 2;
  const cy = (fy + ty) / 2 - 20;
  return `M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}`;
}

/* ── Detail panel ────────────────────────────────────────────────────────── */
function Detail({ node, onClose }: { node: DepNode; onClose: () => void }) {
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 12 }}>
      <span style={{ color: "var(--text-muted)", minWidth: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--text-main)", wordBreak: "break-all" }}>{value}</span>
    </div>
  );

  return (
    <div style={{
      width: 300,
      flexShrink: 0,
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: 16,
      overflowY: "auto",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-main)" }}>{node.name}</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16 }}
        >
          ✕
        </button>
      </div>
      {row("State", <span style={{ color: stateDot(node), fontWeight: 600 }}>{node.state}</span>)}
      {node.health && row("Health", node.health)}
      {row("Image", `${node.image}:${node.tag}`)}
      {node.composeProject && row("Project", node.composeProject)}
      {node.composeService && row("Service", node.composeService)}
      {node.networks.length > 0 && row("Networks", node.networks.join(", "))}
      {node.ports.length > 0 && row("Ports", node.ports.map((p) =>
        p.publicPort ? `${p.publicPort}→${p.privatePort}/${p.type}` : `${p.privatePort}/${p.type}`
      ).join(", "))}
      {node.mounts.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Mounts</div>
          {node.mounts.map((m, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--text-main)", marginBottom: 2 }}>
              <span style={{ color: "var(--primary)" }}>{m.type}</span> {m.source} → {m.destination}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function Page() {
  const { lang } = useUI();
  const { data, error, isLoading } = useSWR<DepMap>("/api/containers/depmap", fetcher, {
    refreshInterval: 30_000,
  });

  const [filterProject, setFilterProject] = useState("__all__");
  const [filterState, setFilterState] = useState("all");
  const [selected, setSelected] = useState<DepNode | null>(null);

  const filtered = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    let nodes = data.nodes;
    if (filterProject !== "__all__") {
      nodes = nodes.filter((n) => n.composeProject === filterProject);
    }
    if (filterState !== "all") {
      nodes = nodes.filter((n) =>
        filterState === "running" ? n.state === "running" : n.state !== "running"
      );
    }
    const nameSet = new Set(nodes.map((n) => n.name));
    const edges = data.edges.filter((e) => nameSet.has(e.from) && nameSet.has(e.to));
    return { nodes, edges };
  }, [data, filterProject, filterState]);

  const layout = useMemo(() => computeLayout(filtered.nodes), [filtered.nodes]);
  const { w: svgW, h: svgH } = useMemo(() => svgSize(filtered.nodes), [filtered.nodes]);
  const projects = data?.projects ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <PageHeader
        title={lang === "fa" ? "نقشه وابستگی‌ها" : "Dependency Map"}
        desc={lang === "fa"
          ? "کانتینرهای داکر و وابستگی‌های آن‌ها — گروه‌بندی‌شده بر اساس استک کامپوز."
          : "Docker containers and their relationships — grouped by compose stack."}
      />

      {/* Filter bar */}
      <div style={{
        display: "flex",
        gap: 10,
        padding: "10px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        flexWrap: "wrap",
        alignItems: "center",
      }}>
        <select
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            color: "var(--text-main)",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 12,
          }}
        >
          <option value="__all__">{lang === "fa" ? "همه پروژه‌ها" : "All projects"}</option>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
          <option value="">{lang === "fa" ? "مستقل" : "Standalone"}</option>
        </select>

        <select
          value={filterState}
          onChange={(e) => setFilterState(e.target.value)}
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            color: "var(--text-main)",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 12,
          }}
        >
          <option value="all">{lang === "fa" ? "همه وضعیت‌ها" : "All states"}</option>
          <option value="running">{lang === "fa" ? "در حال اجرا" : "Running"}</option>
          <option value="stopped">{lang === "fa" ? "متوقف" : "Stopped"}</option>
        </select>

        <span style={{ fontSize: 11, color: "var(--text-muted)", marginInlineStart: "auto" }}>
          {filtered.nodes.length} {lang === "fa" ? "کانتینر" : "containers"} &middot; {filtered.edges.length} {lang === "fa" ? "لبه" : "edges"}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Canvas area */}
        <div style={{ flex: 1, overflow: "auto", padding: 12, position: "relative" }}>
          {isLoading && (
            <div style={{ padding: 40, color: "var(--text-muted)", fontSize: 13 }}>
              {lang === "fa" ? "در حال بارگذاری…" : "Loading…"}
            </div>
          )}
          {error && (
            <div style={{ padding: 40, color: "var(--danger)", fontSize: 13 }}>
              {lang === "fa" ? "خطا در بارگذاری داده" : "Error loading dependency map"}
            </div>
          )}
          {!isLoading && !error && filtered.nodes.length === 0 && (
            <div style={{
              margin: 40,
              padding: 40,
              textAlign: "center",
              border: "1px dashed var(--border)",
              borderRadius: 10,
              color: "var(--text-muted)",
              fontSize: 13,
            }}>
              {lang === "fa" ? "کانتینری یافت نشد" : "No containers found"}
            </div>
          )}
          {!isLoading && filtered.nodes.length > 0 && (
            <svg
              width={svgW}
              height={svgH}
              style={{ display: "block", minWidth: svgW }}
            >
              <defs>
                <marker
                  id="arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill="var(--text-muted)" />
                </marker>
                <marker
                  id="arrow-inferred"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill="var(--border)" />
                </marker>
              </defs>

              {/* Edges */}
              {filtered.edges.map((edge, i) => {
                const fp = layout.get(edge.from);
                const tp = layout.get(edge.to);
                if (!fp || !tp) return null;
                return (
                  <path
                    key={i}
                    d={edgePath(fp, tp)}
                    fill="none"
                    stroke={edge.inferred ? "var(--border)" : "var(--text-muted)"}
                    strokeWidth={edge.inferred ? 1 : 1.5}
                    strokeDasharray={edge.inferred ? "5,4" : undefined}
                    markerEnd={edge.inferred ? "url(#arrow-inferred)" : "url(#arrow)"}
                    opacity={0.7}
                  />
                );
              })}

              {/* Nodes */}
              {filtered.nodes.map((node) => {
                const pos = layout.get(node.name);
                if (!pos) return null;
                const borderColor = node.composeProject
                  ? projectColor(node.composeProject, projects)
                  : "#374151";
                const isSelected = selected?.name === node.name;

                return (
                  <g
                    key={node.name}
                    transform={`translate(${pos.x},${pos.y})`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(isSelected ? null : node)}
                  >
                    {/* Node rect */}
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={8}
                      fill="var(--bg-card)"
                      stroke={isSelected ? "var(--primary)" : borderColor}
                      strokeWidth={isSelected ? 2 : 1.5}
                    />
                    {/* Project color stripe on left */}
                    <rect
                      x={0}
                      y={0}
                      width={4}
                      height={NODE_H}
                      rx={4}
                      fill={borderColor}
                    />

                    {/* State dot */}
                    <circle
                      cx={NODE_W - 12}
                      cy={12}
                      r={5}
                      fill={stateDot(node)}
                    />

                    {/* Container name */}
                    <text
                      x={12}
                      y={24}
                      fontSize={11}
                      fontWeight="700"
                      fill="var(--text-main)"
                      style={{ userSelect: "none" }}
                    >
                      {node.name.length > 18 ? node.name.slice(0, 17) + "…" : node.name}
                    </text>

                    {/* image:tag */}
                    <text
                      x={12}
                      y={40}
                      fontSize={9.5}
                      fill="var(--text-muted)"
                      style={{ userSelect: "none" }}
                    >
                      {(`${node.image}:${node.tag}`).length > 22
                        ? (`${node.image}:${node.tag}`).slice(0, 21) + "…"
                        : `${node.image}:${node.tag}`}
                    </text>

                    {/* compose service label */}
                    {node.composeService && (
                      <text
                        x={12}
                        y={54}
                        fontSize={9}
                        fill={borderColor}
                        style={{ userSelect: "none" }}
                      >
                        {node.composeService.length > 22
                          ? node.composeService.slice(0, 21) + "…"
                          : node.composeService}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ padding: 12, overflowY: "auto" }}>
            <Detail node={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{
        display: "flex",
        gap: 16,
        padding: "8px 20px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
        fontSize: 11,
        color: "var(--text-muted)",
        flexWrap: "wrap",
        alignItems: "center",
      }}>
        <span style={{ fontWeight: 600, marginInlineEnd: 4 }}>
          {lang === "fa" ? "راهنما:" : "Legend:"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--success)" }} />
          {lang === "fa" ? "در حال اجرا" : "Running"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--danger)" }} />
          {lang === "fa" ? "متوقف" : "Stopped"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--warning)" }} />
          {lang === "fa" ? "ناسالم" : "Unhealthy"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={30} height={12} style={{ display: "inline" }}>
            <path d="M0,6 Q15,0 30,6" fill="none" stroke="var(--text-muted)" strokeWidth={1.5} />
          </svg>
          {lang === "fa" ? "وابستگی صریح" : "Explicit dep"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={30} height={12} style={{ display: "inline" }}>
            <path d="M0,6 Q15,0 30,6" fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="5,4" />
          </svg>
          {lang === "fa" ? "وابستگی استنتاجی / شبکه" : "Inferred / network"}
        </span>
      </div>
    </div>
  );
}
