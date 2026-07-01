// /parceiro — painel do parceiro. Server Component.
// Lê via RLS (parceiro só enxerga o que é dele: policies 0002). Mostra
// cartões-resumo (cartas por status, processos ativos, comissões previstas/
// liberadas), balança da própria carteira, ranking interno das suas cartas e
// atalhos. Ranking/oportunidade são linguagem comercial — ok para parceiro,
// nunca para cliente. exigirPapel garante que só parceiro/admin entram.
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatGrid, type Stat } from "@/components/StatGrid";
import { Button } from "@/components/ui/Button";
import { Balanca } from "@/components/Balanca";
import { RankingCartas, AlertaOportunidade } from "@/components/RankingCartas";
import {
  fluxoDiario,
  resumoFluxo,
  rankearCartas,
  oportunidades,
  type CartaFluxo,
} from "@/lib/cartas-fluxo";
import { brl } from "@/lib/format";
import styles from "@/components/area.module.css";
import painel from "@/app/admin/painel.module.css";

export const dynamic = "force-dynamic";

export default async function ParceiroPainel() {
  const sessao = await exigirPapel("parceiro", "admin");
  const supabase = createClient();
  const uid = sessao.userId;

  // RLS filtra para o próprio parceiro; ainda assim filtramos por parceiro_id
  // explicitamente (admin enxergaria tudo sem isto).
  const [cartas, processos, comissoes] = await Promise.all([
    supabase
      .from("cartas")
      .select(
        "id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, status, criado_em"
      )
      .eq("parceiro_id", uid),
    supabase.from("processos").select("status").eq("parceiro_id", uid),
    supabase.from("comissoes").select("status, valor_comissao").eq("parceiro_id", uid),
  ]);

  const listaCartas = (cartas.data ?? []) as (CartaFluxo & { tipo?: string })[];
  const listaProc = processos.data ?? [];
  const listaCom = comissoes.data ?? [];

  // Balança da própria carteira (7d), ranking e oportunidades das suas cartas.
  const serie = fluxoDiario(listaCartas, 7);
  const resumo = resumoFluxo(serie);
  const ranking = rankearCartas(listaCartas, { limite: 10, janelaNovidade: 14 });
  const oport = oportunidades(listaCartas, { limite: 10 });

  const cartasDisp = listaCartas.filter((c) => c.status === "disponivel").length;
  const procAtivos = listaProc.filter(
    (p) => p.status !== "concluido" && p.status !== "cancelado"
  ).length;
  const comPrev = listaCom.filter((c) => c.status === "prevista").length;
  const comLib = listaCom.filter(
    (c) => c.status === "liberada" || c.status === "paga"
  ).length;

  const stats: Stat[] = [
    { label: "Cartas na carteira", value: listaCartas.length, hint: `${cartasDisp} disponíveis` },
    { label: "Processos ativos", value: procAtivos, hint: `${listaProc.length} no total` },
    { label: "Comissões previstas", value: comPrev },
    { label: "Comissões liberadas", value: comLib },
  ];

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Painel do parceiro"
        subtitle="Resumo da sua carteira, processos e comissões. Os números refletem apenas o que é seu."
        action={<Button href="/parceiro/carteira/nova" size="sm">Cadastrar carta</Button>}
      />

      <div className={styles.stack}>
        <StatGrid stats={stats} />

        <AlertaOportunidade quantidade={oport.length} />

        <div className={painel.grid2}>
          <Balanca serie={serie} resumo={resumo} titulo="Entrada de cartas (sua carteira)" />
          <RankingCartas
            cartas={ranking}
            titulo="Suas cartas em destaque (top 10)"
            hrefBase="/parceiro/carteira"
          />
        </div>

        <div className={styles.filtros}>
          <Button href="/parceiro/carteira/nova" size="sm">Cadastrar carta</Button>
          <Button href="/parceiro/carteira" variant="ghost" size="sm">Minha carteira</Button>
          <Button href="/parceiro/indicacoes" variant="ghost" size="sm">Indicações</Button>
          <Button href="/parceiro/comissoes" variant="ghost" size="sm">Comissões</Button>
        </div>

        <p className={styles.count}>
          Total estimado em comissões previstas:{" "}
          {brl(
            listaCom
              .filter((c) => c.status === "prevista")
              .reduce((s, c) => s + (c.valor_comissao ?? 0), 0)
          )}
          . Liberação e pagamento são feitos pela administração.
        </p>
      </div>
    </AppShell>
  );
}
