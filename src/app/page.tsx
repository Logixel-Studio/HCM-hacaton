"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase";
import { Loading } from "@/components/common";
import { SetupNotice } from "@/components/setup-notice";

export default function Home() {
  const { session, ctx, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isConfigured || loading) return;
    if (!session) router.replace("/login");
    else if (ctx?.tenant || ctx?.is_platform_admin) router.replace("/dashboard");
    else router.replace("/onboarding");
  }, [session, ctx, loading, router]);
  if (!isConfigured) return <SetupNotice />;
  return <Loading className="h-screen" />;
}
