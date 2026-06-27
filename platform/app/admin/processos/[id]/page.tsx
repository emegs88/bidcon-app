// Detalhe do processo (admin): dados do cliente/carta, régua de status
// (reusa a Timeline de /meu-processo) e ações de avançar/cancelar status.
// A escrita real acontece na RPC avancar_status_processo (servidor).
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Timeline } from "@/app/meu-processo/Timeline";
import {
  LABEL_STATUS,
  LABEL_TIPO_BEM,
  TONE_STATUS_PROCESSO,
  brl,
  type StatusProcesso,
} from "@/lib/status";
import { dataBR } from "@/lib/format";
import { ProcessoAcoes } from "./ProcessoAcoes";
import det from "@/app/cartas/[id]/detalhe.module.css";

export const dynamic = "force-dynamic";

type Evento = {
  id: string;
  de_status: StatusProcesso | null;
  para_status: StatusProcesso;
  nota: string | null;
  em: string;
};

export default async function AdminProcessoDetalhe({
  params,
}: {
  params: { id: string };
}) {
  const sessao = await exigirPapel("admin");
  const supabase = createClient();

  const { data: processo } = await supabase
    .from("processos")
    .select(
      "id, status, valor_carta, valor_entrada, cliente_id, parceiro_id, carta_id, criado_em, atualizado_em",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!processo) notFound();

  const ids = [processo.cliente_id, processo.parceiro_id].filter(
    Boolean,
  ) as string[];
  const [{ data: perfis }, { data: carta }, { data: eventos }] =
    await Promise.all([
      ids.length
        ? supabase.from("profiles").select("id, nome, email").in("id", ids)
        : Promise.resolve({ data: [] as { id: string; nome: string | null; email: string | null }[] }),
      processo.carta_id
        ? supabase
            .from("cartas")
            .select("id, tipo, valor_credito")
            .eq("id", processo.carta_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("processo_eventos")
        .select("id, de_status, para_status, nota, em")
        .eq("processo_id", params.id)
        .order("em", { ascending: false }),
    ]);

  const mapa = new Map((perfis ?? []).map((p) => [p.id, p]));
  const cliente = processo.cliente_id ? mapa.get(processo.cliente_id) : null;
  const parceiro = processo.parceiro_id ? mapa.get(processo.parceiro_id) : null;
  const status = processo.status as StatusProcesso;
  const trilha = (eventos ?? []) as Evento[];

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Processo"
        subtitle={cliente?.nome ?? "Cliente"}
        backHref="/admin/processos"
        backLabel="Processos"
        action={<Badge tone={TONE_STATUS_PROCESSO[status]}>{LABEL_STATUS[status]}</Badge>}
      />

      <div className={det.stack}>
        <Card as="section">
          <h2 className={det.h2}>Dados</h2>
          <dl className={det.dl}>
            <div className={det.row}>
              <dt>Cliente</dt>
              <dd>{cliente?.nome ?? cliente?.email ?? "—"}</dd>
            </div>
            <div className={det.row}>
              <dt>Parceiro</dt>
              <dd>{parceiro?.nome ?? parceiro?.email ?? "—"}</dd>
            </div>
            <div className={det.row}>
              <dt>Carta</dt>
              <dd>
                {carta
                  ? `${LABEL_TIPO_BEM[carta.tipo as "imovel" | "veiculo"]} · ${brl(carta.valor_credito)}`
                  : "—"}
              </dd>
            </div>
            <div className={det.row}>
              <dt>Valor da carta</dt>
              <dd>{brl(processo.valor_carta)}</dd>
            </div>
            <div className={det.row}>
              <dt>Entrada</dt>
              <dd>{brl(processo.valor_entrada)}</dd>
            </div>
            <div className={det.row}>
              <dt>Aberto em</dt>
              <dd>{dataBR(processo.criado_em)}</dd>
            </div>
          </dl>
        </Card>

        <Card as="section">
          <h2 className={det.h2}>Status</h2>
          <Timeline atual={status} />
        </Card>

        <Card as="section">
          <h2 className={det.h2}>Ações</h2>
          <ProcessoAcoes processoId={processo.id} atual={status} />
        </Card>

        {trilha.length > 0 && (
          <Card as="section">
            <h2 className={det.h2}>Histórico</h2>
            <dl className={det.dl}>
              {trilha.map((e) => (
                <div key={e.id} className={det.row}>
                  <dt>
                    {e.de_status
                      ? `${LABEL_STATUS[e.de_status]} → ${LABEL_STATUS[e.para_status]}`
                      : LABEL_STATUS[e.para_status]}
                    {e.nota ? ` · ${e.nota}` : ""}
                  </dt>
                  <dd>{dataBR(e.em)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
