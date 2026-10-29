import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { themeBootScript } from "@/lib/theme";

const site = process.env.NEXT_PUBLIC_SITE_URL || "https://hcm.logixels.com";
const description = "HR, Face ID attendance, leave, Pakistan-ready payroll, hiring, performance and a role-aware AI copilot — one platform where every person sees exactly what their role allows.";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "HCM Master Suite — HR, attendance & payroll for Pakistan", template: "%s · HCM Master Suite" },
  description,
  applicationName: "HCM Master Suite",
  keywords: ["HRMS Pakistan", "payroll software Pakistan", "attendance with Face ID", "GPS attendance", "leave management", "HR software", "EOBI", "income tax slabs 2025-26"],
  manifest: "/manifest.webmanifest",
  openGraph: { type: "website", url: site, siteName: "HCM Master Suite", title: "HCM Master Suite — Run your entire workforce from one calm screen", description },
  twitter: { card: "summary_large_image", title: "HCM Master Suite", description },
  appleWebApp: { capable: true, title: "HCM Suite", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0284c7" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
