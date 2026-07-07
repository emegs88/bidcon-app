import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bidcon · Área logada",
  description: "Plataforma da Prospere para clientes e parceiros Bidcon.",
  robots: { index: false, follow: false }, // área logada não é indexada
};

// Aplica tema + escala de fonte ANTES do primeiro paint, lendo a preferência
// salva (ou o tema do sistema na primeira visita). Roda inline no <head> para
// não haver "flash" de tema errado. Mantido em string para ser síncrono.
const THEME_BOOTSTRAP = `
(function () {
  try {
    var d = document.documentElement;
    var t = localStorage.getItem('bidcon-theme');
    if (t !== 'light' && t !== 'dark' && t !== 'contrast') {
      t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    d.setAttribute('data-theme', t);
    var f = localStorage.getItem('bidcon-font');
    if (f === 'sm' || f === 'lg' || f === 'xl') d.setAttribute('data-font', f);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {children}
        <Script src="/prosperito-widget.js" strategy="lazyOnload" />
      </body>
    </html>
  );
}
