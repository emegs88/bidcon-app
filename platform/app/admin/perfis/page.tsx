// /admin/perfis — lista os clientes e o estado de KYC de cada um.
// Abas: Todos / Pendentes / Verificados / Bloqueados (espelha a referência).
// Leitura via RLS (admin enxerga todos os profiles e kyc_perfis). CPF aparece
// SEMPRE mascarado (mascararCpf) — LGPD por design, mesmo em tela de gestão.
// A decisão (verificar/rejeitar/bloquear) acontece no detalhe [id].
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  LABEL_STATUS_KYC,
  TONE_STATUS_KYC,
  type StatusKYC,
} from "@/lib/status";
import { mascararCpf, dataBR } from "@/lib/format";
import styles from "@/components/area.module.css";
import row from "@/components/ProcessoRow.module.css";

export const dynamic = "force-dynamic";

type Aba = "todos" | "pendentes" | "verificados" | "bloqueados";

const ABAS: { chave: Aba; label: string }[] = [
  { chave: "todos", label: "Todos" },
  { chave: "pendentes", label: "Pendentes" },
  { chave: "verificados", label: "Verificados" },
  { chave: "bloqueados", label: "Bloqueados" },
];

// Mapeia a aba para os status que ela mostra.
function statusDaAba(aba: Aba): StatusKYC[] | null {
  switch (aba) {
    case "pendentes":
      return ["pendente", "em_analise", "rejeitado"];
    case "verificados":
      return ["verificado"];
    case "bloqueados":
      return ["bloqueado"];
    default:
      return null; // todos
  }
}

export default async function AdminPerfis({
  searchParams,
}: {
  searchParams: { aba?: string };
}) {
  const sessao = await exigirPapel("admin");
  const supabase = createClient();

  const abaAtual: Aba =
    (ABAS.find((a) => a.chave === searchParams.aba)?.chave as Aba) ?? "todos";

  // Clientes + KYC (admin lê tudo por RLS).
  const [{ data: perfis }, { data: kycs }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, nome, email, criado_em")
      .eq("tipo", "cliente")
      .order("criado_em", { ascending: false }),
    supabase
      .from("kyc_perfis")
      .select("user_id, cpf, status_kyc, doc_path, criado_em"),
  ]);

  const mapaKyc = new Map(
    (kycs ?? []).map((k) => [k.user_id, k])
  );

  // Junta perfil + kyc; status default 'pendente' quando não há linha.
  const linhas = (perfis ?? []).map((p) => {
    const k = mapaKyc.get(p.id);
    return {
      id: p.id,
      nome: p.nome ?? p.email ?? "Cliente",
      email: p.email ?? null,
      criado_em: p.criado_em,
      cpf: (k?.cpf as string | undefined) ?? null,
      status: ((k?.status_kyc as StatusKYC | undefined) ?? "pendente") as StatusKYC,
      temDoc: Boolean(k?.doc_path),
    };
  });

  const filtro = statusDaAba(abaAtual);
  const lista = filtro
    ? linhas.filter((l) => filtro.includes(l.status))
    : linhas;

  const pendentes = linhas.filter(
    (l) => l.status === "em_analise" || l.status === "pendente" || l.status === "rejeitado"
  ).length;

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Perfis"
        backHref="/admin"
        backLabel="Administração"
        subtitle="Verificação de identidade (KYC) dos clientes. CPF exibido de forma mascarada."
      />

      <div className={styles.stack}>
        <div className={styles.filtros}>
          {ABAS.map((a) => (
            <Button
              key={a.chave}
              href={`/admin/perfis?aba=${a.chave}`}
              variant={a.chave === abaAtual ? "primary" : "ghost"}
              size="sm"
            >
              {a.label}
            </Button>
          ))}
        </div>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Clientes</h2>
            <span className={styles.count}>
              {linhas.length} no total · {pendentes} aguardando
            </span>
          </div>

          {lista.length === 0 ? (
            <EmptyState
              icon="🪪"
              title="Nenhum perfil nesta aba"
              description="Os clientes aparecem aqui assim que se cadastram e enviam a verificação."
            />
          ) : (
            <ul className={styles.list}>
              {lista.map((l) => (
                <Card key={l.id} as="li">
                  <div className={row.row}>
                    <div className={row.info}>
                      <span className={row.cliente}>{l.nome}</span>
                      <span className={row.meta}>
                        {l.email ?? "sem e-mail"} · CPF {mascararCpf(l.cpf)} · desde{" "}
                        {dataBR(l.criado_em)}
                      </span>
                      <Badge tone={TONE_STATUS_KYC[l.status]}>
                        {LABEL_STATUS_KYC[l.status]}
                      </Badge>
                    </div>
                    <Button href={`/admin/perfis/${l.id}`} size="sm" variant="ghost">
                      Abrir
                    </Button>
                  </div>
                </Card>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
