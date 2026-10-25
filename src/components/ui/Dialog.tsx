"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
}

export function Dialog({ open, onClose, title, description, children, className }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className={cn("relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-surface shadow-[var(--shadow-pop)] animate-fade-up no-scrollbar", className)}>
        <div className="flex items-start justify-between gap-4 p-6 pb-2">
          <div>
            {title && <h3 className="text-lg font-semibold text-ink">{title}</h3>}
            {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-lg p-1 text-ink-soft transition hover:bg-surface-muted hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 pt-2">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export function Drawer({ open, onClose, title, children, footer, className }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; className?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-canvas shadow-[var(--shadow-pop)] animate-slidein", className)}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0 text-lg font-semibold text-ink">{title}</div>
          <button onClick={onClose} className="cursor-pointer rounded-lg p-1 text-ink-soft transition hover:bg-surface-muted hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
