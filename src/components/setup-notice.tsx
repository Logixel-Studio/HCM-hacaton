import { CheckCircle2, Database, XCircle } from "lucide-react";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function Row({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />}
      <span><code className="rounded bg-surface-muted px-1">{label}</code> <span className="text-ink-soft">{ok ? "found" : hint}</span></span>
    </li>
  );
}

/** Shown when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are missing. */
export function SetupNotice() {
  const urlOk = !!url && !url.includes("YOUR-PROJECT") && url.startsWith("https://");
  const keyOk = !!key && !key.includes("YOUR-ANON");
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="max-w-xl rounded-3xl border border-line bg-surface p-8 shadow-card">
        <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white"><Database className="h-6 w-6" /></div>
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">Connect your Supabase project</h1>
        <p className="mt-1 text-sm text-ink-soft">The app could not find your Supabase settings.</p>
        <ul className="mt-4 space-y-2 text-sm">
          <Row ok={urlOk} label="NEXT_PUBLIC_SUPABASE_URL" hint="missing — should look like https://abcd.supabase.co" />
          <Row ok={keyOk} label="NEXT_PUBLIC_SUPABASE_ANON_KEY" hint="missing — the anon / publishable key" />
        </ul>
        <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-ink-soft">
          <li>Run <code className="rounded bg-surface-muted px-1">supabase/hcm_full_schema.sql</code> once in the Supabase SQL editor.</li>
          <li>Create a file named <code className="rounded bg-surface-muted px-1">.env.local</code> next to <code className="rounded bg-surface-muted px-1">package.json</code> with both values above (Supabase → Connect, or Project Settings → API Keys).</li>
          <li>Stop the dev server (Ctrl + C) and run <code className="rounded bg-surface-muted px-1">npm run dev</code> again — env files are read only at start.</li>
        </ol>
      </div>
    </div>
  );
}
