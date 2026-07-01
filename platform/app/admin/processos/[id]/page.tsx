// Detalhe do processo (admin): dados do cliente/carta, régua de status
// (reusa a Timeline de /meu-processo) e ações de avançar/cancelar status.
// A escrita real acontece na RPC avancar_status_processo (servidor).
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Timeline } from "@/app/meu-processo/Timeline";
import {
  LABEL_STATUS,
  LABEL_TIPO_BEM,
  LABEL_SUBETAPA,
  TONE_SUBETAPA,
  TONE_STATUS_PROCESSO,
  LABEL_STATUS_DOCUMENTO,
  TONE_STATUS_DOCUMENTO,
  LABEL_STATUS_PAGAMENTO,
  TONE_STATUS_PAGAMENTO,
  LABEL_STATUS_CONTRATO,
  TONE_STATUS_CONTRATO,
  brl,
  type StatusProcesso,
  type SubetapaProcesso,
  type StatusDocumento,
  type StatusPagamento,
  type StatusContrato,
} from "@/lib/status";
import { dataBR } from "@/lib/format";
import { ProcessoAcoes } from "./ProcessoAcoes";
import det from "./detalhe.module.css";

// signed URL curta para bucket privado do processo (docs/contratos). Server-only.
async function signedUrlProcesso(
  bucket: "processo-docs" | "contratos",
  path: string | null | undefined,
  ttl = 60,
): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, ttl);
  return data?.signedUrl ?? null;
}

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
      "id, status, subetapa, valor_carta, valor_entrada, cliente_id, parceiro_id, carta_id, criado_em, atualizado_em",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!processo) notFound();

  const ids = [processo.cliente_id, processo.parceiro_id].filter(
    Boolean,
  ) as string[];
  // admin (service_role) lê o check-list resolvido, sinal, contratos e a
  // comissão da carta — dados internos que NUNCA saem em payload de cliente.
  const admin = createAdminClient();
  const [
    { data: perfis },
    { data: carta },
    { data: eventos },
    { data: itensRaw },
    { data: sinalRow },
    { data: contratosRows },
  ] = await Promise.all([
    ids.length
      ? supabase.from("profiles").select("id, nome, email").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; nome: string | null; email: string | null }[] }),
    processo.carta_id
      ? supabase
          .from("cartas")
          .select("id, tipo, valor_credito, fonte, comissao_percentual")
          .eq("id", processo.carta_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("processo_eventos")
      .select("id, de_status, para_status, nota, em")
      .eq("processo_id", params.id)
      .order("em", { ascending: false }),
    admin.rpc("checklist_do_processo", { p_processo: params.id }),
    admin
      .from("pagamentos_sinal")
      .select("id, valor, status, comprovante_path, criado_em")
      .eq("processo_id", params.id)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("contratos")
      .select("id, tipo, status, pdf_path, assinado_em")
      .eq("processo_id", params.id),
  ]);

  const mapa = new Map((perfis ?? []).map((p) => [p.id, p]));
  const cliente = processo.cliente_id ? mapa.get(processo.cliente_id) : null;
  const parceiro = processo.parceiro_id ? mapa.get(processo.parceiro_id) : null;
  const status = processo.status as StatusProcesso;
  const subetapa = (processo.subetapa ?? null) as SubetapaProcesso | null;
  const trilha = (eventos ?? []) as Evento[];
  const cartaMeta = carta as {
    id: string;
    tipo: string;
    valor_credito: number;
    fonte: string | null;
    comissao_percentual: number | null;
  } | null;

  // documentos do check-list (com id p/ decisão + signed URL curta p/ visualizar).
  const docsRaw = (itensRaw ?? []) as Array<{
    checklist_item_id: string;
    rotulo: string;
    obrigatorio: boolean;
    doc_status: string | null;
    doc_motivo: string | null;
  }>;
  // ids dos documentos enviados por item (para o botão aprovar/reprovar).
  const { data: docsEnviados } = await admin
    .from("processo_documentos")
    .select("id, checklist_item_id, path, status, enviado_em")
    .eq("processo_id", params.id)
    .order("enviado_em", { ascending: false });
  const docPorItem = new Map<
    string,
    { id: string; path: string | null; status: string | null }
  >();
  for (const d of (docsEnviados ?? []) as Array<{
    id: string;
    checklist_item_id: string;
    path: string | null;
    status: string | null;
  }>) {
    if (!docPorItem.has(d.checklist_item_id)) {
      docPorItem.set(d.checklist_item_id, { id: d.id, path: d.path, status: d.status });
    }
  }
  const documentos = await Promise.all(
    docsRaw.map(async (r) => {
      const enviado = docPorItem.get(r.checklist_item_id) ?? null;
      return {
        itemId: r.checklist_item_id,
        rotulo: r.rotulo,
        obrigatorio: r.obrigatorio,
        docId: enviado?.id ?? null,
        status: (r.doc_status ?? null) as StatusDocumento | null,
        motivo: r.doc_motivo ?? null,
        url: enviado?.path ? await signedUrlProcesso("processo-docs", enviado.path) : null,
      };
    }),
  );

  const sinal = sinalRow as {
    id: string;
    valor: number | null;
    status: StatusPagamento;
    comprovante_path: string | null;
    criado_em: string;
  } | null;
  const sinalComprovanteUrl = sinal?.comprovante_path
    ? await signedUrlProcesso("processo-docs", sinal.comprovante_path)
    : null;
  const sinalPago = sinal?.status === "pago";

  const contratos = (contratosRows ?? []) as Array<{
    id: string;
    tipo: string;
    status: StatusContrato;
    pdf_path: string | null;
    assinado_em: string | null;
  }>;
  const contratoServico = contratos.find((c) => c.tipo === "servico") ?? null;
  const contratoCota = contratos.find((c) => c.tipo === "cota") ?? null;

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
            {/* metadados internos (admin-only): origem e comissão da carta.
                NUNCA aparecem em payload/tela de cliente ou parceiro. */}
            <div className={det.row}>
              <dt>Origem da carta</dt>
              <dd>{cartaMeta?.fonte ?? "—"}</dd>
            </div>
            <div className={det.row}>
              <dt>Comissão da carta</dt>
              <dd>
                {cartaMeta?.comissao_percentual != null
                  ? `${cartaMeta.comissao_percentual}%`
                  : "—"}
              </dd>
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
          {subetapa && (
            <p className={det.subetapa}>
              Sub-etapa atual:{" "}
              <Badge tone={TONE_SUBETAPA[subetapa]}>
                {LABEL_SUBETAPA[subetapa]}
              </Badge>
            </p>
          )}
        </Card>

        {documentos.length > 0 && (
          <Card as="section">
            <h2 className={det.h2}>Documentos do check-list</h2>
            <ul className={det.docs}>
              {documentos.map((d) => (
                <li key={d.itemId} className={det.docItem}>
                  <div className={det.docTopo}>
                    <span className={det.docRotulo}>
                      {d.rotulo}
                      {d.obrigatorio ? " *" : ""}
                    </span>
                    {d.status ? (
                      <Badge tone={TONE_STATUS_DOCUMENTO[d.status]}>
                        {LABEL_STATUS_DOCUMENTO[d.status]}
                      </Badge>
                    ) : (
                      <Badge tone="muted">Aguardando envio</Badge>
                    )}
                  </div>
                  {d.motivo && <p className={det.docMotivo}>{d.motivo}</p>}
                  {d.url && (
                    <a
                      className={det.docLink}
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir documento
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {sinal && (
          <Card as="section">
            <h2 className={det.h2}>Sinal (PIX)</h2>
            <dl className={det.dl}>
              <div className={det.row}>
                <dt>Valor</dt>
                <dd>{brl(sinal.valor)}</dd>
              </div>
              <div className={det.row}>
                <dt>Situação</dt>
                <dd>
                  <Badge tone={TONE_STATUS_PAGAMENTO[sinal.status]}>
                    {LABEL_STATUS_PAGAMENTO[sinal.status]}
                  </Badge>
                </dd>
              </div>
              {sinalComprovanteUrl && (
                <div className={det.row}>
                  <dt>Comprovante</dt>
                  <dd>
                    <a
                      href={sinalComprovanteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir comprovante
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        )}

        {(contratoServico || contratoCota) && (
          <Card as="section">
            <h2 className={det.h2}>Contratos</h2>
            <dl className={det.dl}>
              <div className={det.row}>
                <dt>Prestação de serviço</dt>
                <dd>
                  {contratoServico ? (
                    <Badge tone={TONE_STATUS_CONTRATO[contratoServico.status]}>
                      {LABEL_STATUS_CONTRATO[contratoServico.status]}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className={det.row}>
                <dt>Compra e venda da cota</dt>
                <dd>
                  {contratoCota ? (
                    <Badge tone={TONE_STATUS_CONTRATO[contratoCota.status]}>
                      {LABEL_STATUS_CONTRATO[contratoCota.status]}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          </Card>
        )}

        <Card as="section">
          <h2 className={det.h2}>Ações</h2>
          <ProcessoAcoes
            processoId={processo.id}
            atual={status}
            subetapa={subetapa}
            documentos={documentos.map((d) => ({
              docId: d.docId,
              rotulo: d.rotulo,
              status: d.status,
            }))}
            sinalId={sinal?.id ?? null}
            sinalPago={sinalPago}
            temContratoServico={Boolean(contratoServico)}
            temContratoCota={Boolean(contratoCota)}
          />
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
