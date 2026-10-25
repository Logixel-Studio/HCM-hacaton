"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck, ShieldX } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { Logo } from "@/components/brand";
import { rpc } from "@/lib/api";
import { fmtDate, title } from "@/lib/format";

function Verify() {
  const [code, setCode] = useState(useSearchParams().get("code") ?? "");
  const [res, setRes] = useState<null | false | { company: string; employee: string; kind: string; issued_at: string }>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); try { setRes((await rpc<typeof res>("verify_letter", { p_code: code })) || false); } catch { setRes(false); } finally { setBusy(false); } };
  return (
    <Card className="mx-auto max-w-md p-8">
      <h1 className="font-display text-2xl font-bold text-ink">Verify an HR letter</h1>
      <p className="mt-1 text-sm text-ink-soft">Enter the verification code printed at the bottom of the letter.</p>
      <div className="mt-6 flex gap-2"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A1B2C3D4E5" className="h-11 font-mono" /><Button onClick={check} loading={busy} disabled={code.length < 6}>Verify</Button></div>
      {res && <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700"><p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5" />Genuine letter</p><p className="mt-2">{title(res.kind)} issued by {res.company} to {res.employee} on {fmtDate(res.issued_at)}.</p></div>}
      {res === false && <div className="mt-6 flex items-center gap-2 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700"><ShieldX className="h-5 w-5" />No letter matches this code.</div>}
    </Card>
  );
}

export default function VerifyPage() {
  return <div className="min-h-screen bg-canvas px-6 py-6"><Logo /><div className="mt-16"><Suspense><Verify /></Suspense></div></div>;
}
