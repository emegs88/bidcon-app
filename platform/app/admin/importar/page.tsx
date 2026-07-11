// /admin/importar — console de importação de lotes de cartas (FATIA F1).
// ----------------------------------------------------------------------------
// Server Component. Gate: exigirAdminConsolePagina() (allowlist BIDCON_ADMIN_EMAILS,
// lib/admin-console.ts) — sem sessão -> /login; fora da allowlist -> /.
// Dados de fornecedores vêm do xtv (lib/fornecedores-xtv.ts, createXtvClient),
// NUNCA do nnv — ver nota em lib/admin-console.ts sobre os dois projetos Supabase.
// A tela em si não grava nada: só entrega o <ImportarConsoleForm> client, que
// chama /api/admin/importar/preview e /api/admin/importar/publicar.
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { listarFornecedoresAtivos } from "@/lib/fornecedores-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { ImportarConsoleForm } from "./ImportarConsoleForm";

export const dynamic = "force-dynamic";

export default async function ImportarConsolePage() {
  const { nome } = await exigirAdminConsolePagina();
  const fornecedores = await listarFornecedoresAtivos();

  return (
    <AppShell nome={nome} equipeAdminConsole>
      <PageHeader
        title="Importar cartas"
        subtitle="Envie um arquivo .csv ou cole o lote diretamente (se tiver .xlsx, salve como CSV antes). Cada linha é comparada ao estoque atual — nada é gravado até você conferir e publicar."
      />
      <ImportarConsoleForm fornecedoresIniciais={fornecedores} />
    </AppShell>
  );
}
