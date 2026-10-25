"use client";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { ACCENTS, useTheme, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MODES: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode, resolved } = useTheme();
  if (compact) {
    const next = resolved === "dark" ? "light" : "dark";
    const Icon = resolved === "dark" ? Sun : Moon;
    return (
      <button onClick={() => setMode(next)} aria-label="Toggle theme" className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink-soft transition hover:text-ink">
        <Icon className="h-[18px] w-[18px]" />
      </button>
    );
  }
  return (
    <div className="inline-flex rounded-full bg-surface-muted p-1">
      {MODES.map(({ value, icon: Icon, label }) => (
        <button key={value} onClick={() => setMode(value)} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition", mode === value ? "bg-surface text-ink shadow-soft" : "text-ink-soft hover:text-ink")}>
          <Icon className="h-4 w-4" />{label}
        </button>
      ))}
    </div>
  );
}

export function AccentPicker() {
  const { accent, setAccent } = useTheme();
  return (
    <div className="flex flex-wrap gap-2">
      {ACCENTS.map((a) => (
        <button key={a.value} onClick={() => setAccent(a.value)} title={a.label} aria-label={a.label}
          className={cn("flex h-9 w-9 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition", accent === a.value && "ring-2 ring-ink/30")} style={{ background: a.swatch }}>
          {accent === a.value && <Check className="h-4 w-4 text-white" />}
        </button>
      ))}
    </div>
  );
}
