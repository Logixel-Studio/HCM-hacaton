"use client";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase";
import { AppShell } from "@/components/layout/AppShell";
import { Loading } from "@/components/common";
import { SetupNotice } from "@/components/setup-notice";

/** Signed-in area. Sends visitors to login and users without a company to onboarding. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, ctx, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading || !isConfigured) return;
    if (!session) router.replace("/login");
    else if (ctx && !ctx.tenant && !ctx.is_platform_admin) router.replace("/onboarding");
  }, [loading, session, ctx, router]);

  if (!isConfigured) return <SetupNotice />;
  if (loading || !session || !ctx) return <Loading className="h-screen" label="Loading your workspace" />;
  if (!ctx.tenant && !ctx.is_platform_admin) return <Loading className="h-screen" />;
  return <AppShell><Suspense fallback={<Loading />}>{children}</Suspense></AppShell>;
}
