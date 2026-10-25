"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function Dropdown({ trigger, children, align = "right", className }: { trigger: React.ReactNode; children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div onClick={() => setOpen(false)} className={cn("absolute z-40 mt-2 min-w-[12rem] rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)] animate-fade-up", align === "right" ? "right-0" : "left-0", className)}>
          {children}
        </div>
      )}
    </div>
  );
}
export function DropdownItem({ className, danger, active, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; active?: boolean }) {
  return <button className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-ink transition hover:bg-surface-muted", active && "bg-brand-50 text-brand-700", danger && "text-rose-600 hover:bg-rose-50", className)} {...p} />;
}
export const DropdownLabel = ({ children }: { children: React.ReactNode }) => <p className="px-3 py-1.5 text-xs font-medium text-ink-soft">{children}</p>;
export const DropdownSeparator = () => <div className="my-1 h-px bg-line" />;
