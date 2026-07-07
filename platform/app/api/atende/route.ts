// POST /api/atende — atendimento conversacional do lead (site/WhatsApp).
//
// UM cérebro, SETE personas: o system é montado por montarSystem(agente_atual)
// vindo de ./_prompt (salvo pelo Emerson — NÃO recriar aqui). O provedor é a
// Anthropic Messages API (claude), chamada por fetch cru.
//
// O texto do lead é DADO, nunca instrução: este handler não executa o que vier
// no conteúdo; apenas o repassa como mensagem `user` para o modelo.
//
// COMPLIANCE: toda saída do modelo passa por sanitizarCompliance ANTES de ser
// persistida ou devolvida. Nunca investimento/rendimento/retorno; nunca promessa
// de data de contemplação; "Bidcon Price" é referência, não oferta.
//
// LEAD ANÔNIMO: não há sessão de usuário. As tabelas interesses/conversas/
// mensagens vivem no projeto Supabase "xtv" — usamos createXtvClient()
// (service_role, server-only) porque o lead não tem sessão/cookie para RLS.
//
// CORS: o widget roda em bidcon.com.br (vitrine) e chama app.bidcon.com.br
// (este endpoint) — cross-origin. Auth (allowlist de origem + rate-limit) e os
// headers CORS vivem em @/lib/api-guard, compartilhados com /api/interesse.
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { sanitizarCompliance } from "@/lib/ia";
import {
  origemPermitida,
  rateLimitExcedido,
  ipDe,
  corsHeaders,
  handlePreflight,
} from "@/lib/api-guard";
import {
  montarSystem,
  MARCADOR_BASTAO,
  AGENTE_INICIAL,
  AGENTES,
  type AgenteId,
} from "./_prompt";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CANAIS = ["site", "whatsapp"] as const;
type Canal = (typeof CANAIS)[number];

// Preflight CORS (bidcon.com.br chamando app.bidcon.com.br).
export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

// Fallback neutro exigido por sanitizarCompliance quando a saída do modelo
// violar as regras. Factual, sem promessa, sem termo proibido.
const FALLBACK =
  "Posso te ajudar a entender como funciona o processo e os próximos passos. " +
  "Se preferir, um especialista da equipe continua com você. Como posso ajudar?";

// Garante que agente_atual é um AgenteId conhecido; senão, volta ao inicial.
function agenteValido(id: string | null | undefined): AgenteId {
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

type Papel = "cliente" | "agente" | "sistema";
type MensagemHist = { papel: Papel; conteudo: string };

// Mapeia histórico do banco para o formato Anthropic, descartando 'sistema' e
// garantindo alternância começando por 'user' (colapsa papéis repetidos).
function montarMensagens(
  hist: MensagemHist[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const msgs: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of hist) {
    if (m.papel === "sistema") continue;
    const role: "user" | "assistant" =
      m.papel === "cliente" ? "user" : "assistant";
    const ultimo = msgs[msgs.length - 1];
    if (ultimo && ultimo.role === role) {
      // colapsa mensagens consecutivas do mesmo papel para preservar alternância
      ultimo.content += "\n" + m.conteudo;
    } else {
      msgs.push({ role, content: m.conteudo });
    }
  }
  // Anthropic exige a primeira mensagem como 'user'.
  while (msgs.length && msgs[0].role !== "user") {
    msgs.shift();
  }
  return msgs;
}

// CONTRATO ESPERADO (opção "já contatável"):
// O front captura nome + WhatsApp, cria o interesse (nome, telefone,
// origem='chat') e passa o interesse_id retornado para este endpoint.
// Este handler NÃO cria interesse: ele EXIGE um interesse_id já existente.
// O schema mantém nome/telefone NOT NULL — a captura acontece antes do chat.
export async function POST(req: Request) {
  // AUTH camada 1: só origem confiável (bidcon.com.br / app.bidcon.com.br).
  if (!origemPermitida(req)) {
    return NextResponse.json(
      { erro: "Origem não autorizada." },
      { status: 403, headers: corsHeaders(req) }
    );
  }

  // AUTH camada 2: rate-limit por IP (20 req/min). Estouro -> 429.
  if (rateLimitExcedido(ipDe(req))) {
    return NextResponse.json(
      { erro: "Muitas requisições. Tente novamente em instantes." },
      { status: 429, headers: corsHeaders(req) }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    canal?: unknown;
    interesse_id?: unknown;
    texto?: unknown;
  };

  const canal = String(body.canal ?? "").trim() as Canal;
  const interesseId = String(body.interesse_id ?? "").trim();
  const texto = String(body.texto ?? "").trim().slice(0, 4000);

  if (!CANAIS.includes(canal)) {
    return NextResponse.json(
      { erro: "Canal inválido." },
      { status: 422, headers: corsHeaders(req) }
    );
  }
  // Contrato "já contatável": interesse_id ausente/malformado -> 400 (não 422),
  // com a mensagem que orienta a capturar nome+WhatsApp no front.
  if (!UUID_RE.test(interesseId)) {
    return NextResponse.json(
      {
        erro:
          "interesse_id obrigatório e deve existir; capture nome+WhatsApp no front antes de abrir o chat",
      },
      { status: 400, headers: corsHeaders(req) }
    );
  }
  if (!texto) {
    return NextResponse.json(
      { erro: "Mensagem vazia." },
      { status: 422, headers: corsHeaders(req) }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { erro: "Provedor de IA não configurado." },
      { status: 503, headers: corsHeaders(req) }
    );
  }

  const supabase = createXtvClient();

  // Contrato "já contatável": o interesse PRECISA existir. Nunca criamos aqui.
  // Erro de banco -> 500 (com log); registro inexistente -> 400 com a mesma
  // orientação de captura no front.
  {
    const { data: interesse, error } = await supabase
      .from("interesses")
      .select("id")
      .eq("id", interesseId)
      .maybeSingle();
    if (error) {
      console.error("[atende] erro ao verificar interesse:", error);
      return NextResponse.json(
        { erro: "Erro ao verificar interesse." },
        { status: 500, headers: corsHeaders(req) }
      );
    }
    if (!interesse) {
      return NextResponse.json(
        {
          erro:
            "interesse_id obrigatório e deve existir; capture nome+WhatsApp no front antes de abrir o chat",
        },
        { status: 400, headers: corsHeaders(req) }
      );
    }
  }

  // 1) Conversa 'aberta' para o interesse; se não houver, cria.
  let conversa: { id: string; agente_atual: string | null } | null = null;
  {
    const { data } = await supabase
      .from("conversas")
      .select("id, agente_atual")
      .eq("interesse_id", interesseId)
      .eq("status", "aberta")
      .maybeSingle();
    conversa = data;
  }
  if (!conversa) {
    const { data, error } = await supabase
      .from("conversas")
      .insert({
        interesse_id: interesseId,
        canal,
        agente_atual: AGENTE_INICIAL,
        status: "aberta",
      })
      .select("id, agente_atual")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { erro: "Não foi possível abrir a conversa." },
        { status: 500, headers: corsHeaders(req) }
      );
    }
    conversa = data;
  }

  const agenteAtual = agenteValido(conversa.agente_atual);

  // 2) Registra a mensagem do cliente.
  {
    const { error } = await supabase.from("mensagens").insert({
      conversa_id: conversa.id,
      papel: "cliente",
      conteudo: texto,
    });
    if (error) {
      return NextResponse.json(
        { erro: "Não foi possível registrar a mensagem." },
        { status: 500, headers: corsHeaders(req) }
      );
    }
  }

  // 3) Histórico em ordem -> mensagens Anthropic (user/assistant alternados).
  const { data: hist } = await supabase
    .from("mensagens")
    .select("papel, conteudo")
    .eq("conversa_id", conversa.id)
    .order("criado_em", { ascending: true });

  const mensagens = montarMensagens((hist ?? []) as MensagemHist[]);
  if (!mensagens.length) {
    // segurança: sempre deve haver ao menos a mensagem do cliente recém-inserida
    mensagens.push({ role: "user", content: texto });
  }

  // 4) System da persona atual.
  const system = montarSystem(agenteAtual);

  // 5) Anthropic Messages API (fetch cru).
  let data: unknown;
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
        system,
        messages: mensagens,
      }),
    });
    if (!resp.ok) {
      return NextResponse.json(
        { erro: "Falha ao consultar o provedor de IA." },
        { status: 502, headers: corsHeaders(req) }
      );
    }
    data = await resp.json();
  } catch {
    return NextResponse.json(
      { erro: "Provedor de IA indisponível." },
      { status: 502, headers: corsHeaders(req) }
    );
  }

  // 6) Texto da resposta.
  const bruto = extrairTexto((data as { content?: unknown }).content);

  // 7) Bastão: captura ##AGENTE:<id>## e remove do texto exibido.
  const m = bruto.match(MARCADOR_BASTAO);
  const proximoBruto = m ? m[1] : null;
  let limpo = bruto.replace(MARCADOR_BASTAO, "").trimEnd();

  // 8) Barreira de compliance (com fallback neutro obrigatório).
  limpo = sanitizarCompliance(limpo, FALLBACK);

  // 9) Registra a resposta do agente que estava com o bastão.
  {
    const { error } = await supabase.from("mensagens").insert({
      conversa_id: conversa.id,
      papel: "agente",
      agente: agenteAtual,
      conteudo: limpo,
    });
    if (error) {
      return NextResponse.json(
        { erro: "Não foi possível registrar a resposta." },
        { status: 500, headers: corsHeaders(req) }
      );
    }
  }

  // 10) Passagem de bastão: só troca se o próximo for um agente conhecido.
  if (proximoBruto) {
    const proximo = agenteValido(proximoBruto);
    if (proximo !== agenteAtual) {
      await supabase
        .from("conversas")
        .update({ agente_atual: proximo, atualizado_em: new Date().toISOString() })
        .eq("id", conversa.id);
    }
  }

  // 11) Devolve só o texto limpo ao cliente.
  return NextResponse.json({ resposta: limpo }, { headers: corsHeaders(req) });
}
