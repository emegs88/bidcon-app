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
import { enviarInstagram } from "@/lib/instagram/graph";
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

// ----------------------------------------------------------------------------
// PAINEL-WA-01, item 1 — releitura de status imediatamente antes de emitir.
// ----------------------------------------------------------------------------
// O gate por VALOR (job.conversaStatus, fotografado no webhook) continua
// valendo: é barato e evita trabalho inútil. Mas entre a foto e o envio
// passam o debounce (8s), o download/visão do anexo e a geração pela
// Anthropic — 10 a 20 segundos em que o operador pode clicar "Assumir" no
// painel, que é justamente quando ele clica: ao ver a conversa chegar.
// Confiar no valor que viajou dentro do job produz agente e humano
// respondendo juntos, o cenário que o painel existe pra impedir.
//
// Mesmo padrão que graph.ts:sendText já aplica pro opt_out (releitura
// fresca no último instante) — aqui só se completa pro status. A decisão
// "o agente deve falar?" fica no PROCESSADOR e não no transporte: o
// transporte precisa continuar servindo o envio MANUAL do painel, que é
// legítimo exatamente quando status='humano'.
//
// Falha de leitura devolve `false` (NÃO silencia), mesmo critério de
// contarFallbacksRecentes em cerebro.ts: consulta que falhou não é
// informação, e não pode mudar o comportamento por conta própria. Não
// saber que virou humano é diferente de saber que virou.
async function assumidaPorHumano(
  db: ReturnType<typeof createXtvClient>,
  conversaId: string
): Promise<boolean> {
  const { data, error } = await db
    .from("wa_conversas")
    .select("status")
    .eq("id", conversaId)
    .maybeSingle();
  if (error || !data) {
    console.error(
      "[whatsapp/background] releitura de status falhou (não silencia):",
      error?.message ?? "sem linha"
    );
    return false;
  }
  return data.status === "humano";
}

// Registra na própria thread o texto que o agente gerou e NÃO enviou porque
// a conversa foi assumida no meio do caminho. Mensagem que some sem rastro é
// pior que resposta duplicada: o operador precisa ver o que o agente ia
// dizer. papel='sistema' é descartado do histórico mandado à Anthropic (ver
// montarMensagensWa em cerebro.ts) — o texto fica visível pro humano sem
// virar memória do modelo, isto é, sem o agente passar a agir como se
// tivesse dito o que não disse. status_envio fica NULL de propósito: não
// houve tentativa de envio, e null é o que toda mensagem não-enviada já usa.
async function registrarDescarte(
  db: ReturnType<typeof createXtvClient>,
  conversaId: string,
  texto: string,
  onde: string
): Promise<void> {
  const { error } = await db.from("wa_mensagens").insert({
    conversa_id: conversaId,
    papel: "sistema",
    conteudo: `[não enviado — conversa assumida por humano antes do envio · ${onde}]\n${texto}`,
    agente: "descarte_handoff",
  });
  if (error) {
    console.error("[whatsapp/background] falha ao registrar descarte:", error.message);
  }
}

export type WaJob = {
  conversaId: string;
  /** Telefone E.164 no canal 'whatsapp'; IGSID no canal 'instagram' — é a
   *  mesma coluna wa_conversas.telefone nos dois casos (ver migration 0067). */
  telefone: string;
  msgInseridaId: number;
  anexoId: string | null;
  /** PROSPERITO-ANEXO-01, Entrega 2: o `filename` que a Meta mandou. OPCIONAL
   *  de propósito — o webhook do Instagram também monta WaJob e não tem esse
   *  dado; torná-lo obrigatório quebraria o outro canal para guardar um nome.
   *  Ausente vira null e a tela cai no rótulo genérico do tipo. */
  anexoNome?: string | null;
  conversaOptOut: boolean;
  conversaStatus: string | null;
  agenteAtivo: string | null;
  podeResponder: boolean;
  /** INSTA-01. Ausente = 'whatsapp'. O webhook do WhatsApp NÃO preenche este
   *  campo (seu diff é vazio, por exigência da OS) — então todo job vindo de
   *  lá cai no default e segue por sendText exatamente como antes. */
  canal?: "whatsapp" | "instagram";
};

// ----------------------------------------------------------------------------
// INSTA-01 — único ponto onde o canal importa: o TRANSPORTE.
// ----------------------------------------------------------------------------
// Debounce, lock, releitura de status, gate de humano, cérebro, guardrail de
// compliance e opt-out são idênticos nos dois canais — de propósito: canal
// não muda regra de negócio, muda por onde a frase sai. Por isso a bifurcação
// vive aqui, nas duas linhas de envio, e não espalhada pelo fluxo.
//
// O default explícito ('whatsapp' quando `canal` é undefined) é o que garante
// que o comportamento do WhatsApp não muda um byte: mesmos argumentos, mesma
// função, mesma ordem.
async function enviarPorCanal(
  job: WaJob,
  params: {
    conversaId: string;
    texto: string;
    agente?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
  }
): Promise<{ ok: boolean; erro?: string }> {
  if (job.canal === "instagram") {
    return enviarInstagram({
      conversaId: params.conversaId,
      igsid: job.telefone,
      texto: params.texto,
      agente: params.agente,
      tokensIn: params.tokensIn,
      tokensOut: params.tokensOut,
    });
  }
  return sendText({
    conversaId: params.conversaId,
    telefone: job.telefone,
    texto: params.texto,
    agente: params.agente,
    tokensIn: params.tokensIn,
    tokensOut: params.tokensOut,
  });
}

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

      // PROSPERITO-ANEXO-01, Entrega 2: as três colunas novas viajam no MESMO
      // update do storage_path — nenhuma ida a mais ao banco.
      //
      // O mime e o tamanho vêm do arquivo BAIXADO, não do que a Meta declarou
      // no webhook: aqui já lemos os bytes, então este é o dado observado, e
      // observado ganha de declarado. O nome, ao contrário, só existe no
      // webhook (a Graph Media API não devolve filename) — por isso ele viaja
      // no job. Sem nome, fica null: a tela prefere dizer "PDF" a inventar.
      await db
        .from("wa_mensagens")
        .update({
          storage_path: storagePath,
          mime_type: midia.mimeType,
          nome_arquivo: job.anexoNome ?? null,
          tamanho_bytes: midia.bytes.byteLength,
        })
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
        // Releitura antes de emitir (item 1): entre a foto do status no
        // webhook e este ponto passaram o download da mídia e a chamada de
        // visão — segundos de sobra pro operador assumir.
        const resumo = resumoExtratoWa(extrato);
        if (await assumidaPorHumano(db, conversaId)) {
          console.log(
            "[whatsapp/background] resumo de extrato NÃO enviado — conversa assumida por humano",
            JSON.stringify({ conversaId })
          );
          await registrarDescarte(db, conversaId, resumo, "resumo de extrato");
        } else {
          await enviarPorCanal(job, {
            conversaId,
            texto: resumo,
            agente: "sistema_extrato",
          });
        }
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
    console.log(
      "[whatsapp/background][diag] pós-debounce",
      JSON.stringify({ conversaId, msgInseridaId, ultimaMsgClienteId: ultimaMsgCliente?.id ?? null, souAUltima })
    );
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

    console.log(
      "[whatsapp/background][diag] lock",
      JSON.stringify({ conversaId, lockAdquirido: !!(lockAdquirido && lockAdquirido.length > 0) })
    );
    if (!lockAdquirido || lockAdquirido.length === 0) return;

    try {
      const resultado = await gerarRespostaWhatsApp(
        db,
        conversaId,
        agenteValido(job.agenteAtivo),
        telefone
      );
      console.log(
        "[whatsapp/background][diag] resultado gerarRespostaWhatsApp",
        JSON.stringify({ conversaId, temResultado: !!resultado })
      );
      if (resultado) {
        // Releitura antes de emitir (item 1) — último instante possível:
        // depois do debounce, depois do lock e depois da geração pela
        // Anthropic, que é o trecho mais demorado de todos. O `return`
        // aborta o job sem aplicar `updates` (agente_ativo / escalarHumano):
        // se um humano assumiu, a resposta descartada não pode mexer no
        // estado da conversa. O `finally` abaixo libera o lock de qualquer
        // forma.
        if (await assumidaPorHumano(db, conversaId)) {
          console.log(
            "[whatsapp/background] resposta NÃO enviada — conversa assumida por humano durante a geração",
            JSON.stringify({ conversaId, agente: resultado.agenteQueRespondeu })
          );
          await registrarDescarte(db, conversaId, resultado.texto, "resposta do agente");
          return;
        }

        await enviarPorCanal(job, {
          conversaId,
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
