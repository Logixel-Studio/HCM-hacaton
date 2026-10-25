"use client";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase";
import { AppShell } from "@/components/layout/AppShell";
import { Loading } from "@/components/common";
import { SetupNotice } from "@/components/setup-notice";
import { useAttendanceRules } from "@/components/clock-card";

/**
 * Signed-in area. Sends visitors to login, users without a company to onboarding, and
 * employees whose attendance needs Face ID (and who may enroll themselves) to /face-setup
 * until they have registered their face. This runs right after an invite is accepted or a signup.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, ctx, loading } = useAuth();
  const router = useRouter();
  const hasEmployee = !!ctx?.employee;
  const { data: rules, isLoading: rulesLoading } = useAttendanceRules();
  const needsFace = hasEmployee && !!rules?.require_face && !rules.face_enrolled && rules.allow_self_enrollment !== false;

  useEffect(() => {
    if (loading || !isConfigured) return;
    if (!session) router.replace("/login");
    else if (ctx && !ctx.tenant && !ctx.is_platform_admin) router.replace("/onboarding");
    else if (needsFace) router.replace("/face-setup");
  }, [loading, session, ctx, router, needsFace]);

  if (!isConfigured) return <SetupNotice />;
  if (loading || !session || !ctx) return <Loading className="h-screen" label="Loading your workspace" />;
  if (!ctx.tenant && !ctx.is_platform_admin) return <Loading className="h-screen" />;
  if (hasEmployee && rulesLoading) return <Loading className="h-screen" label="Loading your workspace" />;
  if (needsFace) return <Loading className="h-screen" label="Setting up Face ID" />;
  return <AppShell><Suspense fallback={<Loading />}>{children}</Suspense></AppShell>;
}
