"use client";
import { useState } from "react";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";
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
