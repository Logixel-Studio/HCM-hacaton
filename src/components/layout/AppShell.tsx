"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import { CopilotDrawer } from "@/components/copilot";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const path = usePathname();

  useEffect(() => { try { setExpanded(localStorage.getItem("hcm-sidebar") === "1"); } catch { /* ignore */ } }, []);
  useEffect(() => setMobileOpen(false), [path]);
  const toggle = () => setExpanded((e) => { try { localStorage.setItem("hcm-sidebar", e ? "0" : "1"); } catch { /* ignore */ } return !e; });

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <div className="hidden shrink-0 lg:flex"><Sidebar expanded={expanded} onToggle={toggle} /></div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full animate-slidein"><Sidebar expanded mobile onNavigate={() => setMobileOpen(false)} /></div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="px-4 pt-4 md:px-6"><TopNav onMenuClick={() => setMobileOpen(true)} onAskAi={() => setAiOpen(true)} /></div>
        <main className="flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-6"><div key={path} className="mx-auto max-w-7xl animate-fade-up">{children}</div></main>
      </div>
      <CopilotDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}
