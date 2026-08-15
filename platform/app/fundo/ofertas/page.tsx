// ============================================================================
// /fundo/ofertas — FIDC-OFERTAS-01 · Entrega 2: "o fundo vê suas próprias ofertas"
// ----------------------------------------------------------------------------
// Server Component atrás de `exigirFundoPagina()`. Lê SÓ as ofertas deste fundo:
// o `.eq("fundo_id", fundo.id)` não é conveniência de consulta, é a regra — o
// xtv é lido por service_role, que ignora RLS, então o recorte por fundo tem de
// existir aqui, escrito, em toda consulta desta pasta.
//
// EXPIRAÇÃO CONFERIDA NA LEITURA, como a ordem manda ("sem cron novo").
// `statusEfetivo()` decide, no momento em que a página é montada, se uma oferta
// 'ativa' já morreu pela passagem do tempo. O banco continua com 'ativa'
// gravado, e está certo assim: a coluna registra o que alguém DECIDIU (mandou,
// aceitou, retirou); o tempo não é decisão de ninguém e não precisa de UPDATE
// para ser verdade. A varredura que carimba as vencidas entra na E4, no cron
// diário que já existe.
//
// AINDA NÃO HÁ DADO PESSOAL AQUI, e continua não havendo de propósito: a lista
// mostra a oferta e a contagem de cartas. Quem vende só aparece depois do
// aceite — é a Entrega 3 que abre essa porta, e ela abre para o aceite, não
// para a curiosidade.
// ============================================================================
import { exigirFundoPagina } from "@/lib/fidc-fundos";
import {
  statusEfetivo,
  restanteMs,
  type StatusOferta,
} from "@/lib/fidc-ofertas";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { dataHoraAnoBR } from "@/lib/data-br";
import areaStyles from "@/components/area.module.css";
import { Contador } from "./Contador";
import styles from "../fundo.module.css";

export const dynamic = "force-dynamic";

type OfertaLinha = {
  id: string;
  escopo: string | null;
  oferta_pct_credito: number | null;
  valor_total_calculado: number | null;
  status: string | null;
  criado_em: string | null;
  expira_em: string | null;
  criado_por_email: string | null;
};

function brl(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const ROTULO: Record<StatusOferta, string> = {
  ativa: "ativa",
  aceita_parcial: "aceita em parte",
  aceita: "aceita",
  expirada: "expirada",
  retirada: "retirada",
};

function tomDe(s: StatusOferta): "info" | "ok" | "muted" | "amber" {
  if (s === "ativa") return "info";
  if (s === "aceita") return "ok";
  if (s === "aceita_parcial") return "amber";
  return "muted";
}

export default async function OfertasDoFundoPage() {
  const { fundo, nome } = await exigirFundoPagina();
  const db = createXtvClient();
  const agora = new Date();

  const { data, error } = await db
    .from("fidc_ofertas")
    .select(
      "id,escopo,oferta_pct_credito,valor_total_calculado,status,criado_em,expira_em,criado_por_email"
    )
    .eq("fundo_id", fundo.id)
    .order("criado_em", { ascending: false })
    .limit(200);
  if (error) throw error;

  const ofertas = (data ?? []) as unknown as OfertaLinha[];

  // Quantas cartas em cada oferta. Consulta separada porque o PostgREST não faz
  // `count` agregado por grupo numa ida só; contar aqui, em memória, sobre os
  // itens das ofertas já listadas, é uma consulta a mais e nenhuma surpresa.
  const contagem = new Map<string, number>();
  if (ofertas.length > 0) {
    const { data: itens, error: erroItens } = await db
      .from("fidc_oferta_itens")
      .select("oferta_id")
      .in(
        "oferta_id",
        ofertas.map((o) => o.id)
      );
    if (erroItens) throw erroItens;
    for (const i of (itens ?? []) as { oferta_id: string }[]) {
      contagem.set(i.oferta_id, (contagem.get(i.oferta_id) ?? 0) + 1);
    }
  }

  return (
    <AppShell nome={nome} tipo="fundo">
      <div className={areaStyles.stack}>
        <PageHeader
          title="Minhas ofertas"
          subtitle={`${fundo.nome} · ${ofertas.length} ${
            ofertas.length === 1 ? "oferta registrada" : "ofertas registradas"
          }`}
          backHref="/fundo"
          backLabel="Vitrine"
        />

        <section className={areaStyles.section}>
          {ofertas.length === 0 ? (
            <EmptyState
              icon="📄"
              title="Nenhuma oferta ainda"
              description="Selecione cartas na vitrine e monte a primeira oferta."
              action={
                <a href="/fundo" className={styles.btnFiltrar}>
                  Ir para a vitrine
                </a>
              }
            />
          ) : (
            <ul className={styles.listaOfertas}>
              {ofertas.map((o) => {
                const expira = o.expira_em ? new Date(o.expira_em) : null;
                // Status BRUTO do banco só entra em `statusEfetivo` se for um
                // dos conhecidos. Valor inesperado (migração futura, escrita à
                // mão) é mostrado como veio, sem ser reinterpretado.
                const bruto = (o.status ?? "") as StatusOferta;
                const efetivo: StatusOferta =
                  expira && bruto in ROTULO
                    ? statusEfetivo(bruto, expira, agora)
                    : bruto;
                const falta = expira ? restanteMs(expira, agora) : 0;

                return (
                  <li key={o.id}>
                    <Card>
                      <div className={styles.ofertaTopo}>
                        <strong className={styles.ofertaValor}>
                          {brl(o.valor_total_calculado)}
                        </strong>
                        <Badge tone={tomDe(efetivo)}>
                          {ROTULO[efetivo] ?? efetivo ?? "—"}
                        </Badge>
                        {efetivo === "ativa" && (
                          <Contador restanteMsInicial={falta} />
                        )}
                      </div>

                      <p className={styles.ofertaDados}>
                        {contagem.get(o.id) ?? 0}{" "}
                        {(contagem.get(o.id) ?? 0) === 1 ? "carta" : "cartas"} ·{" "}
                        {o.oferta_pct_credito ?? "—"}% do valor do crédito ·{" "}
                        {o.escopo === "lote" ? "lote" : "carta avulsa"}
                      </p>

                      <p className={styles.ofertaRodape}>
                        enviada em {dataHoraAnoBR(o.criado_em)} por{" "}
                        {o.criado_por_email ?? "—"} · vale até{" "}
                        {dataHoraAnoBR(o.expira_em)}
                      </p>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
