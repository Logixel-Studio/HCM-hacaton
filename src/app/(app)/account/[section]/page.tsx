"use client";
import { use } from "react";
import { notFound } from "next/navigation";
import { SECTIONS } from "@/components/account/sections";

/** /account/general, /account/security, … — one screen per settings section. */
export default function AccountSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = use(params);
  const S = SECTIONS[section];
  if (!S) notFound();
  return <div className="mx-auto max-w-3xl"><S /></div>;
}
