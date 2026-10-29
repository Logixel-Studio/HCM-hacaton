import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Logo } from "@/components/brand";

const DOCS: Record<string, { title: string; updated: string; sections: [string, string][] }> = {
  terms: {
    title: "Terms of Service", updated: "29 October 2026",
    sections: [
      ["Who these terms are between", "These terms are between the company that registers a workspace on HCM Master Suite (the “Customer”) and the operator of the service. People invited by the Customer use the service on the Customer’s behalf."],
      ["Your account", "Keep your sign-in details private. Sign-in codes are sent to your email and work once for 10 minutes. You are responsible for activity under your account; tell your administrator straight away if you think it was misused."],
      ["Customer data", "The Customer owns the data it puts into its workspace (employee records, attendance, payroll, documents). The service processes that data only to provide HCM Master Suite to the Customer."],
      ["Acceptable use", "Do not try to reach data your role does not allow, interfere with the service, upload unlawful content, or use the attendance camera to identify anyone without their knowledge."],
      ["Payroll and tax", "Payroll, tax and statutory calculations follow the rules configured in the workspace (for example FY 2025-26 salaried slabs, EOBI and provident fund). The Customer remains responsible for reviewing results and for its filings with the authorities."],
      ["AI copilot", "AI answers are generated from data the asking user may see and can contain mistakes. Check important figures before acting on them."],
      ["Availability and changes", "We work to keep the service available and secure, and may improve or change features. Material changes to these terms will be announced in the app."],
      ["Ending the service", "The Customer can stop using the service at any time and export its data first. Accounts of people who leave a company are deactivated by that company’s administrators."],
      ["Contact", "Questions about these terms: ask your company administrator, or contact the operator through the email address shown in your invitation emails."],
    ],
  },
  privacy: {
    title: "Privacy Policy", updated: "29 October 2026",
    sections: [
      ["What we collect", "Account details (name, email), the HR records your employer enters (job, attendance, leave, payroll, documents), and, only if your company turns them on, your location at clock-in and a face template plus one reference photo for Face ID."],
      ["How it is protected", "Data is stored in your company’s database with encryption at rest. Row-level security means each person can only reach what their role allows; for example, salaries are visible only to the employee and pay roles. An audit log records every change."],
      ["Face ID", "Your face is turned into 128 numbers in your own browser. Those numbers and one reference photo are stored; the numbers can’t be read back by any user. Each clock-in keeps a selfie so HR can review attendance."],
      ["AI copilot", "When you ask the copilot a question, the records needed for that answer — already filtered to your role — are sent to the AI provider (Groq, or OpenRouter as a backup) to write the reply. Your chats are private to you."],
      ["Email", "Sign-in codes, invitations and account emails are sent from your company’s mail domain through our email provider."],
      ["What we never do", "No advertising, no selling of data, no third-party trackers."],
      ["Your choices", "Export your data any time from Settings → Privacy & data, delete your AI chats, and choose which notifications you receive. To correct official records or close your account, contact your HR team."],
      ["Retention", "Your employer decides how long employment records are kept, within the law. Sign-in codes are deleted within a day."],
      ["Contact", "For privacy questions, contact your company’s HR team first; they control your records."],
    ],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  return { title: DOCS[doc]?.title ?? "Legal" };
}
export function generateStaticParams() { return Object.keys(DOCS).map((doc) => ({ doc })); }

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = DOCS[doc];
  if (!d) notFound();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" aria-label="Home"><Logo /></Link>
          <nav className="flex gap-4 text-sm"><Link href="/legal/terms" className={doc === "terms" ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}>Terms</Link><Link href="/legal/privacy" className={doc === "privacy" ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}>Privacy</Link></nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="font-display text-4xl font-bold text-ink">{d.title}</h1>
        <p className="mt-2 text-sm text-ink-soft">Last updated {d.updated}</p>
        <div className="mt-10 space-y-8">
          {d.sections.map(([h, t], i) => (
            <section key={h}><h2 className="font-display text-lg font-semibold text-ink">{i + 1}. {h}</h2><p className="mt-2 leading-relaxed text-ink-soft">{t}</p></section>
          ))}
        </div>
        <p className="mt-12 text-sm"><Link href="/" className="font-medium text-brand-600">← Back to home</Link></p>
      </main>
    </div>
  );
}
