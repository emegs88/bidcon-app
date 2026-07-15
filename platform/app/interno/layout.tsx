// /interno/* — área interna (ferramentas de análise/venda, dados de comissão).
// Guard igual ao de /admin/*: exige papel "admin". Sem sessão → /login (via
// exigirPapel → getSessao); papel insuficiente → redireciona para "/".
import { exigirPapel } from "@/lib/auth";

export default async function InternoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await exigirPapel("admin");
  return <>{children}</>;
}
