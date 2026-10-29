"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import { CopilotDrawer } from "@/components/copilot";
import { PrefsEffects, usePrefs } from "@/lib/prefs";
import { Tour } from "@/components/tour";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const { prefs } = usePrefs();

  useEffect(() => {
    if (prefs.sidebar === "expanded") return setExpanded(true);
    if (prefs.sidebar === "collapsed") return setExpanded(false);
    try { setExpanded(localStorage.getItem("hcm-sidebar") === "1"); } catch { /* ignore */ }
  }, [prefs.sidebar]);
  // Keyboard shortcuts: ? help, then "g" followed by d/a/l/p/s to jump (Ctrl/⌘ K search lives in the top bar).
  useEffect(() => {
    if (!prefs.shortcuts) return;
    let g = 0;
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("[data-testid=tour]")) return;
      if (e.key === "?") { e.preventDefault(); router.push("/account/help"); return; }
      if (e.key === "g") { g = Date.now(); return; }
      if (Date.now() - g < 1200) {
        const to = ({ d: "/dashboard", a: "/attendance", l: "/leave", p: "/people", s: "/account", y: "/payslips" } as Record<string, string>)[e.key];
        if (to) { e.preventDefault(); router.push(to); }
        g = 0;
      }
    };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [prefs.shortcuts, router]);
  useEffect(() => { const h = () => setAiOpen(true); window.addEventListener("hcm:copilot", h); return () => window.removeEventListener("hcm:copilot", h); }, []);
  useEffect(() => setMobileOpen(false), [path]);
  const toggle = () => setExpanded((e) => { try { localStorage.setItem("hcm-sidebar", e ? "0" : "1"); } catch { /* ignore */ } return !e; });

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <div className="hidden shrink-0 lg:flex" data-tour="sidebar"><Sidebar expanded={expanded} onToggle={toggle} /></div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full animate-slidein"><Sidebar expanded mobile onNavigate={() => setMobileOpen(false)} /></div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="px-4 pt-4 md:px-6"><TopNav onMenuClick={() => setMobileOpen(true)} onAskAi={() => setAiOpen(true)} /></div>
        <main id="main" className="flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-6"><div key={`${path}|${prefs.hideMoney}|${prefs.dateFormat}|${prefs.timeFormat}`} className="mx-auto max-w-7xl animate-fade-up">{children}</div></main>
      </div>
      <CopilotDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
      <PrefsEffects />
      <Tour />
    </div>
  );
}
