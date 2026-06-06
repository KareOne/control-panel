"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUI } from "@/components/Providers";
import { t } from "@/lib/i18n";

type Step = "credentials" | "totp";

export default function LoginPage() {
  const router = useRouter();
  const { lang } = useUI();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [step, setStep] = useState<Step>("credentials");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");

    const body: Record<string, string> = { email, password };
    if (step === "totp") body.totpCode = totpCode;

    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);

    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErr(d.error || "Login failed");
      return;
    }

    const d = await r.json();
    if (d.requiresTotp) {
      setStep("totp");
      setTotpCode("");
      return;
    }
    router.push("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
      <form
        onSubmit={submit}
        className="w-80 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6"
      >
        <h1 className="text-lg font-semibold">{t("appName", lang)}</h1>

        {step === "credentials" ? (
          <>
            <input
              className="w-full rounded bg-zinc-800 px-3 py-2 text-sm outline-none"
              placeholder={t("email", lang)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <input
              type="password"
              className="w-full rounded bg-zinc-800 px-3 py-2 text-sm outline-none"
              placeholder={t("password", lang)}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-400">
              Enter the 6-digit code from your authenticator app.
            </p>
            <input
              className="w-full rounded bg-zinc-800 px-3 py-2 text-sm outline-none tracking-widest text-center font-mono"
              placeholder="000000"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
              maxLength={6}
              inputMode="numeric"
            />
            <button
              type="button"
              onClick={() => { setStep("credentials"); setErr(""); }}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              ← Back
            </button>
          </>
        )}

        {err && <p className="text-sm text-red-400">{err}</p>}
        <button
          disabled={busy || (step === "totp" && totpCode.length !== 6)}
          className="w-full rounded bg-[#09637E] py-2 text-sm font-medium disabled:opacity-50"
        >
          {step === "totp" ? "Verify" : t("signIn", lang)}
        </button>
      </form>
    </div>
  );
}
