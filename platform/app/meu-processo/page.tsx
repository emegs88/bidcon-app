// /meu-processo (Fase 1) — Server Component.
// Lê o processo do cliente logado (RLS garante que só vê o próprio), a carta
// vinculada e o histórico de eventos. Estado vazio quando não há processo.
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Timeline } from "./Timeline";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_STATUS,
  LABEL_TIPO_BEM,
  LABEL_SUBETAPA,
  TONE_SUBETAPA,
  type StatusProcesso,
  type SubetapaProcesso,
  type StatusContrato,
  type StatusDocumento,
} from "@/lib/status";
import { brl, dataBR } from "@/lib/format";
import { resumoSinal } from "@/lib/sinal";
import { cpfValido } from "@/lib/kyc";
import {
  dadosContratoServico,
  corpoContratoServico,
  dadosContratoCota,
  corpoContratoCota,
} from "@/lib/contratos";
import { ChecklistDocs, type ItemChecklist } from "./ChecklistDocs";
import { ContratoServico } from "./ContratoServico";
import { ContratoCota, type EstadoGateCota } from "./ContratoCota";
import { AgenteChat } from "./AgenteChat";
import styles from "./processo.module.css";
import fluxo from "./fluxo.module.css";

// contatos oficiais do cliente (públicos). Instagram @bidcon.br.
const WA = "5519997561909";
const EMAIL = "contato@prospere.com.br";
const INSTAGRAM = "bidcon.br";

export default async function MeuProcesso() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // identificação do usuário para a casca + qualificação do CONTRATANTE
  // (nome + CPF + e-mail vêm de `profiles` — fonte única, independente do
  // KYC de documento/selfie, que segue à parte em kyc_perfis).
  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, tipo, cpf, email")
    .eq("id", user.id)
    .single();
  const nome = profile?.nome ?? user.email ?? null;
  const tipo = profile?.tipo as "cliente" | "parceiro" | "admin" | undefined;

  // RLS: retorna apenas processos do próprio cliente
  const { data: processo } = await supabase
    .from("processos")
    .select("id, status, subetapa, prazo_em, valor_carta, valor_entrada, carta_id")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ----- estado vazio -----
  if (!processo) {
    return (
      <AppShell nome={nome} tipo={tipo}>
        <PageHeader title="Meu processo" backHref="/" />
        <EmptyState
          title="Nenhum processo em andamento"
          description="Assim que uma negociação começar, o andamento aparece nesta tela."
          action={
            <Button href={`https://wa.me/${WA}`}>Falar com o atendimento</Button>
          }
        />
      </AppShell>
    );
  }

  // ----- carta vinculada (RLS pode bloquear leitura da carta de outro parceiro;
  // por isso tratamos ausência com segurança) -----
  let carta: { tipo: string; valor_credito: number; valor_entrada: number | null } | null = null;
  if (processo.carta_id) {
    const { data } = await supabase
      .from("cartas")
      .select("tipo, valor_credito, valor_entrada")
      .eq("id", processo.carta_id)
      .maybeSingle();
    carta = data ?? null;
  }

  // ----- histórico de eventos -----
  const { data: eventos } = await supabase
    .from("processo_eventos")
    .select("de_status, para_status, nota, em")
    .eq("processo_id", processo.id)
    .order("em", { ascending: true });

  const statusAtual = processo.status as StatusProcesso;
  const subetapa = (processo.subetapa ?? null) as SubetapaProcesso | null;

  // ----- dados do fluxo pós-reserva (RLS: só o próprio processo) -----
  // check-list resolvido no servidor via RPC `checklist_do_processo`: o cliente
  // recebe SÓ os rótulos dos itens + status do envio — NUNCA o nome da
  // administradora (que a RPC usa internamente só para achar o modelo).
  const { data: itensRaw } = await supabase.rpc("checklist_do_processo", {
    p_processo: processo.id,
  });

  const itensChecklist: ItemChecklist[] = (
    (itensRaw ?? []) as Array<{
      checklist_item_id: string;
      rotulo: string;
      obrigatorio: boolean;
      doc_status: string | null;
      doc_motivo: string | null;
    }>
  ).map((r) => ({
    id: String(r.checklist_item_id),
    rotulo: String(r.rotulo),
    obrigatorio: Boolean(r.obrigatorio),
    docStatus: (r.doc_status ?? null) as StatusDocumento | null,
    motivo: r.doc_motivo ?? null,
  }));

  // contratos do processo (serviço e cota) — só status; corpo é montado abaixo.
  const { data: contratosRows } = await supabase
    .from("contratos")
    .select("tipo, status")
    .eq("processo_id", processo.id);
  const contratoServicoStatus =
    (contratosRows?.find((c) => (c as { tipo: string }).tipo === "servico")?.status ??
      null) as StatusContrato | null;
  const contratoCotaStatus =
    (contratosRows?.find((c) => (c as { tipo: string }).tipo === "cota")?.status ??
      null) as StatusContrato | null;

  // reserva vinculada ao processo (migration 0067: reservar_carta grava a
  // linha DRAFT na mesma transação). O contrato da cota (gerar_contrato,
  // 0066) exige: reserva existente + Termo de Reserva assinado (state fora de
  // DRAFT/ANUENCIA_DENIED/REFUNDED/CLOSED/DISPUTED) + documentação completa.
  // Esta é uma leitura de EXIBIÇÃO — o gate real é sempre revalidado
  // server-side pela RPC em /api/processo/contrato.
  const { data: reservaRow } = await supabase
    .from("reservas")
    .select("state, created_at")
    .eq("processo_id", processo.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const TERMO_PENDENTE_STATES = new Set([
    "DRAFT",
    "ANUENCIA_DENIED",
    "REFUNDED",
    "CLOSED",
    "DISPUTED",
  ]);
  const itensObrigatorios = itensChecklist.filter((i) => i.obrigatorio);
  // Nota: se não houver checklist (nenhum item obrigatório resolvido), trata
  // como documentação incompleta — mais conservador que a RPC docs_completas
  // no caso extremo de um modelo sem nenhum item obrigatório, mas alinhado ao
  // caso real (nenhum modelo ativo) e sem risco de liberar contrato indevido.
  const docsCompletas =
    itensObrigatorios.length > 0 &&
    itensObrigatorios.every((i) => i.docStatus === "aprovado");
  const estadoGateCota: EstadoGateCota = !reservaRow
    ? "reserva_inexistente"
    : TERMO_PENDENTE_STATES.has(reservaRow.state as string)
      ? "termo_nao_assinado"
      : !docsCompletas
        ? "docs_incompletas"
        : "liberado";

  // qualificação completa do CONTRATANTE (nome + CPF + e-mail), fonte única
  // em `profiles`. Enquanto nome/CPF não estiverem preenchidos e válidos, o
  // aceite do contrato de serviço fica bloqueado (QualificacaoGate na UI;
  // gate real é server-side em /api/processo/contrato).
  const clienteNome = profile?.nome?.trim() ?? "";
  const clienteCpf = (profile as { cpf: string | null } | null)?.cpf ?? null;
  const clienteEmail = profile?.email ?? user.email ?? "";
  const precisaQualificacao = !clienteNome || !cpfValido(clienteCpf);

  // valor factual usado no snapshot dos contratos (campo legado do modelo;
  // sem exibição de sinal/PIX na tela — ver SINAL-CLEANUP-01 no backlog).
  const { sinal: valorSinal } = resumoSinal({
    valor_credito: carta?.valor_credito ?? null,
    valor_entrada: carta?.valor_entrada ?? processo.valor_entrada ?? null,
  });

  // corpo do contrato de SERVIÇO (modelo fixo + dados do cliente; sanitizado).
  const corpoServico = corpoContratoServico(
    dadosContratoServico({ clienteNome, clienteCpf, clienteEmail, valorSinal })
  );

  // corpo do contrato da COTA — só montado quando o gate de exibição libera
  // (gate real é sempre a RPC gerar_contrato; aqui é só exibição).
  const corpoCota =
    estadoGateCota === "liberado" && carta
      ? corpoContratoCota(
          dadosContratoCota({
            clienteNome,
            clienteCpf,
            clienteEmail,
            bemTipo: carta.tipo,
            valorCredito: carta.valor_credito,
            valorEntrada: carta.valor_entrada,
            valorSinal,
          })
        )
      : null;

  return (
    <AppShell nome={nome} tipo={tipo}>
      <PageHeader
        title="Meu processo"
        backHref="/"
        subtitle="Acompanhe cada etapa. As datas dependem da administradora do consórcio; esta tela não promete prazo de contemplação."
      />

      <div className={styles.stack}>
        <Card>
          <h2 className={styles.h2}>Andamento</h2>
          <Timeline atual={statusAtual} />
        </Card>

        {/* Painel guiado da sub-etapa atual (fluxo pós-reserva). Nunca exibe
            administradora/comissão/origem — só o próximo passo do cliente. */}
        {statusAtual !== "concluido" && statusAtual !== "cancelado" && (
          <Card>
            <div className={fluxo.painel}>
              <div className={fluxo.passo}>
                <div>
                  <h2 className={styles.h2}>Próximos passos</h2>
                  {subetapa && (
                    <p className={fluxo.passoDica}>{LABEL_SUBETAPA[subetapa]}</p>
                  )}
                </div>
                {subetapa && (
                  <Badge tone={TONE_SUBETAPA[subetapa]}>
                    {LABEL_SUBETAPA[subetapa]}
                  </Badge>
                )}
              </div>

              {processo.prazo_em && (
                <p className={fluxo.aviso}>
                  Reserva válida até {dataBR(processo.prazo_em)}. Esta data é o
                  prazo da reserva da cota — não é previsão de contemplação.
                </p>
              )}

              {/* 1) Documentos do check-list da administradora (só rótulos) */}
              <ChecklistDocs processoId={processo.id} itens={itensChecklist} />

              {/* 2) Contrato de serviço (ordem jurídica: serviço → Termo de */}
              {/*    Reserva → documentação → cota) */}
              <ContratoServico
                processoId={processo.id}
                corpo={corpoServico}
                status={contratoServicoStatus}
                precisaQualificacao={precisaQualificacao}
                nomeAtual={clienteNome}
                cpfAtual={clienteCpf ?? ""}
              />

              {/* 3) Contrato de compra e venda da cota — libera após reserva
                  existente + Termo de Reserva assinado + docs completas. */}
              <ContratoCota
                processoId={processo.id}
                corpo={corpoCota}
                status={contratoCotaStatus}
                estado={estadoGateCota}
              />
            </div>
          </Card>
        )}

        {carta && (
          <Card>
            <h2 className={styles.h2}>Carta em negociação</h2>
            <dl className={styles.dl}>
              <div className={styles.row}>
                <dt>Tipo</dt>
                <dd>{LABEL_TIPO_BEM[carta.tipo] ?? carta.tipo}</dd>
              </div>
              <div className={styles.row}>
                <dt>Crédito</dt>
                <dd>{brl(carta.valor_credito)}</dd>
              </div>
              <div className={styles.row}>
                <dt>Entrada estimada</dt>
                <dd>{brl(carta.valor_entrada)}</dd>
              </div>
            </dl>
          </Card>
        )}

        {eventos && eventos.length > 0 && (
          <Card>
            <h2 className={styles.h2}>Histórico</h2>
            <ul className={styles.hist}>
              {eventos.map((ev, i) => (
                <li key={i}>
                  <b>{LABEL_STATUS[ev.para_status as StatusProcesso]}</b>
                  {ev.nota ? ` — ${ev.nota}` : ""}
                  <span className={styles.data}>{dataBR(ev.em)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Agente de ajuda (respostas factuais e sanitizadas no servidor) */}
        <Card>
          <h2 className={styles.h2}>Precisa de ajuda?</h2>
          <AgenteChat processoId={processo.id} />
        </Card>

        {/* Contatos oficiais (públicos): WhatsApp, e-mail e Instagram @bidcon.br */}
        <Card>
          <h2 className={styles.h2}>Fale com a gente</h2>
          <div className={fluxo.contatos}>
            <a
              className={fluxo.contatoItem}
              href={`https://wa.me/${WA}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp
            </a>
            <a className={fluxo.contatoItem} href={`mailto:${EMAIL}`}>
              {EMAIL}
            </a>
            <a
              className={fluxo.contatoItem}
              href={`https://instagram.com/${INSTAGRAM}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{INSTAGRAM}
            </a>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
