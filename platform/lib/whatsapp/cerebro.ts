// ============================================================================
// Cérebro do Time Prosperito aplicado ao WhatsApp — FATIA F2+F3.
// ----------------------------------------------------------------------------
// REAPROVEITA de verdade (import, não cópia) as peças já provadas em
// produção pelo /api/atende (site): persona/system prompt (montarSystem,
// AGENTES) e compliance de léxico (sanitizarCompliance) de ./_prompt e
// ./ia — mesmo cérebro, canal diferente, exatamente como pedido.
//
// O que É reimplementado aqui (mecânico, não copiado de atende/route.ts —
// aquele arquivo é produção crítica do site e não é tocado por esta fatia):
//   - montarMensagensWa: adaptado porque wa_mensagens.papel usa um enum
//     DIFERENTE do mensagens.papel do site (cliente|prosperito|humano|
//     sistema vs. cliente|agente|sistema — ver migration 0046).
//   - blocoCartas: mesma query/formato do site (Serviço "CARTAS DISPONÍVEIS
//     AGORA"), só que lendo daqui.
//   - conversão de marcadores pra texto puro: [[OPCOES]] foi desenhado pro
//     widget do SITE renderizar como botões — o WhatsApp (sendText) só
//     manda texto puro, então aqui vira uma lista numerada legível (ver
//     converterOpcoesParaTexto). [[CARTA]] NÃO entra aqui: desde a TOM-02,
//     montarSystem(agenteAtivo, 'whatsapp') instrui o modelo a apresentar
//     carta em RECIBO (texto/bloco monoespaçado) neste canal — o WhatsApp
//     nunca emite [[CARTA]], então não há marcador de carta pra converter.
//   - [[RESERVAR]]: o site trava a carta de verdade (processarReservaCarta,
//     com cross-check de identidade via carta_foco do widget). O WhatsApp
//     NÃO tem esse mecanismo de identidade ainda — em vez de fingir uma
//     reserva que não aconteceu, o marcador aqui ESCALA pra humano
//     (wa_conversas.status='humano') com uma frase fixa, nunca gerada pelo
//     modelo (mesmo espírito do RESERVA-01: garantia é do sistema, não
//     prosa da IA). Travar a carta de fato via WhatsApp fica pra quando
//     houver um mecanismo de identidade equivalente — fora desta fatia.
//
// F4-TOOL: a chamada à Anthropic agora roda em loop (até 2 rodadas de
// tool_use) com a tool `buscar_cartas` (definição/executor únicos em
// lib/buscar-cartas-tool.ts, importados por este arquivo e por
// app/api/atende/route.ts) — corrige o caso em que o modelo só enxergava o
// recorte estático de blocoCartas() e negava estoque que existia de
// verdade fora dele. [[ESCALAR]] (tool devolveu 0) segue o mesmo padrão de
// [[RESERVAR]]: aciona wa_conversas.status='humano' via `escalarHumano`.
//
// Modelo: mesmo "claude-fable-5" hardcoded do /api/atende (valor provado em
// produção) — a spec (docs/WHATSAPP-01-SPEC.md §4/§6) sugere env
// ANTHROPIC_MODEL com default claude-sonnet-4-6; optei por reaproveitar o
// valor comprovado em vez de introduzir uma env nova ainda sem uso real.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";
import { sanitizarCompliance } from "@/lib/ia";
import {
  montarSystem,
  MARCADOR_BASTAO,
  MARCADOR_RESERVAR,
  MARCADOR_ESCALAR,
  AGENTE_INICIAL,
  AGENTES,
  type AgenteId,
} from "@/app/api/atende/_prompt";
import {
  BUSCAR_CARTAS_TOOL,
  buscarCartas,
  resultadoParaTool,
  type BuscarCartasInput,
} from "@/lib/buscar-cartas-tool";

const FALLBACK_WA =
  "Posso te ajudar a entender como funciona o processo e os próximos passos. " +
  "Se preferir, nossa equipe continua com você por aqui mesmo. Como posso ajudar?";

const FRASE_RESERVA_WA =
  "Entendido! Pra travar essa carta com segurança, vou te conectar agora com " +
  "nossa equipe, que confirma tudo com você por aqui mesmo. 🙂";

/** Garante que o valor de agente_ativo (coluna text, não enum) é um AgenteId
 *  conhecido; senão volta ao inicial. Mesmo padrão de agenteValido em
 *  /api/atende/route.ts. */
export function agenteValido(id: string | null | undefined): AgenteId {
  if (id && (AGENTES as Record<string, unknown>)[id] !== undefined) {
    return id as AgenteId;
  }
  return AGENTE_INICIAL;
}

// Blocos de texto da resposta Anthropic -> string única.
function extrairTexto(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: string; text: string } =>
        !!b &&
        typeof b === "object" &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string"
    )
    .map((b) => b.text)
    .join("");
}

type WaPapel = "cliente" | "prosperito" | "humano" | "sistema";
type MensagemHist = { papel: WaPapel; conteudo: string };

// Mapeia histórico de wa_mensagens pro formato Anthropic: 'cliente' -> user;
// 'prosperito'/'humano' -> assistant (ambos são "quem respondeu ao
// cliente" do lado da Bidcon); 'sistema' é descartado. Colapsa papéis
// consecutivos iguais e garante que a primeira mensagem é 'user' (exigido
// pela API da Anthropic).
function montarMensagensWa(
  hist: MensagemHist[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const msgs: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of hist) {
    if (m.papel === "sistema") continue;
    const role: "user" | "assistant" = m.papel === "cliente" ? "user" : "assistant";
    const ultimo = msgs[msgs.length - 1];
    if (ultimo && ultimo.role === role) {
      ultimo.content += "\n" + m.conteudo;
    } else {
      msgs.push({ role, content: m.conteudo });
    }
  }
  while (msgs.length && msgs[0].role !== "user") {
    msgs.shift();
  }
  return msgs;
}

// cache simples em módulo (best-effort por instância serverless) — mesmo
// padrão de /api/atende/route.ts, cache próprio (instância de módulo
// separada).
let _cartasCache: { txt: string; em: number } | null = null;

async function blocoCartas(db: ReturnType<typeof createXtvClient>): Promise<string> {
  if (_cartasCache && Date.now() - _cartasCache.em < 60_000) return _cartasCache.txt;

  const campos =
    "numero_externo,tipo,valor_credito,valor_entrada,valor_parcela,qtd_parcelas,bidcon_custo_am,bidcon_agio_120,bidcon_agio_150";
  const base = () =>
    db
      .from("cartas")
      .select(campos)
      .eq("status", "disponivel")
      .not("bidcon_custo_am", "is", null)
      .order("bidcon_agio_150", { ascending: false })
      .order("bidcon_custo_am", { ascending: true });

  const [rImoveis, rVeiculos] = await Promise.all([
    base().eq("tipo", "imovel").limit(20),
    base().eq("tipo", "veiculo").limit(20),
  ]);
  if ((rImoveis.error || !rImoveis.data) && (rVeiculos.error || !rVeiculos.data)) return "";

  let dImoveis = rImoveis.data ?? [];
  let dVeiculos = rVeiculos.data ?? [];
  if (!dImoveis.length && !dVeiculos.length) return "";

  if (!dImoveis.length && dVeiculos.length) {
    const extra = await base().eq("tipo", "veiculo").limit(40);
    dVeiculos = extra.data ?? dVeiculos;
  } else if (!dVeiculos.length && dImoveis.length) {
    const extra = await base().eq("tipo", "imovel").limit(40);
    dImoveis = extra.data ?? dImoveis;
  }

  const linha = (c: Record<string, unknown>) => {
    const fmt = (n: unknown) => String(Math.round(Number(n)));
    const custo = Number(c.bidcon_custo_am).toFixed(2).replace(".", ",");
    const agio = Number(c.bidcon_agio_150) > 0 ? `|agio=${fmt(c.bidcon_agio_150)}` : "";
    const selo = Number(c.bidcon_agio_120) > 0 ? "|selo=Custo excelente" : "";
    return `ref=${c.numero_externo}|tipo=${String(c.tipo) === "imovel" ? "IMÓVEL" : "VEÍCULO"}|credito=${fmt(c.valor_credito)}|entrada=${fmt(c.valor_entrada)}|nparcelas=${c.qtd_parcelas}|parcela=${fmt(c.valor_parcela)}|custo=${custo}${agio}${selo}`;
  };
  const txt = [
    "CARTAS DISPONÍVEIS AGORA (amostra do banco — nunca a única fonte; para responder ao cliente use SEMPRE a tool buscar_cartas com o filtro dele, e monte o RECIBO só com o que ela devolver):",
    ...dImoveis.map(linha),
    ...dVeiculos.map(linha),
  ].join("\n");
  _cartasCache = { txt, em: Date.now() };
  return txt;
}

// --- Conversão de marcadores (site-only) pra texto puro (WhatsApp) --------

const RE_OPCOES = /\[\[OPCOES\]\]([^[]*)\[\[\/OPCOES\]\]/g;

function converterOpcoesParaTexto(texto: string): string {
  return texto.replace(RE_OPCOES, (_all, bloco: string) => {
    const itens = bloco
      .split("|")
      .map((p) => p.slice(p.indexOf(":") + 1).trim())
      .filter(Boolean);
    if (!itens.length) return "";
    return itens.map((rotulo, i) => `${i + 1}) ${rotulo}`).join("\n");
  });
}

// --- Ponto de entrada -------------------------------------------------------

export type ResultadoCerebro = {
  texto: string;
  proximoAgente: AgenteId | null;
  agenteQueRespondeu: AgenteId;
  tokensIn: number | null;
  tokensOut: number | null;
  escalarHumano: boolean;
};

/** Gera a resposta do Time Prosperito pra uma conversa de WhatsApp: monta
 *  histórico + system prompt (persona ativa + estoque real), chama a
 *  Anthropic, processa bastão/reserva, converte marcadores pra texto puro e
 *  passa pela barreira de compliance. Retorna null em qualquer falha (env
 *  ausente, HTTP não-ok, histórico vazio) — o chamador decide o que fazer
 *  (nesta fatia: só loga, nunca derruba o 200 do webhook). NÃO envia nada
 *  via Graph API nem grava em wa_mensagens — isso é responsabilidade de
 *  quem chama (ver ./graph.ts sendText). */
export async function gerarRespostaWhatsApp(
  db: ReturnType<typeof createXtvClient>,
  conversaId: string,
  agenteAtivo: AgenteId
): Promise<ResultadoCerebro | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { data: hist } = await db
    .from("wa_mensagens")
    .select("papel,conteudo")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: true })
    .limit(30);

  const mensagens = montarMensagensWa((hist ?? []) as MensagemHist[]);
  if (!mensagens.length) return null;

  let system = montarSystem(agenteAtivo, "whatsapp");
  const cartas = await blocoCartas(db);
  if (cartas) system += "\n\n" + cartas;

  // Loop de tool-use (buscar_cartas) — no máximo 2 rodadas de tool_use por
  // turno (F4-TOOL; ver header de lib/buscar-cartas-tool.ts). Na rodada
  // seguinte ao teto, omitimos `tools` do body pra forçar o modelo a
  // fechar com texto, mesmo que "quisesse" mais uma busca.
  const MAX_RODADAS_TOOL = 2;
  type MsgApi = { role: "user" | "assistant"; content: unknown };
  const apiMensagens: MsgApi[] = mensagens.map((m) => ({ role: m.role, content: m.content }));

  let data: unknown;
  try {
    let rodada = 0;
    for (;;) {
      const usarTools = rodada < MAX_RODADAS_TOOL;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-fable-5",
          max_tokens: 1024,
          system,
          messages: apiMensagens,
          ...(usarTools ? { tools: [BUSCAR_CARTAS_TOOL] } : {}),
        }),
      });
      if (!resp.ok) return null;
      data = await resp.json();

      const stopReason = (data as { stop_reason?: string })?.stop_reason;
      const content = (data as { content?: unknown }).content;
      const toolUses = Array.isArray(content)
        ? (
            content as Array<{ type?: string; name?: string; id?: string; input?: unknown }>
          ).filter((b) => b?.type === "tool_use" && b?.name === "buscar_cartas")
        : [];

      if (stopReason !== "tool_use" || !usarTools || !toolUses.length) break;

      rodada++;
      apiMensagens.push({ role: "assistant", content });
      const toolResults = await Promise.all(
        toolUses.map(async (tu) => ({
          type: "tool_result",
          tool_use_id: tu.id,
          content: resultadoParaTool(
            await buscarCartas(db, (tu.input ?? {}) as BuscarCartasInput)
          ),
        }))
      );
      apiMensagens.push({ role: "user", content: toolResults });
    }
  } catch {
    return null;
  }

  const usage = (data as { usage?: { input_tokens?: number; output_tokens?: number } })
    ?.usage;
  const bruto = extrairTexto((data as { content?: unknown }).content);
  if (!bruto.trim()) return null;

  // Bastão: captura ##AGENTE:<id>## e remove do texto exibido.
  const mBastao = bruto.match(MARCADOR_BASTAO);
  const proximoAgente = mBastao ? (mBastao[1] as AgenteId) : null;
  let limpo = bruto.replace(MARCADOR_BASTAO, "").trimEnd();

  // [[ESCALAR]]: buscar_cartas devolveu 0 pro filtro pedido — aciona o
  // time humano (status='humano'), mas MANTÉM o texto do modelo (já vai
  // passar pela barreira de compliance abaixo) — diferente de
  // [[RESERVAR]], aqui não há identidade/dado financeiro em jogo pra
  // justificar substituir a frase inteira por uma fixa.
  let escalarHumano = false;
  const mEscalar = limpo.match(MARCADOR_ESCALAR);
  limpo = limpo.replace(MARCADOR_ESCALAR, "").trimEnd();
  if (mEscalar) escalarHumano = true;

  // [[RESERVAR]]: sem mecanismo de identidade (carta_foco) no WhatsApp
  // ainda — escala pra humano em vez de fingir uma trava real.
  const mReserva = limpo.match(MARCADOR_RESERVAR);
  limpo = limpo.replace(MARCADOR_RESERVAR, "").trimEnd();
  if (mReserva) {
    limpo = FRASE_RESERVA_WA;
    escalarHumano = true;
  }

  // Marcador de UI (site-only) -> texto puro pro WhatsApp.
  limpo = converterOpcoesParaTexto(limpo);

  // Barreira de compliance (fallback neutro obrigatório).
  limpo = sanitizarCompliance(limpo, FALLBACK_WA);

  return {
    texto: limpo,
    proximoAgente,
    agenteQueRespondeu: agenteAtivo,
    tokensIn: usage?.input_tokens ?? null,
    tokensOut: usage?.output_tokens ?? null,
    escalarHumano,
  };
}
