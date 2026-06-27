import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Bidcon · Área logada",
  description: "Plataforma da Prospere para clientes e parceiros Bidcon.",
  robots: { index: false, follow: false }, // área logada não é indexada
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          background: "#080B14",
          color: "#f6f6f8",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
