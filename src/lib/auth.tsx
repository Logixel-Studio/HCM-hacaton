"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, isConfigured } from "./supabase";
import type { Role } from "./roles";
import type { Ctx } from "./nav";

export type Company = { tenant_id: string; name: string; role: Role; logo_url: string | null };
export type AppContext = {
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_platform_admin: boolean;
  tenant: { id: string; name: string; slug: string; plan: string; status: string; currency: string; timezone: string; logo_url: string | null; brand_color: string | null; seat_limit: number; trial_ends_at: string | null } | null;
  role: Role | null;
  custom_role: { id: string; name: string; permissions: Record<string, string[]> } | null;
  employee: { id: string; code: string; full_name: string; job_title: string | null; photo_url: string | null; department_id: string | null; branch_id: string | null; manager_id: string | null; has_reports: boolean } | null;
  companies: Company[];
  unread_notifications: number;
};

type AuthState = {
  session: Session | null;
  ctx: AppContext | null;
  loading: boolean;
  refresh: () => Promise<AppContext | null>;
  signOut: () => Promise<void>;
  navCtx: Ctx;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [loading, setLoading] = useState(true);

  const loadContext = useCallback(async () => {
    const { data, error } = await supabase().rpc("my_context");
    if (error) { console.error(error); setCtx(null); return null; }
    setCtx(data as AppContext);
    return data as AppContext;
  }, []);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    const sb = supabase();
    sb.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadContext();
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange(async (event, s) => {
      setSession(s);
      if (event === "SIGNED_OUT") { setCtx(null); qc.clear(); }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") await loadContext();
    });
    return () => sub.subscription.unsubscribe();
  }, [loadContext, qc]);

  const refresh = useCallback(async () => { const c = await loadContext(); qc.invalidateQueries(); return c; }, [loadContext, qc]);
  const signOut = useCallback(async () => { await supabase().auth.signOut(); setCtx(null); qc.clear(); }, [qc]);

  const navCtx = useMemo<Ctx>(() => ({
    role: ctx?.role ?? null,
    hasReports: !!ctx?.employee?.has_reports,
    hasEmployee: !!ctx?.employee,
    isPlatformAdmin: !!ctx?.is_platform_admin,
    hidden: Object.entries(ctx?.custom_role?.permissions ?? {}).filter(([, v]) => v.includes("hidden")).map(([k]) => k),
  }), [ctx]);

  return <AuthCtx.Provider value={{ session, ctx, loading, refresh, signOut, navCtx }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** Shorthand used by every screen: the active role, employee id and tenant. */
export function useMe() {
  const { ctx } = useAuth();
  return { role: ctx?.role ?? null, employeeId: ctx?.employee?.id ?? null, tenantId: ctx?.tenant?.id ?? null, ctx };
}
