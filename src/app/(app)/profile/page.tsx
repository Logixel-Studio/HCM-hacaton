"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loading } from "@/components/common";

/** Old address: account settings now live under /account. */
export default function ProfileRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/account/general"); }, [router]);
  return <Loading />;
}
