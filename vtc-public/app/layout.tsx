import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VTC Catalunya · Consulta de matrículas",
  description: "Consulta el listado VTC y aporta evidencias para revisión privada.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
