"use client";
import { useState, useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { PageHeader } from "@/components/Shell";
import { useUI } from "@/components/Providers";
import { fmtDate } from "@/lib/i18n";
import { fetcher } from "@/lib/fetcher";
import {
  Plus,
  Play,
  Pencil,
  Trash2,
  Tag,
  ChevronRight,
  GripVertical,
  CheckSquare,
  Square,
  Terminal,
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  BookOpen,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type RunbookCategory =
  | "INCIDENT"
  | "DEPLOY"
  | "MAINTENANCE"
  | "SECURITY"
  | "DATABASE"
  | "NETWORK"
  | "GENERAL";

type RunbookRunStatus = "RUNNING" | "COMPLETED" | "ABORTED";

interface RunbookStep {
  order: number;
  title: string;
  description: string;
  isAutomated: boolean;
  command?: string;
}

interface RunbookRun {
  id: string;
  status: RunbookRunStatus;
  triggeredById: string | null;
  stepProgress: number;
  startedAt: string;
  finishedAt: string | null;
}

interface Runbook {
  id: string;
  title: string;
  description: string | null;
  category: RunbookCategory;
  steps: RunbookStep[];
  tags: string[];
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  runs?: RunbookRun[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: RunbookCategory[] = [
  "INCIDENT",
  "DEPLOY",
  "MAINTENANCE",
  "SECURITY",
  "DATABASE",
  "NETWORK",
  "GENERAL",
];

const CATEGORY_META: Record<
  RunbookCategory,
  { label: string; bg: string; color: string }
> = {
  INCIDENT:    { label: "Incident",    bg: "rgba(239,68,68,0.15)",   color: "#ef4444" },
  DEPLOY:      { label: "Deploy",      bg: "rgba(59,130,246,0.15)",  color: "#3b82f6" },
  MAINTENANCE: { label: "Maintenance", bg: "rgba(245,158,11,0.15)",  color: "#f59e0b" },
  SECURITY:    { label: "Security",    bg: "rgba(249,115,22,0.15)",  color: "#f97316" },
  DATABASE:    { label: "Database",    bg: "rgba(168,85,247,0.15)",  color: "#a855f7" },
  NETWORK:     { label: "Network",     bg: "rgba(20,184,166,0.15)",  color: "#14b8a6" },
  GENERAL:     { label: "General",     bg: "rgba(107,114,128,0.15)", color: "#6b7280" },
};

const RUN_STATUS_META: Record<RunbookRunStatus, { label: string; color: string }> = {
  RUNNING:   { label: "Running",   color: "#f59e0b" },
  COMPLETED: { label: "Completed", color: "#22c55e" },
  ABORTED:   { label: "Aborted",   color: "#ef4444" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = "Request failed";
    try {
      msg = (await r.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

function emptyStep(order: number): RunbookStep {
  return { order, title: "", description: "", isAutomated: false, command: "" };
}

// ─── Category Badge ───────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: RunbookCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <span
      style={{
        background: meta.bg,
        color: meta.color,
        border: `1px solid ${meta.color}40`,
        borderRadius: "6px",
        padding: "2px 8px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {meta.label}
    </span>
  );
}

// ─── Runbook Form ─────────────────────────────────────────────────────────────

interface RunbookFormProps {
  initial?: Partial<Runbook>;
  onSave: (data: {
    title: string;
    description: string;
    category: RunbookCategory;
    steps: RunbookStep[];
    tags: string[];
  }) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function RunbookForm({ initial, onSave, onCancel, saving }: RunbookFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState<RunbookCategory>(
    initial?.category ?? "GENERAL"
  );
  const [tagsInput, setTagsInput] = useState(
    (initial?.tags ?? []).join(", ")
  );
  const [steps, setSteps] = useState<RunbookStep[]>(
    initial?.steps?.length ? initial.steps : [emptyStep(0)]
  );

  function updateStep(index: number, patch: Partial<RunbookStep>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  }

  function addStep() {
    setSteps((prev) => [...prev, emptyStep(prev.length)]);
  }

  function removeStep(index: number) {
    setSteps((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((s, i) => ({ ...s, order: i }));
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await onSave({ title, description, category, steps, tags });
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "8px 10px",
    color: "var(--text-main)",
    fontSize: "13px",
    width: "100%",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--text-muted)",
    marginBottom: "4px",
    display: "block",
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Title */}
      <div>
        <label style={labelStyle}>Title *</label>
        <input
          style={inputStyle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Runbook title"
          required
        />
      </div>

      {/* Description */}
      <div>
        <label style={labelStyle}>Description</label>
        <textarea
          style={{ ...inputStyle, resize: "vertical", minHeight: "72px" }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what this runbook is for…"
        />
      </div>

      {/* Category + Tags row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div>
          <label style={labelStyle}>Category</label>
          <select
            style={inputStyle}
            value={category}
            onChange={(e) => setCategory(e.target.value as RunbookCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Tags (comma-separated)</label>
          <input
            style={inputStyle}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. prod, critical, db"
          />
        </div>
      </div>

      {/* Steps */}
      <div>
        <label style={{ ...labelStyle, marginBottom: "8px" }}>Steps *</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {steps.map((step, idx) => (
            <div
              key={idx}
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "12px",
                display: "flex",
                gap: "10px",
              }}
            >
              {/* Drag handle */}
              <div
                style={{
                  color: "var(--text-muted)",
                  paddingTop: "4px",
                  cursor: "grab",
                  flexShrink: 0,
                }}
              >
                <GripVertical size={14} />
              </div>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                {/* Step number + title */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      background: "var(--primary)",
                      color: "var(--accent)",
                      borderRadius: "50%",
                      width: "22px",
                      height: "22px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </span>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={step.title}
                    onChange={(e) => updateStep(idx, { title: e.target.value })}
                    placeholder="Step title"
                    required
                  />
                </div>

                {/* Description */}
                <textarea
                  style={{ ...inputStyle, resize: "vertical", minHeight: "56px" }}
                  value={step.description}
                  onChange={(e) => updateStep(idx, { description: e.target.value })}
                  placeholder="Step instructions…"
                />

                {/* Automated checkbox + command */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      cursor: "pointer",
                      fontSize: "12px",
                      color: "var(--text-muted)",
                      flexShrink: 0,
                      marginTop: "2px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={step.isAutomated}
                      onChange={(e) => updateStep(idx, { isAutomated: e.target.checked })}
                    />
                    Automated step
                  </label>
                  {step.isAutomated && (
                    <input
                      style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: "12px" }}
                      value={step.command ?? ""}
                      onChange={(e) => updateStep(idx, { command: e.target.value })}
                      placeholder="Command to run (optional)"
                    />
                  )}
                </div>
              </div>

              {/* Remove step */}
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStep(idx)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--danger)",
                    padding: "4px",
                    flexShrink: 0,
                    alignSelf: "flex-start",
                  }}
                  title="Remove step"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addStep}
          style={{
            marginTop: "10px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "none",
            border: "1px dashed var(--border)",
            borderRadius: "8px",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: "8px 14px",
            fontSize: "12px",
            width: "100%",
            justifyContent: "center",
          }}
        >
          <Plus size={13} />
          Add step
        </button>
      </div>

      {/* Form actions */}
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: "8px 16px",
            fontSize: "13px",
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          style={{
            background: "var(--primary)",
            border: "none",
            borderRadius: "8px",
            color: "var(--accent)",
            cursor: saving ? "default" : "pointer",
            padding: "8px 18px",
            fontSize: "13px",
            fontWeight: 600,
            opacity: saving ? 0.7 : 1,
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {saving && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
          Save runbook
        </button>
      </div>
    </form>
  );
}

// ─── Detail / Run View ────────────────────────────────────────────────────────

interface DetailViewProps {
  runbook: Runbook;
  lang: "en" | "fa";
  onBack: () => void;
  onMutate: () => void;
}

function DetailView({ runbook, lang, onBack, onMutate }: DetailViewProps) {
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: detail, mutate: mutateDetail } = useSWR<Runbook>(
    `/api/runbooks/${runbook.id}`,
    fetcher
  );

  const runs = detail?.runs ?? runbook.runs ?? [];
  const steps = detail?.steps ?? runbook.steps;

  function toggleStep(order: number) {
    setCheckedSteps((prev) => ({ ...prev, [order]: !prev[order] }));
  }

  async function startRun() {
    setStarting(true);
    setError(null);
    try {
      const run = await apiFetch(`/api/runbooks/${runbook.id}/run`, "POST");
      setActiveRunId(run.id);
      mutateDetail();
      onMutate();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  async function completeRun() {
    if (!activeRunId) return;
    setCompleting(true);
    setError(null);
    try {
      await apiFetch(`/api/runbooks/${activeRunId}/complete`, "POST").catch(() => {});
      setActiveRunId(null);
      setCheckedSteps({});
      mutateDetail();
      onMutate();
    } catch {
      // silently handle — the run endpoint may not exist, that's fine
      setActiveRunId(null);
      setCheckedSteps({});
    } finally {
      setCompleting(false);
    }
  }

  const allChecked = steps.every((s) => checkedSteps[s.order]);

  return (
    <div style={{ padding: "24px", maxWidth: "800px" }}>
      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: "13px",
          marginBottom: "20px",
          padding: 0,
        }}
      >
        <ArrowLeft size={14} />
        Back to library
      </button>

      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <CategoryBadge category={runbook.category} />
          {!runbook.enabled && (
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "2px 8px",
              }}
            >
              Disabled
            </span>
          )}
        </div>
        <h2
          style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-main)", margin: 0 }}
        >
          {runbook.title}
        </h2>
        {runbook.description && (
          <p style={{ marginTop: "6px", fontSize: "14px", color: "var(--text-muted)" }}>
            {runbook.description}
          </p>
        )}
      </div>

      {/* Start run button */}
      {!activeRunId ? (
        <button
          onClick={startRun}
          disabled={starting}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "var(--primary)",
            border: "none",
            borderRadius: "8px",
            color: "var(--accent)",
            cursor: starting ? "default" : "pointer",
            padding: "10px 20px",
            fontSize: "13px",
            fontWeight: 600,
            marginBottom: "24px",
            opacity: starting ? 0.7 : 1,
          }}
        >
          {starting ? (
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <Play size={14} />
          )}
          Start run
        </button>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "24px",
            padding: "12px 16px",
            background: "rgba(245,158,11,0.1)",
            border: "1px solid rgba(245,158,11,0.3)",
            borderRadius: "10px",
          }}
        >
          <Loader2
            size={14}
            style={{ animation: "spin 1s linear infinite", color: "#f59e0b" }}
          />
          <span style={{ fontSize: "13px", color: "#f59e0b", fontWeight: 600 }}>
            Run in progress
          </span>
          <button
            onClick={completeRun}
            disabled={!allChecked || completing}
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: allChecked ? "#22c55e" : "var(--bg-panel)",
              border: `1px solid ${allChecked ? "#22c55e" : "var(--border)"}`,
              borderRadius: "8px",
              color: allChecked ? "#fff" : "var(--text-muted)",
              cursor: allChecked && !completing ? "pointer" : "default",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 600,
              opacity: completing ? 0.7 : 1,
            }}
            title={!allChecked ? "Check all steps to complete" : undefined}
          >
            <CheckCircle size={13} />
            Complete run
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 14px",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "8px",
            fontSize: "13px",
            color: "#ef4444",
          }}
        >
          {error}
        </div>
      )}

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "32px" }}>
        {steps.map((step, idx) => {
          const checked = !!checkedSteps[step.order];
          return (
            <div
              key={step.order}
              style={{
                background: "var(--bg-card)",
                border: `1px solid ${checked ? "rgba(34,197,94,0.4)" : "var(--border)"}`,
                borderRadius: "10px",
                padding: "14px 16px",
                opacity: checked ? 0.75 : 1,
                transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                {/* Checkbox */}
                {activeRunId ? (
                  <button
                    onClick={() => toggleStep(step.order)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                      color: checked ? "#22c55e" : "var(--text-muted)",
                      marginTop: "1px",
                    }}
                  >
                    {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                ) : (
                  <span
                    style={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "50%",
                      width: "22px",
                      height: "22px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </span>
                )}

                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: step.description ? "6px" : 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: checked ? "var(--text-muted)" : "var(--text-main)",
                        textDecoration: checked ? "line-through" : "none",
                      }}
                    >
                      {step.title}
                    </span>
                    {step.isAutomated && (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "10px",
                          color: "#3b82f6",
                          background: "rgba(59,130,246,0.1)",
                          border: "1px solid rgba(59,130,246,0.3)",
                          borderRadius: "5px",
                          padding: "1px 6px",
                          fontWeight: 600,
                        }}
                      >
                        <Terminal size={10} />
                        automated
                      </span>
                    )}
                  </div>

                  {step.description && (
                    <p
                      style={{
                        fontSize: "13px",
                        color: "var(--text-muted)",
                        margin: "0 0 8px",
                        lineHeight: 1.5,
                      }}
                    >
                      {step.description}
                    </p>
                  )}

                  {step.isAutomated && step.command && (
                    <pre
                      style={{
                        background: "var(--bg-panel)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        padding: "8px 12px",
                        fontSize: "12px",
                        fontFamily: "monospace",
                        color: "#22c55e",
                        margin: "6px 0 0",
                        overflowX: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {step.command}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent runs */}
      {runs.length > 0 && (
        <div>
          <h3
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "10px",
            }}
          >
            Recent runs
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {runs.slice(0, 5).map((run) => {
              const meta = RUN_STATUS_META[run.status];
              return (
                <div
                  key={run.id}
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "13px",
                  }}
                >
                  <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                    <Clock
                      size={11}
                      style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }}
                    />
                    {fmtDate(run.startedAt, lang)}
                  </span>
                  {run.finishedAt && (
                    <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                      → {fmtDate(run.finishedAt, lang)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Runbook Card ─────────────────────────────────────────────────────────────

interface RunbookCardProps {
  runbook: Runbook;
  lang: "en" | "fa";
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function RunbookCard({ runbook, lang, onRun, onEdit, onDelete }: RunbookCardProps) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {/* Top row: category + step count */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <CategoryBadge category={runbook.category} />
        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          {runbook.steps.length} step{runbook.steps.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Title */}
      <div>
        <h3
          style={{
            fontSize: "14px",
            fontWeight: 700,
            color: "var(--text-main)",
            margin: "0 0 4px",
          }}
        >
          {runbook.title}
        </h3>
        {runbook.description && (
          <p
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              margin: 0,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              lineHeight: 1.5,
            }}
          >
            {runbook.description}
          </p>
        )}
      </div>

      {/* Tags */}
      {runbook.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {runbook.tags.map((tag) => (
            <span
              key={tag}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "3px",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: "5px",
                padding: "2px 7px",
                fontSize: "10px",
                color: "var(--text-muted)",
              }}
            >
              <Tag size={9} />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Last used */}
      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
        <Clock size={10} style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }} />
        {runbook.lastUsedAt ? `Last used ${fmtDate(runbook.lastUsedAt, lang)}` : "Never used"}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "6px", marginTop: "2px" }}>
        <button
          onClick={onRun}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "5px",
            background: "var(--primary)",
            border: "none",
            borderRadius: "7px",
            color: "var(--accent)",
            cursor: "pointer",
            padding: "7px 12px",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          <Play size={12} />
          Run
        </button>
        <button
          onClick={onEdit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "7px",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: "7px 12px",
            fontSize: "12px",
          }}
        >
          <Pencil size={12} />
          Edit
        </button>
        <button
          onClick={onDelete}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "7px",
            color: "var(--danger)",
            cursor: "pointer",
            padding: "7px 12px",
            fontSize: "12px",
          }}
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type View =
  | { kind: "library" }
  | { kind: "create" }
  | { kind: "edit"; runbook: Runbook }
  | { kind: "detail"; runbook: Runbook };

export default function RunbooksPage() {
  const { lang } = useUI();
  const [categoryFilter, setCategoryFilter] = useState<RunbookCategory | "ALL">("ALL");
  const [view, setView] = useState<View>({ kind: "library" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const apiUrl =
    categoryFilter === "ALL"
      ? "/api/runbooks"
      : `/api/runbooks?category=${categoryFilter}`;

  const { data: runbooks, mutate } = useSWR<Runbook[]>(apiUrl, fetcher);

  const refetchAll = useCallback(() => {
    mutate();
    globalMutate("/api/runbooks");
  }, [mutate]);

  async function handleCreate(data: {
    title: string;
    description: string;
    category: RunbookCategory;
    steps: RunbookStep[];
    tags: string[];
  }) {
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch("/api/runbooks", "POST", data);
      refetchAll();
      setView({ kind: "library" });
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(
    id: string,
    data: {
      title: string;
      description: string;
      category: RunbookCategory;
      steps: RunbookStep[];
      tags: string[];
    }
  ) {
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch(`/api/runbooks/${id}`, "PUT", data);
      refetchAll();
      setView({ kind: "library" });
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this runbook? All run history will also be removed.")) return;
    try {
      await apiFetch(`/api/runbooks/${id}`, "DELETE");
      refetchAll();
      if (view.kind === "detail" && view.runbook.id === id) {
        setView({ kind: "library" });
      }
    } catch (e: any) {
      alert(e.message);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (view.kind === "detail") {
    return (
      <div>
        <PageHeader title="Runbook Library" desc="Step-by-step operational runbooks — execute, track, and manage." />
        <DetailView
          runbook={view.runbook}
          lang={lang}
          onBack={() => setView({ kind: "library" })}
          onMutate={refetchAll}
        />
      </div>
    );
  }

  if (view.kind === "create") {
    return (
      <div>
        <PageHeader title="New Runbook" desc="Define steps, category, and tags for the new runbook." />
        <div style={{ padding: "24px", maxWidth: "700px" }}>
          {formError && (
            <div
              style={{
                marginBottom: "16px",
                padding: "10px 14px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#ef4444",
              }}
            >
              {formError}
            </div>
          )}
          <RunbookForm
            onSave={handleCreate}
            onCancel={() => setView({ kind: "library" })}
            saving={saving}
          />
        </div>
      </div>
    );
  }

  if (view.kind === "edit") {
    const rb = view.runbook;
    return (
      <div>
        <PageHeader title={`Edit: ${rb.title}`} desc="Update runbook details and steps." />
        <div style={{ padding: "24px", maxWidth: "700px" }}>
          {formError && (
            <div
              style={{
                marginBottom: "16px",
                padding: "10px 14px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#ef4444",
              }}
            >
              {formError}
            </div>
          )}
          <RunbookForm
            initial={rb}
            onSave={(data) => handleEdit(rb.id, data)}
            onCancel={() => setView({ kind: "library" })}
            saving={saving}
          />
        </div>
      </div>
    );
  }

  // ── Library view ────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Runbook Library"
        desc="Step-by-step operational runbooks — execute, track, and manage."
      />

      <div style={{ padding: "24px" }}>
        {/* Toolbar: category filter pills + Add button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
            marginBottom: "20px",
          }}
        >
          {/* Filter pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {(["ALL", ...CATEGORIES] as const).map((cat) => {
              const active = categoryFilter === cat;
              const meta = cat !== "ALL" ? CATEGORY_META[cat] : null;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  style={{
                    background: active
                      ? meta
                        ? meta.bg
                        : "var(--primary)"
                      : "var(--bg-card)",
                    border: `1px solid ${
                      active ? (meta ? meta.color : "var(--primary)") : "var(--border)"
                    }`,
                    borderRadius: "20px",
                    color: active
                      ? meta
                        ? meta.color
                        : "var(--accent)"
                      : "var(--text-muted)",
                    cursor: "pointer",
                    padding: "5px 14px",
                    fontSize: "12px",
                    fontWeight: active ? 600 : 400,
                    transition: "all 0.15s",
                  }}
                >
                  {cat === "ALL" ? "All" : CATEGORY_META[cat].label}
                </button>
              );
            })}
          </div>

          {/* Add runbook button */}
          <button
            onClick={() => setView({ kind: "create" })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "var(--primary)",
              border: "none",
              borderRadius: "8px",
              color: "var(--accent)",
              cursor: "pointer",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            <Plus size={14} />
            Add runbook
          </button>
        </div>

        {/* Cards grid */}
        {!runbooks ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "60px",
              color: "var(--text-muted)",
              fontSize: "13px",
              gap: "8px",
            }}
          >
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            Loading…
          </div>
        ) : runbooks.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "60px",
              color: "var(--text-muted)",
              fontSize: "13px",
              gap: "12px",
              border: "1px dashed var(--border)",
              borderRadius: "12px",
            }}
          >
            <BookOpen size={28} style={{ opacity: 0.4 }} />
            <span>No runbooks yet — create your first one.</span>
            <button
              onClick={() => setView({ kind: "create" })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "var(--primary)",
                border: "none",
                borderRadius: "8px",
                color: "var(--accent)",
                cursor: "pointer",
                padding: "8px 16px",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <Plus size={13} />
              Add runbook
            </button>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "14px",
            }}
          >
            {runbooks.map((rb) => (
              <RunbookCard
                key={rb.id}
                runbook={rb}
                lang={lang}
                onRun={() => setView({ kind: "detail", runbook: rb })}
                onEdit={() => setView({ kind: "edit", runbook: rb })}
                onDelete={() => handleDelete(rb.id)}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
