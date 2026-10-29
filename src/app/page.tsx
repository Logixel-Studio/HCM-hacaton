"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Landing } from "@/components/landing/landing";

/** Public product website. Signed-in visitors see an "Open dashboard" button instead of sign-up. */
export default function Home() {
  const router = useRouter();
  // Invite or password-recovery links that land on the home page go straight to "Set your password".
  useEffect(() => {
    const h = window.location.hash;
    if (/type=(recovery|invite)/.test(h)) router.replace(`/reset-password${/type=invite/.test(h) ? "?invited=1" : ""}${h}`);
  }, [router]);
  return <Landing />;
}
