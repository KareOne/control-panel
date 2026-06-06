"use client";
import { useState, useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  /** If set, user must type this exact string before confirming. */
  confirmWord?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmWord,
  confirmLabel = "Confirm",
  danger = true,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const canConfirm = !confirmWord || typed === confirmWord;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "24px",
          width: "100%",
          maxWidth: 420,
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle
            size={18}
            style={{ color: danger ? "var(--danger)" : "var(--warning)", flexShrink: 0, marginTop: 2 }}
          />
          <div>
            <p className="font-semibold text-sm" style={{ color: "var(--text-main)" }}>{title}</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{message}</p>
          </div>
        </div>

        {confirmWord && (
          <div className="mb-4">
            <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              Type <strong style={{ color: "var(--text-main)" }}>{confirmWord}</strong> to confirm:
            </p>
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canConfirm) onConfirm(); if (e.key === "Escape") onCancel(); }}
              className="w-full rounded px-3 py-1.5 text-sm font-mono"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                color: "var(--text-main)",
                outline: "none",
              }}
              placeholder={confirmWord}
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            Cancel
          </button>
          <button
            disabled={!canConfirm}
            onClick={onConfirm}
            className="rounded px-3 py-1.5 text-sm text-white disabled:opacity-40"
            style={{ background: danger ? "var(--danger)" : "var(--primary)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
