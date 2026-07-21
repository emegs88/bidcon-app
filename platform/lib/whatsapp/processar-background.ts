// ============================================================================
// Processamento em background do webhook WhatsApp — F4a (blindagem).
// ----------------------------------------------------------------------------
// Extração MECÂNICA dos blocos EXTRATO-01 e F2+F3 que antes rodavam inline
// dentro do POST de app/api/whatsapp/route.ts, aguardados (await) antes do
// ack 200 pra Meta. Nenhuma lógica de negócio foi reescrita aqui — só
// movida pra fora do ciclo request/response, invocada via waitUntil()
// depois que o ack já saiu (ver route.ts).
//
// Motivo (F4): a cadeia inteira (debounce de 8s + geração via Anthropic +
// envio via Graph API, ou download+visão no caso de anexo) rodando síncrona
// dentro do mesmo ciclo HTTP do webhook da Meta é vulnerável a um timeout
// do LADO DA META encerrar a conexão/invocação no meio, sem exceção
// capturável — 3 reproduções ao vivo em 2026-07-21 (12:05:31Z, 14:51:35Z,
// 15:36:01Z) bateram exatamente esse padrão: inbound persistido, zero
// resposta, zero log de erro. waitUntil() desacopla o processamento do
// ciclo de vida da conexão HTTP com o Meta.
//
// Cada job já chega com os dados mínimos capturados no momento do F1
// (persistência), mesmo padrão do que o loop antigo em route.ts fazia
// inline — não reconsulta wa_conversas no início; a única releitura fresca
// já existente (checar "sou a última mensagem" antes do lock) é preservada
// tal como estava.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";
import { gerarRespostaWhatsApp, agenteValido } from "@/lib/whatsapp/cerebro";
import { sendText } from "@/lib/whatsapp/graph";
import { baixarMidia, subirParaStorage } from "@/lib/whatsapp/media";
import { extrairExtrato, resumoExtratoWa } from "@/lib/whatsapp/extrato";

// EXTRATO-01-FIX + DEBOUNCE (ver nota original em route.ts, preservada
// aqui porque é aqui que o debounce de fato roda agora): DEBOUNCE_MS é
// quanto se espera, depois de gravar a mensagem do cliente, antes de
// decidir se É esta mensagem que deve gerar a resposta (só a mais recente
// da conversa no fim da espera dispara). LOCK_TTL_MS é rede de segurança
// contra o lock (wa_conversas.respondendo_desde) ficar preso pra sempre se
// o processamento for encerrado no meio antes de liberar.
const DEBOUNCE_MS = 8_000;
const LOCK_TTL_MS = 2 * 60_000;

export type WaJob = {
  conversaId: string;
  telefone: string;
  msgInseridaId: number;
  anexoId: string | null;
  conversaOptOut: boolean;
  conversaStatus: string | null;
  agenteAtivo: string | null;
  podeResponder: boolean;
};

/** Processa a lista de jobs de uma invocação do webhook — chamado via
 *  waitUntil() depois que o ack 200 já foi devolvido pra Meta. Falha em
 *  qualquer job/etapa é só logada (mesmo contrato de antes: nunca há
 *  ninguém esperando o retorno desta função pra decidir status HTTP). */
export async function processarJobsWhatsapp(
  db: ReturnType<typeof createXtvClient>,
  jobs: WaJob[]
): Promise<void> {
  // SONDA-DIAG (temporário, 2026-07-21): confirma que o background de fato
  // começou a rodar — remover depois que o F4a fechar verde.
  console.log("[whatsapp/background][diag] iniciando", jobs.length, "job(s)");
  for (const job of jobs) {
    try {
      console.log(
        "[whatsapp/background][diag] job start",
        JSON.stringify({ conversaId: job.conversaId, podeResponder: job.podeResponder, temAnexo: !!job.anexoId })
      );
      await processarUmJob(db, job);
      console.log("[whatsapp/background][diag] job fim ok", job.conversaId);
    } catch (e) {
      // Rede de segurança extra — os blocos internos já têm try/catch
      // próprio, mas um job não pode derrubar os seguintes da mesma
      // invocação.
      console.error("[whatsapp/background] falha inesperada no job:", e);
    }
  }
}

async function processarUmJob(
  db: ReturnType<typeof createXtvClient>,
  job: WaJob
): Promise<void> {
  const { conversaId, telefone, msgInseridaId, anexoId } = job;

  // WHATSAPP-EXTRATO-01 — extrato de cota anexado (document/image): baixa
  // da Graph Media API, sobe pro bucket privado wa-extratos, extrai os
  // campos via IA e grava 'pendente_revisao' em extratos_cotas. NUNCA
  // escreve em `cartas`. Falha em qualquer etapa é só logada — nunca
  // derruba o processamento dos demais jobs.
  if (anexoId) {
    try {
      const midia = await baixarMidia(anexoId);
      const storagePath = await subirParaStorage(conversaId, anexoId, midia);

      await db
        .from("wa_mensagens")
        .update({ storage_path: storagePath })
        .eq("id", msgInseridaId);

      const base64 = Buffer.from(midia.bytes).toString("base64");
      const extrato = await extrairExtrato({ mimeType: midia.mimeType, base64 });

      await db.from("extratos_cotas").insert({
        conversa_id: conversaId,
        mensagem_id: msgInseridaId,
        storage_path: storagePath,
        dados: extrato,
        administradora: extrato.administradora,
        grupo: extrato.grupo,
        cota: extrato.cota,
        valor_credito: extrato.valor_credito,
        saldo_devedor: extrato.saldo_devedor,
        parcelas_pagas: extrato.parcelas_pagas,
        parcelas_restantes: extrato.parcelas_restantes,
        valor_parcela: extrato.valor_parcela,
        contemplada: extrato.contemplada,
        confianca: extrato.confianca,
      });

      if (
        process.env.WHATSAPP_AGENT_ATIVO === "true" &&
        job.conversaOptOut !== true &&
        job.conversaStatus !== "humano"
      ) {
        await sendText({
          conversaId,
          telefone,
          texto: resumoExtratoWa(extrato),
          agente: "sistema_extrato",
        });
      }
    } catch (e) {
      console.error(
        "[whatsapp/background] falha ao processar extrato (anexo):",
        e instanceof Error ? e.message : e
      );
    }
  }

  // Fatia F2+F3 — Time Prosperito responde, se ligado (kill-switch) e a
  // conversa está livre (sem opt-out — nem o histórico nem esta mesma
  // mensagem — e não escalada pra humano).
  if (!job.podeResponder) return;

  try {
    // Debounce: espera DEBOUNCE_MS e confere se chegou mensagem mais nova
    // do cliente nesta conversa nesse meio-tempo. Se chegou, este job sai
    // de cena silenciosamente (não é falha) — é o job da mensagem mais
    // nova, na sua própria passada por aqui, quem vai fazer essa mesma
    // checagem e (assumindo silêncio de DEBOUNCE_MS) gerar a resposta
    // cobrindo a rajada inteira.
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));

    const { data: ultimaMsgCliente } = await db
      .from("wa_mensagens")
      .select("id")
      .eq("conversa_id", conversaId)
      .eq("papel", "cliente")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    const souAUltima = !ultimaMsgCliente || ultimaMsgCliente.id === msgInseridaId;
    if (!souAUltima) return;

    // Lock: impede duas gerações simultâneas na mesma conversa (ex.: dois
    // jobs cujo debounce vence quase junto). UPDATE...WHERE é atômico por
    // linha no Postgres — das tentativas concorrentes, só uma consegue de
    // fato casar o WHERE e setar respondendo_desde; a(s) outra(s) veem 0
    // linhas afetadas e desistem sem erro. O braço `lt` do WHERE é só
    // destrave de lock preso (invocação anterior encerrada no meio) — não
    // é o caminho normal.
    const agoraIso = new Date().toISOString();
    const limiteStaleIso = new Date(Date.now() - LOCK_TTL_MS).toISOString();
    const { data: lockAdquirido } = await db
      .from("wa_conversas")
      .update({ respondendo_desde: agoraIso })
      .eq("id", conversaId)
      .or(`respondendo_desde.is.null,respondendo_desde.lt.${limiteStaleIso}`)
      .select("id");

    if (!lockAdquirido || lockAdquirido.length === 0) return;

    try {
      const resultado = await gerarRespostaWhatsApp(
        db,
        conversaId,
        agenteValido(job.agenteAtivo),
        telefone
      );
      if (resultado) {
        await sendText({
          conversaId,
          telefone,
          texto: resultado.texto,
          agente: resultado.agenteQueRespondeu,
          tokensIn: resultado.tokensIn,
          tokensOut: resultado.tokensOut,
        });

        const updates: Record<string, unknown> = {};
        if (
          resultado.proximoAgente &&
          resultado.proximoAgente !== resultado.agenteQueRespondeu
        ) {
          updates.agente_ativo = resultado.proximoAgente;
        }
        if (resultado.escalarHumano) {
          updates.status = "humano";
        }
        if (Object.keys(updates).length > 0) {
          await db.from("wa_conversas").update(updates).eq("id", conversaId);
        }
      }
    } finally {
      // Libera o lock sempre — sucesso, falha do agente (capturada abaixo)
      // ou qualquer outro caminho.
      await db.from("wa_conversas").update({ respondendo_desde: null }).eq("id", conversaId);
    }
  } catch (e) {
    console.error(
      "[whatsapp/background] falha ao gerar/enviar resposta do agente:",
      e instanceof Error ? e.message : e
    );
  }
}
