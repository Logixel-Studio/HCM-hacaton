"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Lock, Mail, MailCheck, User } from "lucide-react";
import { cn } from "@/lib/utils";

const icons = { email: Mail, password: Lock, name: User } as const;

export function AuthField({ label, type = "text", icon, value, onChange, placeholder, autoComplete, right, autoFocus }: {
  label: string; type?: string; icon?: keyof typeof icons; value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string; right?: React.ReactNode; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  const Icon = icon ? icons[icon] : null;
  const isPwd = type === "password";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium text-ink">{label}</label>
        {right}
      </div>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-soft" />}
        <input type={isPwd && show ? "text" : type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus} required
          className={cn("h-12 w-full rounded-2xl border border-line bg-surface text-[15px] text-ink placeholder:text-ink-soft/60 transition focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/15", Icon ? "pl-11" : "pl-4", isPwd ? "pr-11" : "pr-4")} />
        {isPwd && (
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg p-1 text-ink-soft hover:text-ink">
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        )}
      </div>
    </div>
  );
}

export function PasswordStrength({ value }: { value: string }) {
  const score = [value.length >= 8, /[A-Z]/.test(value), /[0-9]/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-rose-500", "bg-rose-500", "bg-amber-500", "bg-sky-500", "bg-emerald-500"];
  if (!value) return null;
  return (
    <div className="mt-2">
      <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <div key={i} className={cn("h-1.5 flex-1 rounded-full", i < score ? colors[score] : "bg-surface-muted")} />)}</div>
      <p className="mt-1 text-xs text-ink-soft">{labels[score]} · use 8+ characters with a number and a symbol</p>
    </div>
  );
}

export function GoogleButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} className="flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-2xl border border-line bg-surface text-sm font-medium text-ink transition hover:bg-surface-muted disabled:opacity-60">
      <svg viewBox="0 0 24 24" className="h-5 w-5"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" /></svg>
      Continue with Google
    </button>
  );
}

export function Divider({ label = "or" }: { label?: string }) {
  return <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-ink-soft"><div className="h-px flex-1 bg-line" />{label}<div className="h-px flex-1 bg-line" /></div>;
}

/** Six boxes over one real input: typing, paste and phone code autofill all work. */
export function OtpBoxes({ value, onChange, disabled, error, shake, inputRef }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; error?: boolean; shake?: number; inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div key={shake} className={cn("relative mx-auto grid w-full max-w-[360px] grid-cols-6 gap-2", (shake ?? 0) > 0 && "animate-[otp-shake_.35s_ease]")}>
      <input ref={inputRef} aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" value={value} disabled={disabled}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0" data-testid="otp-input" />
      {Array.from({ length: 6 }, (_, i) => {
        const active = focus && i === Math.min(value.length, 5);
        return (
          <span key={i} aria-hidden className={cn("flex h-14 items-center justify-center rounded-2xl border bg-surface font-display text-2xl font-bold text-ink transition",
            error ? "border-rose-400 bg-rose-50/40 dark:bg-rose-500/10" : active ? "border-brand-500 ring-4 ring-brand-500/15" : value[i] ? "border-brand-300" : "border-line", i === 2 && "mr-2")}>
            {value[i] ?? (active ? <span className="h-6 w-0.5 animate-pulse rounded bg-brand-500" /> : "")}
          </span>
        );
      })}
    </div>
  );
}

/** "Check your email" step shared by sign-up, code sign-in and password reset. */
export function CodeStep({ email, busy, error, shake, wait, onVerify, onResend, onBack, title = "Check your email", children }: {
  email: string; busy: boolean; error: string | null; shake: number; wait: number; title?: string;
  onVerify: (code: string) => void; onResend: () => void; onBack: () => void; children?: React.ReactNode;
}) {
  const [code, setCode] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 60); }, []);
  useEffect(() => { if (error) { setCode(""); ref.current?.focus(); } }, [error, shake]);
  return (
    <div className="text-center">
      <div className="brand-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-brand-500/25"><MailCheck className="h-7 w-7" /></div>
      <h1 className="mt-5 font-display text-3xl font-bold text-ink">{title}</h1>
      <p className="mt-2 text-ink-soft">We sent a 6-digit code to <span className="font-medium text-ink">{email}</span>. <button type="button" onClick={onBack} className="cursor-pointer font-semibold text-brand-600 hover:text-brand-700">Change</button></p>
      <div className="mt-7"><OtpBoxes value={code} onChange={(v) => { setCode(v); if (v.length === 6) onVerify(v); }} disabled={busy} error={!!error} shake={shake} inputRef={ref} /></div>
      {children}
      <p className={cn("mt-4 min-h-5 text-sm", error ? "text-rose-600" : "text-ink-soft")} role={error ? "alert" : undefined}>{error ?? (busy ? "Checking…" : "Email open on another device? Just type the code here.")}</p>
      <button type="button" disabled={busy || code.length !== 6} onClick={() => onVerify(code)}
        className="brand-gradient brand-gradient-hover mt-4 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Checking…" : "Verify and continue"}
      </button>
      <button type="button" disabled={wait > 0 || busy} onClick={onResend} className="mt-3 h-11 w-full cursor-pointer rounded-2xl text-sm font-medium text-ink-soft transition hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-60">
        {wait > 0 ? `Send a new code in 0:${String(wait).padStart(2, "0")}` : "Send a new code"}
      </button>
      <p className="mt-2 text-xs text-ink-soft">Can’t find it? Look in Spam or Promotions. The code works for 10 minutes.</p>
    </div>
  );
}

/** Countdown helper for "send a new code". */
export function useCountdown() {
  const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  return [wait, setWait] as const;
}
