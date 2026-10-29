"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Building2, Check, ChevronDown, Eye, EyeOff, HelpCircle, Menu, Moon, Search, Settings, Sparkles, Sun, User, LogOut, Compass } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Dialog, Dropdown, DropdownItem, DropdownLabel, DropdownSeparator, IconButton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { navFor } from "@/lib/nav";
import { ROLE_INFO } from "@/lib/roles";
import { q, rpc } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePrefs } from "@/lib/prefs";
import { startTour } from "@/components/tour";

type Note = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

function Notifications() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data = [] } = useQuery({ queryKey: ["notifications"], queryFn: () => q<Note[]>((sb) => sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(20)), refetchInterval: 60_000 });
  const unread = data.filter((n) => !n.read_at).length;
  const { prefs } = usePrefs();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(data.map((n) => n.id));
    if (seen.current === null) { seen.current = ids; return; } // first load: nothing is "new"
    const fresh = data.filter((n) => !n.read_at && !seen.current!.has(n.id));
    seen.current = ids;
    if (!fresh.length) return;
    const now = new Date(), hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const { on, from, to } = prefs.quiet;
    const quiet = on && (from <= to ? hm >= from && hm < to : hm >= from || hm < to);
    if (quiet) return;
    if (prefs.sound) { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.08, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.35); } catch { /* audio blocked */ } }
    if (prefs.desktop && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
      for (const n of fresh.slice(0, 3)) { const x = new Notification(n.title, { body: n.body ?? undefined, icon: "/icon.svg", tag: n.id }); x.onclick = () => { window.focus(); if (n.link) router.push(n.link); }; }
    }
  }, [data, prefs.quiet, prefs.sound, prefs.desktop, router]);
  const markAll = async () => { await rpc("mark_notifications_read", { p_ids: null }); qc.invalidateQueries({ queryKey: ["notifications"] }); };
  return (
    <Dropdown className="w-[22rem] p-0" trigger={
      <button aria-label="Notifications" data-tour="notifications" className="relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink-soft transition hover:bg-surface-muted hover:text-ink">
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white ring-2 ring-canvas">{unread}</span>}
      </button>
    }>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">Notifications</p>
        {unread > 0 && <button onClick={markAll} className="cursor-pointer text-xs font-medium text-brand-600">Mark all read</button>}
      </div>
      <div className="max-h-96 overflow-y-auto p-1.5">
        {data.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-soft">You are all caught up</p>}
        {data.map((n) => (
          <button key={n.id} onClick={async () => { if (!n.read_at) await rpc("mark_notifications_read", { p_ids: [n.id] }); qc.invalidateQueries({ queryKey: ["notifications"] }); if (n.link) router.push(n.link); }}
            className="flex w-full cursor-pointer gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-muted">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand-500")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">{n.title}</span>
              {n.body && <span className="block truncate text-xs text-ink-soft">{n.body}</span>}
              <span className="block text-[11px] text-ink-soft/80">{ago(n.created_at)}</span>
            </span>
          </button>
        ))}
      </div>
    </Dropdown>
  );
}

function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navCtx } = useAuth();
  const router = useRouter();
  const [term, setTerm] = useState("");
  const { data: people = [] } = useQuery({
    queryKey: ["search", term], enabled: open && term.trim().length >= 2,
    queryFn: () => q<{ id: string; full_name: string; job_title: string | null; employee_code: string }[]>((sb) =>
      sb.from("employees").select("id, full_name, job_title, employee_code").or(`full_name.ilike.%${term.trim()}%,employee_code.ilike.%${term.trim()}%`).limit(6)),
  });
  const pages = useMemo(() => navFor(navCtx).filter((n) => n.label.toLowerCase().includes(term.toLowerCase())), [navCtx, term]);
  const go = (href: string) => { router.push(href); onClose(); setTerm(""); };
  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <div className="relative -mt-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search people and pages…" className="h-12 w-full rounded-2xl border border-line bg-surface pl-10 pr-4 text-[15px] text-ink focus:border-brand-400 focus:outline-none" />
      </div>
      <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
        {people.length > 0 && <p className="px-2 pt-2 text-xs font-medium text-ink-soft">People</p>}
        {people.map((p) => (
          <button key={p.id} onClick={() => go(`/people/${p.id}`)} className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-muted">
            <Avatar name={p.full_name} size="sm" /><span className="min-w-0"><span className="block text-sm font-medium text-ink">{p.full_name}</span><span className="block text-xs text-ink-soft">{p.employee_code} · {p.job_title}</span></span>
          </button>
        ))}
        <p className="px-2 pt-2 text-xs font-medium text-ink-soft">Pages</p>
        {pages.map((p) => (
          <button key={p.href} onClick={() => go(p.href)} className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-ink hover:bg-surface-muted">
            <p.icon className="h-4 w-4 text-ink-soft" />{p.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export function TopNav({ onMenuClick, onAskAi }: { onMenuClick: () => void; onAskAi: () => void }) {
  const { ctx, refresh, signOut } = useAuth();
  const { prefs, setPref } = usePrefs();
  const { resolved, setMode } = useTheme();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const switchTo = async (tenantId: string) => { await rpc("switch_company", { p_tenant: tenantId }); await refresh(); router.push("/dashboard"); };
  const name = ctx?.employee?.full_name || ctx?.full_name || ctx?.email || "";

  return (
    <header className="flex items-center gap-3">
      <button onClick={onMenuClick} data-tour="menu" className="cursor-pointer rounded-xl p-2 text-ink-soft hover:bg-surface-muted lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>

      <Dropdown align="left" className="w-72" trigger={
        <button data-tour="company" className="flex max-w-[16rem] cursor-pointer items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-3 shadow-soft transition hover:bg-surface-muted">
          <span className="brand-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">{ctx?.tenant?.name?.[0] ?? <Building2 className="h-4 w-4" />}</span>
          <span className="min-w-0 text-left leading-tight"><span className="block truncate text-sm font-semibold text-ink">{ctx?.tenant?.name ?? "Platform"}</span><span className="block truncate text-[11px] text-ink-soft">{ctx?.role ? ROLE_INFO[ctx.role].label : "Super admin"}</span></span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-soft" />
        </button>
      }>
        <DropdownLabel>Your companies</DropdownLabel>
        {(ctx?.companies ?? []).map((c) => (
          <DropdownItem key={c.tenant_id} active={c.tenant_id === ctx?.tenant?.id} onClick={() => c.tenant_id !== ctx?.tenant?.id && switchTo(c.tenant_id)}>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-muted text-xs font-bold">{c.name[0]}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="block text-xs text-ink-soft">{ROLE_INFO[c.role].label}</span></span>
            {c.tenant_id === ctx?.tenant?.id && <Check className="h-4 w-4" />}
          </DropdownItem>
        ))}
      </Dropdown>

      <button onClick={() => setSearchOpen(true)} data-tour="search" className="ml-2 hidden h-10 flex-1 max-w-md cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm text-ink-soft shadow-soft transition hover:text-ink md:flex">
        <Search className="h-4 w-4" /> Search people and pages <kbd className="ml-auto rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px]">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <IconButton aria-label="Search" className="md:hidden" onClick={() => setSearchOpen(true)}><Search className="h-[18px] w-[18px]" /></IconButton>
        <IconButton aria-label={prefs.hideMoney ? "Show amounts" : "Hide amounts"} title={prefs.hideMoney ? "Show money amounts" : "Hide money amounts (privacy mode)"} data-tour="privacy" className="hidden sm:inline-flex" onClick={() => setPref("hideMoney", !prefs.hideMoney).catch(() => undefined)}>
          {prefs.hideMoney ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
        </IconButton>
        <IconButton aria-label="Toggle theme" className="hidden sm:inline-flex" onClick={() => setMode(resolved === "dark" ? "light" : "dark")}>
          {resolved === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </IconButton>
        <Notifications />
        {ctx?.tenant && (
          <button onClick={onAskAi} data-tour="ask-ai" className="brand-gradient brand-gradient-hover inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-3 text-sm font-semibold text-white shadow-sm sm:px-4">
            <Sparkles className="h-4 w-4" /><span className="hidden sm:inline">Ask AI</span>
          </button>
        )}
        <Dropdown className="w-64" trigger={
          <button data-tour="account" className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface p-1 transition hover:bg-surface-muted md:pr-2.5">
            <Avatar name={name} size="sm" />
            <span className="hidden max-w-[9rem] truncate text-sm font-medium text-ink md:block">{name.split(" ")[0]}</span>
          </button>
        }>
          <div className="px-3 py-2"><p className="truncate text-sm font-semibold text-ink">{name}</p><p className="truncate text-xs text-ink-soft">{ctx?.email}</p></div>
          <DropdownSeparator />
          {ctx?.employee && <DropdownItem onClick={() => router.push(`/people/${ctx.employee!.id}`)}><User className="h-4 w-4" />My profile</DropdownItem>}
          <DropdownItem onClick={() => router.push("/account")}><Settings className="h-4 w-4" />Settings</DropdownItem>
          <DropdownItem onClick={() => startTour()}><Compass className="h-4 w-4" />Show me around this page</DropdownItem>
          <DropdownItem onClick={() => router.push("/account/help")}><HelpCircle className="h-4 w-4" />Help & shortcuts</DropdownItem>
          <DropdownSeparator />
          <DropdownItem danger onClick={signOut}><LogOut className="h-4 w-4" />Sign out</DropdownItem>
        </Dropdown>
      </div>
      <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
