"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { GROUP_LABEL, navFor, type NavItem } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { rpc } from "@/lib/api";
import { Logo } from "@/components/brand";

function useApprovalCount(enabled: boolean) {
  return useQuery({ queryKey: ["approvals", "count"], queryFn: async () => (await rpc<unknown[]>("my_approvals")).length, enabled, refetchInterval: 60_000 });
}

function Item({ item, expanded, badge, onNavigate }: { item: NavItem; expanded: boolean; badge?: number; onNavigate?: () => void }) {
  const path = usePathname();
  const active = path === item.href || path.startsWith(item.href + "/");
  const Icon = item.icon;
  return (
    <Link href={item.href} onClick={onNavigate} title={expanded ? undefined : item.label}
      className={cn("group relative flex h-11 items-center gap-3 rounded-2xl transition", expanded ? "px-3" : "w-11 justify-center",
        active ? "brand-gradient text-white shadow-sm" : "text-ink-soft hover:bg-surface-muted hover:text-ink")}>
      <Icon className="h-5 w-5 shrink-0" />
      {expanded && <span className="truncate text-sm font-medium">{item.label}</span>}
      {!!badge && (
        <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold", expanded ? "ml-auto" : "absolute -right-1 -top-1 ring-2 ring-canvas",
          active ? "bg-white/25 text-white" : "bg-rose-500 text-white")}>{badge > 99 ? "99+" : badge}</span>
      )}
      {!expanded && <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-canvas opacity-0 shadow-lg transition group-hover:opacity-100">{item.label}</span>}
    </Link>
  );
}

export function Sidebar({ expanded, onToggle, onNavigate, mobile = false }: { expanded: boolean; onToggle?: () => void; onNavigate?: () => void; mobile?: boolean }) {
  const { navCtx, signOut } = useAuth();
  const items = navFor(navCtx);
  const showApprovals = items.some((i) => i.href === "/approvals");
  const { data: count } = useApprovalCount(showApprovals);
  const groups = (["work", "people", "talent", "admin"] as const).map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);

  return (
    <aside className={cn("flex h-full flex-col bg-canvas py-4", expanded ? "w-64 px-3" : "w-[68px] items-center px-2", mobile && "bg-surface shadow-pop")}>
      {expanded && <div className="mb-4 px-2"><Logo /></div>}
      <nav className={cn("flex flex-1 flex-col gap-1 overflow-y-auto no-scrollbar", !expanded && "items-center")}>
        {groups.map(({ g, items }, gi) => (
          <div key={g} className={cn("flex flex-col gap-1", !expanded && "items-center")}>
            {expanded ? <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft/70">{GROUP_LABEL[g]}</p> : gi > 0 && <div className="my-1.5 h-px w-6 bg-line" />}
            {items.map((n) => <Item key={n.href} item={n} expanded={expanded} onNavigate={onNavigate} badge={n.href === "/approvals" ? count : undefined} />)}
          </div>
        ))}
      </nav>
      <div className={cn("mt-2 flex gap-1 border-t border-line pt-3", expanded ? "flex-row" : "flex-col items-center")}>
        {onToggle && (
          <button onClick={onToggle} title={expanded ? "Collapse" : "Expand"} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl text-ink-soft transition hover:bg-surface-muted hover:text-ink">
            {expanded ? <ChevronsLeft className="h-5 w-5" /> : <ChevronsRight className="h-5 w-5" />}
          </button>
        )}
        <button onClick={signOut} title="Sign out" className={cn("flex h-11 cursor-pointer items-center gap-3 rounded-2xl text-ink-soft transition hover:bg-rose-50 hover:text-rose-600", expanded ? "flex-1 px-3" : "w-11 justify-center")}>
          <LogOut className="h-5 w-5" />{expanded && <span className="text-sm font-medium">Sign out</span>}
        </button>
      </div>
    </aside>
  );
}
