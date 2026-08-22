import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prospection IA",
  description: "Prospection commerciale B2B assistée par IA — conforme CNIL",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
