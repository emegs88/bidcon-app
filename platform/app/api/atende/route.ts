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
// LEAD ANÔNIMO: não há sessão de usuário. Por isso usamos o cliente SERVICE_ROLE
// (createAdminClient) — o cliente anon+cookies+RLS não atende um lead sem login.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { sanitizarCompliance } from "@/lib/ia";
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

// --- AUTH camada 1: allowlist de origem -------------------------------------
// Só aceitamos chamadas vindas do próprio site/app Bidcon. Fora disso -> 403.
// Conferimos Origin; na ausência dele, caímos para o host do Referer.
const ORIGENS_PERMITIDAS = new Set<string>([
  "https://bidcon.com.br",
  "https://www.bidcon.com.br",
  "https://app.bidcon.com.br",
]);

function hostDe(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Retorna true se a requisição tem origem confiável.
function origemPermitida(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) return ORIGENS_PERMITIDAS.has(origin);
  // Sem Origin (ex.: navegação same-origin em alguns browsers): usa o Referer.
  const refOrigin = hostDe(req.headers.get("referer"));
  if (refOrigin) return ORIGENS_PERMITIDAS.has(refOrigin);
  // Sem Origin nem Referer confiável -> nega.
  return false;
}

// --- AUTH camada 2: rate-limit por IP ---------------------------------------
// Teto de 20 req/min por IP, janela fixa de 60s. Store em memória por instância
// (aceitável no MVP; some ao reiniciar/escalar horizontalmente).
// TODO(escala): trocar por Upstash/Redis para um contador compartilhado entre
// instâncias e persistente entre deploys.
const RATE_LIMITE = 20;
const RATE_JANELA_MS = 60_000;
const rateStore = new Map<string, { count: number; reset: number }>();

// Extrai o IP do cliente: primeiro item de x-forwarded-for, com fallback.
function ipDe(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const primeiro = xff.split(",")[0]?.trim();
    if (primeiro) return primeiro;
  }
  return req.headers.get("x-real-ip")?.trim() || "desconhecido";
}

// Retorna true se o IP ESTOUROU o teto (deve ser bloqueado com 429).
function rateLimitExcedido(ip: string): boolean {
  const agora = Date.now();
  const reg = rateStore.get(ip);
  if (!reg || agora >= reg.reset) {
    rateStore.set(ip, { count: 1, reset: agora + RATE_JANELA_MS });
    return false;
  }
  reg.count += 1;
  return reg.count > RATE_LIMITE;
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
    return NextResponse.json({ erro: "Origem não autorizada." }, { status: 403 });
  }

  // AUTH camada 2: rate-limit por IP (20 req/min). Estouro -> 429.
  if (rateLimitExcedido(ipDe(req))) {
    return NextResponse.json(
      { erro: "Muitas requisições. Tente novamente em instantes." },
      { status: 429 }
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
    return NextResponse.json({ erro: "Canal inválido." }, { status: 422 });
  }
  // Contrato "já contatável": interesse_id ausente/malformado -> 400 (não 422),
  // com a mensagem que orienta a capturar nome+WhatsApp no front.
  if (!UUID_RE.test(interesseId)) {
    return NextResponse.json(
      {
        erro:
          "interesse_id obrigatório e deve existir; capture nome+WhatsApp no front antes de abrir o chat",
      },
      { status: 400 }
    );
  }
  if (!texto) {
    return NextResponse.json({ erro: "Mensagem vazia." }, { status: 422 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { erro: "Provedor de IA não configurado." },
      { status: 503 }
    );
  }

  const supabase = createAdminClient();

  // Contrato "já contatável": o interesse PRECISA existir. Nunca criamos aqui.
  // Se não existir no banco -> 400 com a mesma orientação de captura no front.
  {
    const { data: interesse } = await supabase
      .from("interesses")
      .select("id")
      .eq("id", interesseId)
      .maybeSingle();
    if (!interesse) {
      return NextResponse.json(
        {
          erro:
            "interesse_id obrigatório e deve existir; capture nome+WhatsApp no front antes de abrir o chat",
        },
        { status: 400 }
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
        { status: 500 }
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
        { status: 500 }
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
        { status: 502 }
      );
    }
    data = await resp.json();
  } catch {
    return NextResponse.json(
      { erro: "Provedor de IA indisponível." },
      { status: 502 }
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
        { status: 500 }
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
  return NextResponse.json({ resposta: limpo });
}
