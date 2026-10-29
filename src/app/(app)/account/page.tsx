"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, Bell, Bot, Building2, Compass, Gauge, HelpCircle, Info, KeyRound, LayoutDashboard, LogOut, Palette, Search, Shield, ShieldCheck, User,
} from "lucide-react";
import { Avatar } from "@/components/ui";
import { SettingsGroup, SettingsLink } from "@/components/account/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { can, ROLE_INFO } from "@/lib/roles";
import { APP_VERSION, SEARCH_INDEX } from "@/components/account/search-index";

/** Personal Settings hub: everything a person controls about their own app, like a phone's Settings screen. */
export default function AccountHub() {
  const { ctx, signOut } = useAuth();
  const { prefs } = usePrefs();
  const [q, setQ] = useState("");
  const name = ctx?.employee?.full_name || ctx?.full_name || ctx?.email || "";
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return SEARCH_INDEX.filter((x) => (x.label + " " + x.section + " " + x.words).toLowerCase().includes(t)).slice(0, 12);
  }, [q]);
  const muted = Object.values(prefs.notif).filter((v) => v === false).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section data-tour="account-card" className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
        <div className="brand-gradient pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-15 blur-2xl" />
        <div className="relative flex items-center gap-4">
          <Avatar name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl font-bold text-ink">{name}</h1>
            <p className="truncate text-sm text-ink-soft">{ctx?.email}</p>
            <p className="mt-1 text-xs text-ink-soft">{ctx?.tenant?.name} · <span className="font-medium text-ink">{ctx?.role ? ROLE_INFO[ctx.role].label : "Platform"}</span></p>
          </div>
          {ctx?.employee && <Link href={`/people/${ctx.employee.id}`} className="hidden rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-muted sm:inline-flex">View profile</Link>}
        </div>
      </section>

      <div className="relative" data-tour="account-search">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search settings: theme, password, notifications, AI…" aria-label="Search settings"
          className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-sm text-ink shadow-soft focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/10" />
        {q && (
          <div className="absolute inset-x-0 top-14 z-20 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
            {hits.length === 0 ? <p className="px-4 py-6 text-center text-sm text-ink-soft">No setting matches “{q}”.</p> : hits.map((h) => (
              <Link key={h.href + h.label} href={h.href} className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-surface-muted">
                <span className="text-ink">{h.label}</span><span className="text-xs text-ink-soft">{h.section}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <SettingsGroup title="You">
        <SettingsLink href="/account/profile" icon={User} title="Profile" sub="Name, phone and how you appear to colleagues" />
        {ctx?.employee && <SettingsLink href={`/people/${ctx.employee.id}`} icon={Building2} title="My employee record" sub="Job, manager, documents, leave and attendance" tone="slate" />}
      </SettingsGroup>

      <SettingsGroup title="Preferences">
        <SettingsLink href="/account/general" icon={Palette} title="General" sub="Theme, accent, text size, density, privacy mode, date and time" />
        <SettingsLink href="/account/general#dashboard" icon={LayoutDashboard} title="Layout & dashboard" sub="Start page, sidebar, motion, dashboard sections and order" tone="violet" />
        <SettingsLink href="/account/notifications" icon={Bell} title="Notifications" sub="Per type, desktop alerts, sound, quiet hours" badge={muted ? `${muted} muted` : null} tone="amber" />
        <SettingsLink href="/account/ai" icon={Bot} title="AI & Copilot" sub="Answer style, language, memory, chat history" tone="violet" />
        <SettingsLink href="/account/tips" icon={Compass} title="Guided tips" sub={prefs.toursOff ? "Off · turn back on or replay" : "On · replay any page’s tour"} tour="account-tips" tone="emerald" badge={prefs.toursOff ? "Off" : null} />
      </SettingsGroup>

      <SettingsGroup title="Security & privacy">
        <SettingsLink href="/account/security" icon={KeyRound} title="Security" sub="Password, sign-in methods, devices, your companies" tone="rose" />
        <SettingsLink href="/account/privacy" icon={Shield} title="Privacy & data" sub="What is shared, export your data, clear AI history" tone="emerald" />
        <SettingsLink href="/account/activity" icon={Activity} title="Activity" sub="Every change you made, and when" tone="slate" />
      </SettingsGroup>

      <SettingsGroup title="App">
        {(can.hrStaff(ctx?.role) || can.viewPay(ctx?.role) || can.finance(ctx?.role)) && <SettingsLink href="/settings" icon={ShieldCheck} title="Company settings" sub="Branches, departments, leave and payroll rules (admins)" tone="brand" />}
        <SettingsLink href="/account/speed" icon={Gauge} title="Speed check" sub="How fast the app reaches your database" tone="slate" />
        <SettingsLink href="/account/help" icon={HelpCircle} title="Help & shortcuts" sub="FAQ, keyboard shortcuts, contact HR" tone="slate" />
        <SettingsLink href="/account/about" icon={Info} title="About & legal" sub="Version, terms, privacy policy" tone="slate" />
      </SettingsGroup>

      <button onClick={signOut} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-3xl border border-line bg-surface py-3.5 text-sm font-semibold text-rose-600 shadow-soft transition hover:bg-rose-50 dark:hover:bg-rose-500/10"><LogOut className="h-4 w-4" />Sign out</button>
      <p className="text-center text-xs text-ink-soft">HCM Master Suite {APP_VERSION}</p>
    </div>
  );
}
