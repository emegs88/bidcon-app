// ============================================================================
// Cérebro do Time Prosperito aplicado ao WhatsApp — FATIA F2+F3.
// ----------------------------------------------------------------------------
// REAPROVEITA de verdade (import, não cópia) as peças já provadas em
// produção pelo /api/atende (site): persona/system prompt (montarSystem,
// AGENTES) de ./_prompt — mesmo cérebro, canal diferente, exatamente como
// pedido. Compliance de léxico: o WhatsApp usa avaliarComplianceGradual
// (lib/ia.ts), que reaproveita as MESMAS peças internas corrigidas de
// detecção (termoViolado/prometeDataContemplacao) da sanitizarCompliance()
// usada pelo site — só a AÇÃO sobre o resultado é diferente por canal (ver
// FATIA 2 · SEGURANCA-01 · F3.1, barreira de compliance no fim de
// gerarRespostaWhatsApp).
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
import { createAdminClient } from "@/lib/supabase-admin";
import { avaliarComplianceGradual } from "@/lib/ia";
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
  buscarCartas,
  resultadoParaTool,
  type BuscarCartasInput,
} from "@/lib/buscar-cartas-tool";
import { toolsParaAgente } from "@/lib/tools-por-agente";
import {
  buscarPlanos,
  resultadoParaToolPlanos,
  type BuscarPlanosInput,
} from "@/lib/venda-nova/buscar-planos-tool";
import {
  executarSalvarLead,
  resultadoParaToolSalvarLead,
  type SalvarLeadInput,
} from "@/lib/venda-nova/salvar-lead-tool";
import { statusVenda, resultadoParaToolStatusVenda } from "@/lib/venda-nova/status-venda-tool";
import { enviarEmail } from "@/lib/mail";

// FATIA 2 (SEGURANCA-01 · F3.1 — Guardrail Prosperito v2), ITEM 2/3: o antigo
// FALLBACK_WA (frase única) virou um pool de variantes — o Nível 3 da ação
// gradual (ver avaliarComplianceGradual em lib/ia.ts) roda em rotação
// (índice = qtd. de fallbacks recentes na mesma conversa) pra nunca repetir
// literalmente a mesma frase em loop, que era o próprio sintoma do bug de
// produção de 2026-07-23 (fallback genérico repetido em rajada).
export const FALLBACK_VARIANTES_WA = [
  "Posso te ajudar a entender como funciona o processo e os próximos passos. " +
    "Se preferir, nossa equipe continua com você por aqui mesmo. Como posso ajudar?",
  "Deixa eu confirmar essa informação com cuidado antes de te responder, pra não " +
    "te passar nada incorreto — nossa equipe já vai continuar essa conversa com " +
    "você por aqui mesmo. Pode me contar de novo o que você precisa?",
  "Essa é uma pergunta que prefiro confirmar com nossa equipe, pra te dar uma " +
    "resposta certa. Posso já sinalizar pra alguém falar com você por aqui?",
];

// Nível 3 puro (sem I/O): escolhe a variante de fallback por rotação, pra
// nunca repetir literalmente a mesma frase na mesma conversa em rajada —
// extraído em função própria (exportada) só pra ser testável isoladamente
// sem precisar mockar Supabase/Anthropic (ver cerebro.test.ts, ITEM
// "suíte de testes DoD" da FATIA 2). Zero mudança de comportamento: mesma
// expressão que já rodava inline.
export function escolherFallbackWa(qtdFallbacksRecentes: number): string {
  return FALLBACK_VARIANTES_WA[qtdFallbacksRecentes % FALLBACK_VARIANTES_WA.length];
}

// ITEM 3 (anti-loop): janela deslizante, em minutos, usada tanto pra contar
// fallbacks recentes na mesma conversa quanto no texto do alerta ao admin.
const ANTI_LOOP_JANELA_MIN = 15;

// ITEM 3 (anti-loop) — decisão pura (sem I/O): dado quantos Nível 3 essa
// conversa já teve na janela de ANTI_LOOP_JANELA_MIN minutos (ANTES deste
// que está sendo enviado agora), decide se este disparo (o +1 de agora)
// já é o 2º (ou mais) da janela — e portanto deve escalar pra humano.
// Extraída em função própria (exportada) pelo mesmo motivo de
// escolherFallbackWa acima: testável sem mockar banco. Zero mudança de
// comportamento: mesma expressão que já rodava inline.
export function deveEscalarAntiLoop(qtdFallbacksRecentesAntes: number): boolean {
  return qtdFallbacksRecentesAntes + 1 >= 2;
}

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

// ----------------------------------------------------------------------------
// FATIA 2 (SEGURANCA-01 · F3.1 — Guardrail Prosperito v2), ITEM 4 (log
// persistente) — insert fire-and-forget em wa_guardrail_log (tabela já
// existe no projeto xtv, zero migration nesta fatia — ver checkpoint).
// `motivo` segue o formato "regra[,regra2,...]|acao" pedido (ex.:
// "promessa_prazo|removido", "lexico:CDI|regenerado", "anti_loop|
// escalado_humano"). Falha no log NUNCA bloqueia o envio da resposta —
// por isso o try/catch engole qualquer erro e só loga um warning.
async function logGuardrail(
  db: ReturnType<typeof createXtvClient>,
  conversaId: string,
  motivos: string[],
  acao: "removido" | "regenerado" | "fallback_n3" | "escalado_humano",
  conteudoBloqueado: string
): Promise<void> {
  try {
    await db.from("wa_guardrail_log").insert({
      conversa_id: conversaId,
      motivo: `${motivos.join(",")}|${acao}`,
      conteudo_bloqueado: conteudoBloqueado.slice(0, 4000),
    });
  } catch (e) {
    console.error("[cerebro][guardrail] falha ao gravar log (não bloqueia envio):", e);
  }
}

// ITEM 3 (anti-loop) — reaproveita wa_guardrail_log como o próprio contador:
// nenhuma tabela nova. Conta quantas vezes ESTA conversa já caiu no Nível 3
// (fallback) nos últimos ANTI_LOOP_JANELA_MIN minutos. Falha de leitura
// devolve 0 (modo mais conservador: não dispara escalonamento por engano
// só porque a consulta falhou).
async function contarFallbacksRecentes(
  db: ReturnType<typeof createXtvClient>,
  conversaId: string
): Promise<number> {
  try {
    const limiteIso = new Date(Date.now() - ANTI_LOOP_JANELA_MIN * 60_000).toISOString();
    const { count } = await db
      .from("wa_guardrail_log")
      .select("id", { count: "exact", head: true })
      .eq("conversa_id", conversaId)
      .like("motivo", "%|fallback_n3")
      .gte("criado_em", limiteIso);
    return count ?? 0;
  } catch (e) {
    console.error("[cerebro][guardrail] falha ao contar fallbacks recentes:", e);
    return 0;
  }
}

// ITEM 3 (anti-loop) — alerta ao admin. GAP DE INFRAESTRUTURA (documentado
// no checkpoint pro Emerson): não existe hoje canal de WhatsApp pra avisar
// o admin — sendText/sendTemplate (./graph.ts) exigem uma wa_conversas já
// existente pro NÚMERO DO CLIENTE, e não há env var de telefone-admin nem
// template aprovado pela Meta pra isso. Reaproveita enviarEmail (lib/mail.ts,
// já usada por hooks/novo-cadastro) pra process.env.MAIL_ADMIN. Falha
// "suave": se MAIL_ADMIN não estiver configurada, só loga um warning — o
// escalonamento pra humano (status='humano') acontece de qualquer forma,
// só o AVISO extra por e-mail é que fica pendente até a env existir.
async function alertarAdminAntiLoop(
  telefone: string,
  hist: MensagemHist[] | null
): Promise<void> {
  const destino = process.env.MAIL_ADMIN;
  if (!destino) {
    console.warn("[cerebro][guardrail] MAIL_ADMIN ausente — alerta anti-loop não enviado.");
    return;
  }
  const ultimaPergunta =
    [...(hist ?? [])].reverse().find((m) => m.papel === "cliente")?.conteudo ??
    "(não encontrada)";
  await enviarEmail({
    to: destino,
    subject: `[Bidcon][WhatsApp] Guardrail: 2 fallbacks em ${ANTI_LOOP_JANELA_MIN}min — ${telefone}`,
    text:
      "Conversa do WhatsApp entrou no modo de escalonamento humano (ITEM 3, F3.1 — " +
      "guardrail de compliance disparou 2x em pouco tempo).\n\n" +
      `Telefone: ${telefone}\n` +
      `Última pergunta do cliente: ${ultimaPergunta}\n\n` +
      "O bot foi silenciado nesta conversa (wa_conversas.status='humano') — um " +
      "humano precisa assumir.",
  });
}

// ITEM 2 (ação gradual), Nível 2 — UMA tentativa extra de regeneração,
// reaproveitando o mesmo endpoint/modelo/timeout já usado no loop principal
// (ver gerarRespostaWhatsApp). Injeta uma nota de compliance reforçada no
// system e anexa a resposta anterior + uma instrução de reescrita como mais
// um turno da conversa — SEM `tools`, pra forçar o modelo a fechar em texto
// nesta única rodada extra (nunca outro tool_use). Devolve o texto
// reescrito, ou null em qualquer falha (rede, timeout, HTTP não-ok, texto
// vazio) — o chamador trata null exatamente como "regeneração não ajudou" e
// cai pro Nível 3.
async function tentarRegenerarCompliance(
  apiKey: string,
  systemBase: string,
  apiMensagensBase: Array<{ role: "user" | "assistant"; content: unknown }>,
  respostaAnterior: string,
  motivos: string[],
  timeoutMs: number
): Promise<string | null> {
  const systemReforcado =
    systemBase +
    "\n\n[REFORÇO DE COMPLIANCE — INTERNO, NÃO MENCIONE ISSO AO CLIENTE]\n" +
    "Sua última resposta violou regras de compliance de consórcio e foi descartada " +
    `(motivo: ${motivos.join(", ")}). Consórcio NÃO é aplicação financeira: nunca prometa ` +
    "retorno, rentabilidade, lucro ou CDI, e nunca prometa data/prazo/garantia de " +
    "contemplação (contemplação depende de sorteio ou lance, sem data previsível). " +
    "Reescreva a resposta cobrindo a mesma intenção do cliente, sem nenhum desses " +
    "termos/promessas.";

  const mensagens = [
    ...apiMensagensBase,
    { role: "assistant" as const, content: respostaAnterior },
    {
      role: "user" as const,
      content:
        "Essa resposta não pode ser enviada por violar compliance. Reescreva sem os " +
        "termos proibidos e sem prometer data/garantia de contemplação, mantendo a " +
        "mesma intenção.",
    },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
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
        system: systemReforcado,
        messages: mensagens,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data: unknown = await resp.json();
    const texto = extrairTexto((data as { content?: unknown }).content).trim();
    return texto || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
  agenteAtivo: AgenteId,
  telefone: string
): Promise<ResultadoCerebro | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[cerebro][diag] retorno null: ANTHROPIC_API_KEY ausente no ambiente");
    return null;
  }

  // CAUSA RAIZ (2026-07-21, achada via sonda + evidência de banco): esta
  // query estava `order(criado_em, {ascending:true}).limit(30)` — isso
  // busca as 30 mensagens MAIS ANTIGAS da conversa, não as 30 mais
  // recentes. Pra qualquer conversa com >30 mensagens (caso real: a
  // conversa de teste 9eb5f278 tinha 38), a mensagem atual do cliente
  // ficava de fora do corte, e a última linha do resultado podia ser
  // 'prosperito' (assistant) — a Anthropic rejeita com 400
  // "conversation must end with a user message" (prefill não suportado
  // neste modelo). gerarRespostaWhatsApp devolvia null SILENCIOSAMENTE
  // (só logado depois do F4a-diag), explicando as sondas vermelhas desde
  // que a conversa cruzou 30 mensagens. Fix: DESC + limit, depois
  // reverte pra ordem cronológica antes de montar as mensagens da API.
  const { data: histDesc } = await db
    .from("wa_mensagens")
    .select("papel,conteudo")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(30);
  const hist = histDesc ? [...histDesc].reverse() : histDesc;

  const mensagens = montarMensagensWa((hist ?? []) as MensagemHist[]);
  if (!mensagens.length) {
    console.error(
      "[cerebro][diag] retorno null: histórico vazio após montarMensagensWa",
      JSON.stringify({ conversaId, histLen: hist?.length ?? 0 })
    );
    return null;
  }

  let system = montarSystem(agenteAtivo, "whatsapp");
  const cartas = await blocoCartas(db);
  if (cartas) system += "\n\n" + cartas;

  // Loop de tool-use — no máximo 2 rodadas de tool_use por turno (F4-TOOL;
  // ver header de lib/buscar-cartas-tool.ts). Na rodada seguinte ao teto,
  // omitimos `tools` do body pra forçar o modelo a fechar com texto, mesmo
  // que "quisesse" mais uma busca. toolsParaAgente(agenteAtivo) devolve
  // [BUSCAR_CARTAS_TOOL] pras 7 personas pré-existentes (idêntico ao
  // hardcode anterior) e as 3 tools de venda nova só pra `vendanova`.
  const MAX_RODADAS_TOOL = 2;
  type MsgApi = { role: "user" | "assistant"; content: unknown };
  const apiMensagens: MsgApi[] = mensagens.map((m) => ({ role: m.role, content: m.content }));

  // nnvAdmin só é instanciado se uma tool de venda nova for de fato chamada
  // — as 7 personas pré-existentes (só buscar_cartas) nunca tocam nele.
  let _nnvAdmin: ReturnType<typeof createAdminClient> | null = null;
  const nnvAdmin = () => (_nnvAdmin ??= createAdminClient());

  async function executarToolPorNome(nome: string, input: unknown): Promise<string> {
    try {
      switch (nome) {
        case "buscar_cartas":
          return resultadoParaTool(await buscarCartas(db, (input ?? {}) as BuscarCartasInput));
        case "buscar_planos":
          return resultadoParaToolPlanos(await buscarPlanos((input ?? {}) as BuscarPlanosInput));
        case "salvar_lead":
          return resultadoParaToolSalvarLead(
            await executarSalvarLead(nnvAdmin(), (input ?? {}) as SalvarLeadInput, {
              telefone,
              utm: null,
            })
          );
        case "status_venda":
          return resultadoParaToolStatusVenda(await statusVenda(nnvAdmin(), telefone));
        default:
          return JSON.stringify({ erro: "tool desconhecida" });
      }
    } catch (e) {
      console.error(`[cerebro] erro ao executar tool ${nome}:`, e);
      return JSON.stringify({ erro: "erro ao executar a ferramenta." });
    }
  }

  // F4a (blindagem): achado durante a exploração — o comentário antigo
  // deste arquivo falava em "~12s" de timeout, mas não existia
  // AbortController nenhum aqui; o fetch podia ficar pendurado
  // indefinidamente. Timeout por rodada (não pro loop inteiro) — cada
  // rodada de tool_use é uma chamada HTTP independente.
  const TIMEOUT_ANTHROPIC_MS = 20_000;

  let data: unknown;
  try {
    let rodada = 0;
    for (;;) {
      const usarTools = rodada < MAX_RODADAS_TOOL;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_ANTHROPIC_MS);
      let resp: Response;
      try {
        resp = await fetch("https://api.anthropic.com/v1/messages", {
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
            ...(usarTools ? { tools: toolsParaAgente(agenteAtivo) } : {}),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) {
        const corpoErro = await resp.text().catch(() => "(sem corpo)");
        console.error(
          "[cerebro][diag] retorno null: Anthropic respondeu não-ok",
          JSON.stringify({ conversaId, status: resp.status, corpoErro: corpoErro.slice(0, 500) })
        );
        return null;
      }
      data = await resp.json();

      const stopReason = (data as { stop_reason?: string })?.stop_reason;
      const content = (data as { content?: unknown }).content;
      const toolUses = Array.isArray(content)
        ? (
            content as Array<{ type?: string; name?: string; id?: string; input?: unknown }>
          ).filter((b) => b?.type === "tool_use")
        : [];

      if (stopReason !== "tool_use" || !usarTools || !toolUses.length) break;

      rodada++;
      apiMensagens.push({ role: "assistant", content });
      const toolResults = await Promise.all(
        toolUses.map(async (tu) => ({
          type: "tool_result",
          tool_use_id: tu.id,
          content: await executarToolPorNome(String(tu.name), tu.input),
        }))
      );
      apiMensagens.push({ role: "user", content: toolResults });
    }
  } catch (e) {
    console.error(
      "[cerebro][diag] retorno null: exceção no loop de tool-use (timeout/AbortError inclusive)",
      JSON.stringify({ conversaId, erro: e instanceof Error ? e.message : String(e) })
    );
    return null;
  }

  const usage = (data as { usage?: { input_tokens?: number; output_tokens?: number } })
    ?.usage;
  const bruto = extrairTexto((data as { content?: unknown }).content);
  if (!bruto.trim()) {
    console.error("[cerebro][diag] retorno null: texto extraído vazio", JSON.stringify({ conversaId }));
    return null;
  }

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

  // ------------------------------------------------------------------------
  // Barreira de compliance — FATIA 2 (SEGURANCA-01 · F3.1), ITENS 2+3+4.
  // Nível 0: passa limpo, sem log. Nível 1: frase(s) ofensora(s) removida(s),
  // resto (se ainda útil) é enviado — loga "removido". Nível 2: nada sobrou
  // (ou a ofensa toma o texto todo) — tenta UMA regeneração com nota de
  // compliance reforçada; se vier limpa, usa e loga "regenerado"; senão cai
  // pro Nível 3 (fallback variado — nunca repete a mesma frase, ao contrário
  // do bug de produção original) e loga "fallback_n3". Anti-loop: conta
  // quantos Nível 3 esta MESMA conversa já teve em ANTI_LOOP_JANELA_MIN
  // minutos (via wa_guardrail_log, sem tabela nova); na 2ª ocorrência,
  // escala pra humano (reaproveita o mesmo `escalarHumano` que
  // processar-background.ts já usa pra setar wa_conversas.status='humano' —
  // nenhuma escrita de status duplicada aqui) e avisa o admin por e-mail.
  const candidatoOriginal = limpo; // intacto, antes da barreira — vai pro log
  const avaliacao = avaliarComplianceGradual(limpo);

  if (avaliacao.nivel === 0) {
    limpo = avaliacao.texto;
  } else if (avaliacao.nivel === 1) {
    limpo = avaliacao.texto;
    await logGuardrail(db, conversaId, avaliacao.motivos, "removido", candidatoOriginal);
  } else {
    let textoFinal: string | null = null;
    const regenerado = await tentarRegenerarCompliance(
      apiKey,
      system,
      apiMensagens,
      candidatoOriginal,
      avaliacao.motivos,
      TIMEOUT_ANTHROPIC_MS
    );
    if (regenerado) {
      const reavaliacao = avaliarComplianceGradual(regenerado);
      if (reavaliacao.nivel !== 2 && reavaliacao.texto.trim()) {
        textoFinal = reavaliacao.texto;
      }
    }

    if (textoFinal) {
      limpo = textoFinal;
      await logGuardrail(db, conversaId, avaliacao.motivos, "regenerado", candidatoOriginal);
    } else {
      const qtdRecentes = await contarFallbacksRecentes(db, conversaId);
      limpo = escolherFallbackWa(qtdRecentes);
      await logGuardrail(db, conversaId, avaliacao.motivos, "fallback_n3", candidatoOriginal);

      if (deveEscalarAntiLoop(qtdRecentes)) {
        escalarHumano = true;
        await logGuardrail(db, conversaId, ["anti_loop"], "escalado_humano", candidatoOriginal);
        await alertarAdminAntiLoop(telefone, hist as MensagemHist[] | null);
      }
    }
  }

  return {
    texto: limpo,
    proximoAgente,
    agenteQueRespondeu: agenteAtivo,
    tokensIn: usage?.input_tokens ?? null,
    tokensOut: usage?.output_tokens ?? null,
    escalarHumano,
  };
}
