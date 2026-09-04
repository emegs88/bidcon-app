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
import type { AgenteId } from "@/app/api/atende/_prompt";
import { sendText } from "@/lib/whatsapp/graph";
import { enviarInstagram } from "@/lib/instagram/graph";
import { baixarMidia, subirParaStorage } from "@/lib/whatsapp/media";
import { extrairExtrato, resumoExtratoWa } from "@/lib/whatsapp/extrato";
import { transcreverAudio } from "@/lib/whatsapp/transcricao";
import { rodarPonteNaConversa } from "@/lib/funil/gatilho";
import {
  cerebroConsegueLer,
  textoFallback,
  PREFIXO_TRANSCRICAO,
  type TipoMensagem,
} from "@/lib/whatsapp/tipos";

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

  // --------------------------------------------------------------------------
  // OUVIDO-01 v2 (b) — os quatro campos do áudio e da rede.
  // --------------------------------------------------------------------------
  // TODOS OPCIONAIS, e isso não é frouxidão: o webhook do Instagram também
  // monta WaJob (ver INSTA-01) e não conhece nenhum destes dados. Torná-los
  // obrigatórios quebraria o outro canal para guardar um campo.
  //
  // A consequência disso está no portão lá embaixo e é o ponto da Regra 19:
  // `conteudo === undefined` significa "não sei o que foi gravado", NÃO
  // significa "gravou vazio". Um job do Instagram tem de atravessar o portão
  // sem disparar rede nenhuma.

  /** `media_id` do áudio, quando a mensagem foi uma nota de voz. Campo SEPARADO
   *  de `anexoId` de propósito: `anexoId` é o caminho do EXTRATO (baixa, sobe
   *  pro bucket, chama visão, grava em extratos_cotas). Áudio não passa por
   *  nada disso. Reaproveitar o campo faria uma nota de voz virar tentativa de
   *  leitura de extrato. */
  audioId?: string | null;
  /** O `mime_type` que a META DECLAROU. A Graph também devolve um mime no
   *  download; quando os dois existirem o observado ganha do declarado, mas o
   *  declarado viaja porque é o que a gente já tem em mãos sem pagar rede. */
  audioMime?: string | null;
  /** `m.type` já normalizado por `normalizarTipo` — o mesmo valor gravado na
   *  coluna. Serve só para o fallback saber dizer "teu áudio" em vez de
   *  "tua mensagem". `null` é resposta legítima: a Meta não declarou tipo. */
  tipo?: TipoMensagem | null;
  /** O que o webhook DE FATO gravou em `wa_mensagens.conteudo`. É sobre isto
   *  que o portão pergunta — não sobre o tipo. Ver o cabeçalho de tipos.ts:
   *  rede por conteúdo não tem furo de vocabulário. */
  conteudo?: string;
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

// ----------------------------------------------------------------------------
// HANDOFF-01, item (a) — o handoff ATIVO.
// ----------------------------------------------------------------------------
// O DEFEITO QUE ISTO CORRIGE
//
// Até agora, quando o bastão passava (o `updates.agente_ativo` lá embaixo), o
// job simplesmente ACABAVA. O agente novo só falaria no PRÓXIMO webhook do
// cliente — quer dizer: nunca, se o cliente lesse a despedida do agente
// anterior como fim de papo. É esse silêncio que prende negócio vivo.
//
// KILL-SWITCH QUE NASCE ARMADO — DESVIO DECLARADO
//
// A doutrina desta casa é kill-switch nascer DESARMADO (`=== "on"`, como
// FAROL_SABER em lib/farol/saber.ts:74). Aqui eu inverto de propósito e
// declaro: HANDOFF_ATIVO só se cala com a string literal "off".
//
// A razão é medida, não estética: PROSPERITO_SEM_ENTRADA nasceu desarmado e
// segue na fila, até hoje, esperando alguém lembrar de armá-lo. Correção que
// sobe desarmada não corrige nada até esse dia — e este item foi classificado
// pela coordenação como "dinheiro vivo preso". O botão de desligar continua
// existindo e ao alcance da mão, que é o que um kill-switch precisa garantir;
// o que muda é só de que lado ele nasce.
// Exportada só para o teste: um kill-switch que inverte a doutrina da casa
// precisa de prova de que inverte exatamente onde eu disse — e não mais que
// isso. "OFF", "0", "false" e vazio NÃO desligam; só a string literal "off".
export function handoffAtivoLigado(): boolean {
  return process.env.HANDOFF_ATIVO !== "off";
}

// ============================================================================
// OUVIDO-01 v2 (c)/(e) — a decisão "este turno merece a rede", isolada.
// ----------------------------------------------------------------------------
// POR QUE ESTA FUNÇÃO EXISTE SEPARADA DO PORTÃO QUE A USA
//
// A ordem do item (e) pede controle dos dois lados, com `sticker→fallback`
// nomeado. Enquanto esta decisão vivia como um `if` dentro de `processarUmJob`,
// ela era INALCANÇÁVEL por teste: aquela função precisa de Supabase, Anthropic
// e Graph API para ser chamada. Prometer "figurinha cai na rede" sem poder
// provar seria exatamente o tipo de afirmação que esta casa não aceita.
//
// Extraída, a decisão vira fato verificável. O `if` lá embaixo passa a ler a
// pergunta em vez de reconstruí-la, que é como uma regra deixa de ter duas
// versões que podem divergir com o tempo.
//
// OS TRÊS FATOS, E POR QUE NENHUM PODE SER ACHATADO NOS OUTROS (Regra 19):
//
// · `conteudo === undefined` — NÃO SEI o que foi gravado. O webhook do
//   Instagram monta WaJob sem este campo. "Não sei" virando "veio vazio"
//   mandaria a rede para toda mensagem do Instagram, inclusive as de texto
//   perfeitamente legível. O portão só dispara sobre fato MEDIDO.
// · `jaRespondeu === true` — o cliente JÁ recebeu resposta neste job (o aviso
//   do extrato). Somar a rede em cima disso seria falar duas vezes.
// · `cerebroConsegueLer(conteudo)` — a pergunta é sobre o que está ESCRITO na
//   linha, nunca sobre o tipo declarado. É o que faz áudio-que-não-transcreveu,
//   figurinha, vídeo, localização e o tipo que a Meta ainda vai inventar caírem
//   todos neste mesmo galho, sem ninguém ter precisado enumerá-los.
// ============================================================================
export function mereceRede(
  conteudo: string | undefined,
  jaRespondeu: boolean
): boolean {
  if (conteudo === undefined) return false;
  if (jaRespondeu) return false;
  return !cerebroConsegueLer(conteudo);
}

// Faz o agente que ACABOU de receber o bastão dizer a primeira palavra, sem
// esperar o cliente voltar. Roda ainda DENTRO do lock do job (antes do
// `finally` que limpa respondendo_desde), pra que nenhuma outra invocação
// gere em paralelo na mesma conversa. Orçamento de relógio: debounce 8s +
// geração 20s + envio + geração 20s + envio ≈ 50s, contra LOCK_TTL_MS = 120s.
//
// SETE DECISÕES QUE ESTÃO NO CORPO, E POR QUÊ:
//
// 1. NUNCA JOGA EXCEÇÃO. O corpo inteiro vive num try/catch que só loga. A
//    resposta do agente ANTERIOR já saiu com sucesso neste ponto; uma falha
//    na abertura não pode desfazer isso nem derrubar os jobs seguintes.
// 2. NÃO ENCADEIA. O `proximoAgente` que voltar desta geração é ignorado de
//    propósito. Sem isso, A passa pra B que passa pra C dentro do mesmo job, e
//    o cliente recebe três mensagens seguidas sem ter escrito uma linha.
// 3. MAS OBEDECE ao escalarHumano. Encadear agente é ruído; pedir humano é
//    sinal de segurança, e sinal de segurança sempre passa.
// 4. DUAS checagens de humano. A primeira ANTES de gerar, que economiza uma
//    chamada de 20s e os tokens dela. A segunda imediatamente ANTES de
//    enviar, que é a que de fato protege — é entre gerar e enviar que o
//    operador clica "Assumir".
// 5. O texto descartado é REGISTRADO, pela mesma razão do fluxo normal: o
//    operador precisa ver o que o agente ia dizer.
// 6. `agente_ativo` NÃO é reescrito. Ele já vale o valor certo — foi o update
//    logo acima quem chamou esta função.
// 7. A abertura sai com `agente: agenteNovo`, não com o agente que se
//    despediu: quem fala é quem assume.
async function abrirComAgenteNovo(
  db: ReturnType<typeof createXtvClient>,
  job: WaJob,
  agenteNovo: AgenteId
): Promise<void> {
  const { conversaId, telefone } = job;
  try {
    if (!handoffAtivoLigado()) {
      console.log(
        "[whatsapp/background] handoff ativo DESLIGADO (HANDOFF_ATIVO=off) — agente novo não abre",
        JSON.stringify({ conversaId, agenteNovo })
      );
      return;
    }

    // Decisão 4, primeira checagem — barata, antes de gastar 20s e tokens.
    if (await assumidaPorHumano(db, conversaId)) {
      console.log(
        "[whatsapp/background] handoff ativo abortado antes de gerar — conversa assumida por humano",
        JSON.stringify({ conversaId, agenteNovo })
      );
      return;
    }

    const abertura = await gerarRespostaWhatsApp(db, conversaId, agenteNovo, telefone, {
      aberturaDeHandoff: true,
    });
    if (!abertura) {
      // Não é exceção, é ausência — e ausência aqui precisa aparecer no log,
      // senão o handoff ativo volta a ser exatamente o silêncio que ele veio
      // consertar, só que agora com código no meio.
      console.error(
        "[whatsapp/background] handoff ativo: cérebro devolveu null na abertura",
        JSON.stringify({ conversaId, agenteNovo })
      );
      return;
    }

    // Decisão 4, segunda checagem — a que de fato protege.
    if (await assumidaPorHumano(db, conversaId)) {
      console.log(
        "[whatsapp/background] abertura de handoff NÃO enviada — conversa assumida durante a geração",
        JSON.stringify({ conversaId, agenteNovo })
      );
      await registrarDescarte(db, conversaId, abertura.texto, "abertura de handoff");
      return;
    }

    await enviarPorCanal(job, {
      conversaId,
      texto: abertura.texto,
      agente: agenteNovo,
      tokensIn: abertura.tokensIn,
      tokensOut: abertura.tokensOut,
    });

    // Decisões 2 e 3: proximoAgente da abertura morre aqui; escalarHumano não.
    if (abertura.escalarHumano) {
      const { error } = await db
        .from("wa_conversas")
        .update({ status: "humano" })
        .eq("id", conversaId);
      if (error) {
        console.error(
          "[whatsapp/background] handoff ativo: falha ao escalar para humano:",
          error.message
        );
      }
    }
  } catch (e) {
    console.error(
      "[whatsapp/background] handoff ativo falhou (não derruba o job):",
      e instanceof Error ? e.message : e
    );
  }
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

  // OUVIDO-01 v2 — o que o cérebro vai encontrar quando ler a thread.
  //
  // Começa valendo o que o webhook gravou e só avança quando a transcrição
  // ENTROU NO BANCO. Se o update falhar, o banco segue com '[áudio recebido]'
  // e esta variável tem de dizer a mesma coisa: o cérebro lê do banco, não
  // desta função. Uma variável local otimista aqui faria o portão achar que o
  // turno é legível enquanto a thread real continua muda.
  let conteudoFinal: string | undefined = job.conteudo;

  // Se o caminho do extrato já falou nesta passada, a rede não fala de novo.
  //
  // Medido: hoje isto NÃO pode acontecer — quando o objeto de anexo existe, o
  // webhook grava '[anexo sem nome/legenda]' no pior caso (route.ts:371), que
  // `cerebroConsegueLer` aceita, então o portão nem abre. São duas linhas para
  // não deixar a garantia morando num arquivo diferente do que a usa: no dia
  // em que aquela cascata mudar, quem mudar não vai lembrar deste portão.
  let jaRespondeu = false;

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

      // FUNIL-01 — ponto 2 dos dois: o extrato acabou de nascer, e extrato é o
      // sinal mais forte que esta casa tem de que alguém quer vender uma cota.
      //
      // Aqui é `await` sem cerimônia, ao contrário do ponto da etiqueta: este
      // arquivo INTEIRO já roda depois do ack, dentro do `waitUntil` que a F4a
      // criou. Não há ciclo HTTP da Meta esperando; o que se paga aqui é tempo
      // de função, não risco de o cliente ficar sem resposta.
      //
      // DEPOIS do insert, nunca antes: o gatilho relê o extrato do banco em vez
      // de recebê-lo pronto. É de propósito — assim ele enxerga exatamente o que
      // ficou GRAVADO, com os tipos que o banco devolve, e não o objeto em
      // memória que a visão montou. Se a travessia estragar um número, o defeito
      // aparece aqui e vira "crédito não lido" na mesa, em vez de entrar calado.
      await rodarPonteNaConversa(db, conversaId);

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
          jaRespondeu = true;
        }
      }
    } catch (e) {
      console.error(
        "[whatsapp/background] falha ao processar extrato (anexo):",
        e instanceof Error ? e.message : e
      );
    }
  }

  // --------------------------------------------------------------------------
  // OUVIDO-01 v2 (b) — a nota de voz vira texto ANTES do cérebro ler a thread.
  // --------------------------------------------------------------------------
  // POR QUE AQUI, E NÃO NO WEBHOOK
  //
  // O webhook da Meta tem de devolver 200 depressa. Baixar mídia (até 20s) e
  // transcrever (até 8s) dentro do ciclo request/response é exatamente o
  // padrão que produziu as três perdas de 2026-07-21 documentadas no topo
  // deste arquivo: inbound gravado, zero resposta, zero log. Transcrever no
  // webhook reabriria a ferida do F4a com um nome novo.
  //
  // POR QUE ANTES DO DEBOUNCE
  //
  // Depois do debounce o job já está decidindo se fala. A thread precisa estar
  // legível ANTES disso, senão o cérebro é chamado para ler '[áudio recebido]'
  // e a fatia não terá servido para nada.
  //
  // POR QUE ANTES DO `podeResponder`
  //
  // Transcrição não serve só ao cérebro: serve ao operador que abre a conversa
  // no painel. Quem decide se um job de áudio existe é o webhook — em UM lugar
  // só. Duplicar a decisão aqui faria as duas divergirem um dia.
  //
  // ORÇAMENTO DE RELÓGIO (item c), somado:
  //   download 20s (teto de media.ts) + transcrição 8s + debounce 8s +
  //   geração ~20s ≈ 56s, contra LOCK_TTL_MS = 120s. E nada disto segura lock:
  //   o lock só é tomado depois do debounce.
  //
  // NÃO JOGA. Como o bloco do anexo, qualquer falha vira log. O cliente não
  // fica sem resposta por causa de um Whisper fora do ar: ele cai na rede.
  if (job.audioId) {
    try {
      const midia = await baixarMidia(job.audioId);

      // O mime OBSERVADO (bytes na mão) ganha do DECLARADO pela Meta — mesma
      // regra que o bloco do anexo já aplica logo acima.
      const r = await transcreverAudio(midia.bytes, midia.mimeType ?? job.audioMime);

      if (r.ok) {
        const texto = `${PREFIXO_TRANSCRICAO} ${r.texto}`;
        const { error } = await db
          .from("wa_mensagens")
          .update({ conteudo: texto })
          .eq("id", msgInseridaId);

        if (error) {
          // supabase-js DEVOLVE erro, não joga — lição já documentada três
          // vezes nesta base. Aqui ela custa caro: `conteudoFinal` NÃO avança,
          // porque o banco continua com '[áudio recebido]' e é o banco que o
          // cérebro lê. O cliente cai na rede, que é o certo — respondemos
          // sobre o que a thread REALMENTE diz.
          console.error(
            "[whatsapp/background] transcrição obtida mas NÃO gravada:",
            error.message,
            JSON.stringify({ conversaId, msgInseridaId })
          );
        } else {
          conteudoFinal = texto;
          console.log(
            "[whatsapp/background] áudio transcrito",
            JSON.stringify({ conversaId, msgInseridaId, chars: r.texto.length })
          );
        }
      } else {
        // `motivo` é enumerado de propósito (Regra 19): 'longo_demais',
        // 'whisper_fora' e 'silencio' são fatos diferentes e o log tem de
        // conseguir distingui-los. O TEXTO do cliente nunca entra no log.
        console.log(
          "[whatsapp/background] áudio NÃO transcrito — cai na rede",
          JSON.stringify({ conversaId, msgInseridaId, motivo: r.motivo })
        );
      }
    } catch (e) {
      // Só `baixarMidia` chega aqui: `transcreverAudio` não joga, por contrato.
      console.error(
        "[whatsapp/background] falha ao baixar áudio para transcrição:",
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

    // ------------------------------------------------------------------------
    // OUVIDO-01 v2 (c) — A REDE. Nunca o caminho.
    // ------------------------------------------------------------------------
    // O PORTÃO É POR CONTEÚDO, NÃO POR TIPO — e essa é a fatia inteira.
    //
    // A tentação era listar os tipos ruins (sticker, vídeo, location) e barrar
    // por tipo. O modo de falhar é conhecido: a Meta inventa um tipo novo, ele
    // não está na lista, e o turno vazio volta a entrar em silêncio. Aqui a
    // pergunta é sobre o que está ESCRITO na linha — então áudio que não
    // transcreveu, figurinha, vídeo, localização e o tipo que a Meta ainda não
    // inventou caem todos neste mesmo galho, sem ninguém ter previsto cada um.
    //
    // POR QUE DEPOIS DO `souAUltima`
    //
    // Se o cliente já mandou algo mais novo, este job saiu de cena. Mandar a
    // rede aqui seria responder a uma mensagem que já foi superada — e o
    // cliente veria "Recebi teu áudio!" depois de já ter escrito em texto.
    //
    // POR QUE ANTES DO LOCK
    //
    // O lock existe para serializar geração cara. Isto é uma string fixa: não
    // chama modelo, não gasta token. Tomar o lock aqui obrigaria a liberá-lo,
    // e o `finally` que libera vive dentro do bloco da geração.
    //
    // QUAIS FATOS ABREM O PORTÃO: está em `mereceRede`, no topo deste arquivo,
    // junto com o porquê de cada um (Regra 19). Não repito aqui de propósito —
    // regra escrita em dois lugares é regra que um dia diverge, e a cópia que
    // ninguém lê é a que continua valendo no ar.
    if (mereceRede(conteudoFinal, jaRespondeu)) {
      // Mesma releitura fresca do resto do arquivo: entre a foto do status no
      // webhook e este ponto passaram o download, a transcrição e 8s de
      // debounce — tempo de sobra para o operador clicar "Assumir".
      if (await assumidaPorHumano(db, conversaId)) {
        console.log(
          "[whatsapp/background] fallback NÃO enviado — conversa assumida por humano",
          JSON.stringify({ conversaId, tipo: job.tipo ?? null })
        );
        await registrarDescarte(
          db,
          conversaId,
          textoFallback(job.tipo ?? null),
          "fallback de conteúdo ilegível"
        );
        return;
      }

      // Texto FIXO, escrito e revisado em tipos.ts — não sai de modelo. Por
      // isso não passa por `avaliarComplianceGradual`: não há o que sanitizar
      // numa frase que nós mesmos escrevemos.
      //
      // `agente` é 'sistema_fallback' e não um agente de conversa. Medido: o
      // vigia 9 (radar_handoff_mudo, migration 0089) deriva a lista de agentes
      // de `wa_conversas.agente_ativo`, NUNCA de `wa_mensagens.agente` — então
      // este remetente entra ao lado de 'sistema_extrato' e 'sentinela' sem
      // poluir a medição do handoff mudo.
      await enviarPorCanal(job, {
        conversaId,
        texto: textoFallback(job.tipo ?? null),
        agente: "sistema_fallback",
      });
      console.log(
        "[whatsapp/background] fallback honesto enviado — conteúdo ilegível para o cérebro",
        JSON.stringify({ conversaId, msgInseridaId, tipo: job.tipo ?? null })
      );
      // O cérebro NÃO é chamado: era exatamente ele que recebia turno vazio.
      return;
    }

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
        // HANDOFF-01 (a): o bastão vira uma variável em vez de ser escrito
        // direto no objeto, porque agora ele é lido duas vezes — aqui e no
        // gancho da abertura, logo abaixo.
        const bastaoPara =
          resultado.proximoAgente &&
          resultado.proximoAgente !== resultado.agenteQueRespondeu
            ? resultado.proximoAgente
            : null;
        if (bastaoPara) {
          updates.agente_ativo = bastaoPara;
        }
        if (resultado.escalarHumano) {
          updates.status = "humano";
        }
        if (Object.keys(updates).length > 0) {
          // DEFEITO LATENTE CORRIGIDO DE PASSAGEM: este update descartava o
          // próprio erro. supabase-js RETORNA erro, não joga — mesma lição já
          // documentada duas vezes no cerebro.ts (logGuardrail e
          // contarFallbacksRecentes). Antes isso era uma cegueira barata: no
          // pior caso o bastão não passava e o cliente continuava com o agente
          // velho. Agora não é mais: se a escrita falhou, `agente_ativo` NÃO
          // mudou, e abrir a boca como o agente novo seria falar por um agente
          // que a conversa não reconhece. Por isso a abertura fica DENTRO do
          // ramo de sucesso.
          const { error: erroUpdate } = await db
            .from("wa_conversas")
            .update(updates)
            .eq("id", conversaId);

          if (erroUpdate) {
            console.error(
              "[whatsapp/background] falha ao aplicar updates da conversa (bastão/escalada):",
              erroUpdate.message,
              JSON.stringify({ conversaId, updates })
            );
          } else if (bastaoPara && !resultado.escalarHumano) {
            // A escalada para humano tem precedência sobre a abertura: se esta
            // resposta pediu humano, quem fala em seguida é gente, não outro
            // agente. Nos demais casos, o agente novo abre a boca agora — sem
            // esperar o cliente voltar, que é o item (a) inteiro.
            await abrirComAgenteNovo(db, job, bastaoPara);
          }
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
