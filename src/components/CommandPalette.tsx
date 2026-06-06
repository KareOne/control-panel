"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Zap, LayoutDashboard } from "lucide-react";
import { NAV } from "@/lib/i18n";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Item {
  id: string;
  label: string;
  href: string;
  description: string;
  kind: "page" | "action";
}

const QUICK_ACTIONS: Item[] = [
  { id: "qa-deploy", label: "Deploy now", href: "/deploy", description: "Quick action", kind: "action" },
  { id: "qa-alerts", label: "View alerts", href: "/alerts", description: "Quick action", kind: "action" },
  { id: "qa-drift", label: "Env drift check", href: "/drift", description: "Quick action", kind: "action" },
  { id: "qa-depmap", label: "Dependency map", href: "/depmap", description: "Quick action", kind: "action" },
];

const NAV_ITEMS: Item[] = NAV.map((n) => ({
  id: n.key,
  label: n.en,
  href: n.href,
  description: n.href,
  kind: "page" as const,
}));

const ALL_ITEMS: Item[] = [...QUICK_ACTIONS, ...NAV_ITEMS];

function filterItems(query: string): Item[] {
  if (!query.trim()) return ALL_ITEMS;
  const q = query.toLowerCase();
  return ALL_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.href.toLowerCase().includes(q)
  );
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = filterItems(query);

  const navigate = useCallback(
    (href: string) => {
      router.push(href);
      onClose();
    },
    [router, onClose]
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const activeEl = listRef.current?.querySelector<HTMLElement>("[data-active='true']");
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results[active]) navigate(results[active].href);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open, active, results, navigate, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          borderRadius: "0.75rem",
          background: "var(--bg-card)",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search input row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Search size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 14,
              color: "var(--text-main)",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                fontSize: 12,
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{ maxHeight: 360, overflowY: "auto", padding: "4px 0" }}
        >
          {results.length === 0 ? (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-muted)",
              }}
            >
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            results.map((item, i) => (
              <div
                key={item.id}
                data-active={i === active ? "true" : undefined}
                onClick={() => navigate(item.href)}
                onMouseEnter={() => setActive(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 16px",
                  cursor: "pointer",
                  borderRadius: 6,
                  margin: "0 4px",
                  background:
                    i === active
                      ? "color-mix(in srgb, var(--primary) 12%, transparent)"
                      : "transparent",
                  transition: "background 80ms",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    color: i === active ? "var(--primary)" : "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {item.kind === "action" ? (
                    <Zap size={14} />
                  ) : (
                    <LayoutDashboard size={14} />
                  )}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--text-main)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    flexShrink: 0,
                  }}
                >
                  {item.description}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "6px 16px",
            display: "flex",
            gap: 16,
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
