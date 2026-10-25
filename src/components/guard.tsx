"use client";
import { ShieldOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { EmptyState } from "@/components/common";
import type { Ctx } from "@/lib/nav";

/** Hides a whole page when the role cannot use it (the database would refuse anyway). */
export function RequireAccess({ allow, children }: { allow: (c: Ctx) => boolean; children: React.ReactNode }) {
  const { navCtx } = useAuth();
  if (!allow(navCtx) || (navCtx.hidden ?? []).some((h) => typeof window !== "undefined" && window.location.pathname.startsWith(h))) return <EmptyState icon={ShieldOff} title="You don't have access to this page" text="Ask your company admin if you need it." />;
  return <>{children}</>;
}
