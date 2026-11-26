import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { RegisterSW } from "@/components/register-sw";

export const metadata: Metadata = { title: "Eduquench", description: "Paid, verified online classes for Kenyan schools.", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { themeColor: "#0B3D91", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>
      <RegisterSW />
      <Nav />
      <main className="wrap">{children}</main>
      <footer className="wrap muted" style={{ fontSize: ".875rem" }}>Eduquench · Kenya · Times shown in East Africa Time</footer>
    </body></html>
  );
}
