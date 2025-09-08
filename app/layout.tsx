import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CastingPods — Study Chat & Podcast",
  description: "Paste any lecture, then chat with it or listen as a mini-podcast.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
