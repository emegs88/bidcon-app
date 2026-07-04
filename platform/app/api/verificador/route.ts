// POST /api/verificador — Verificador IA v1 (extração de extrato/documentos).
// ----------------------------------------------------------------------------
// - SOMENTE sessão autenticada (mesma guarda de /api/kyc/ocr): getUser() → 401.
// - Aceita 1–5 arquivos PDF/JPG/PNG, ≤10MB cada, em base64.
// - Chama a Anthropic via lib/verificador (chave só em env de servidor).
// - Sem gravação em tabelas novas por ora: os eventos VERIFICATION_* entram
//   quando a migration 0016 rodar. Aqui, apenas log estruturado SEM conteúdo
//   de documento e um rate limit simples por usuário.
// - Toda string de alerta já vem filtrada por garantirLexico (no módulo).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  extrairDocumentos,
  type DocEntrada,
} from "@/lib/verificador";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ----- CORS (cross-domain: www.bidcon.com.br → app.bidcon.com.br) -----
// Origem SEMPRE explícita — nunca "*", pois a requisição é credentialed
// (o cliente envia credentials: "include" para levar o cookie de sessão).
// Allow-Credentials: true é obrigatório para o cookie de auth trafegar.
const CORS_ORIGIN = "https://www.bidcon.com.br";
const corsHeaders = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Credentials": "true",
} as const;

// Preflight: responde ao OPTIONS com os cabeçalhos de CORS e 204.
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

// ----- limites de entrada -----
const MAX_ARQUIVOS = 5;
const MIN_ARQUIVOS = 1;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB por arquivo (tamanho decodificado)
const TIPOS_OK = new Set(["application/pdf", "image/jpeg", "image/png"]);

// ----- rate limit simples por usuário (janela deslizante em memória) -----
// Escopo v1: instância única. Quando o volume exigir, trocar por store
// compartilhado (KV/Upstash). Não persiste entre deploys — aceitável para v1.
const RL_JANELA_MS = 60_000; // 1 min
const RL_MAX = 6; // até 6 extrações/min por usuário
const hits = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const agora = Date.now();
  const anteriores = (hits.get(userId) ?? []).filter((t) => agora - t < RL_JANELA_MS);
  if (anteriores.length >= RL_MAX) {
    hits.set(userId, anteriores);
    return true;
  }
  anteriores.push(agora);
  hits.set(userId, anteriores);
  return false;
}

// base64 → nº de bytes decodificados (sem alocar o buffer inteiro).
function bytesBase64(b64: string): number {
  const s = b64.replace(/=+$/, "");
  return Math.floor((s.length * 3) / 4);
}

// Remove eventual prefixo data:...;base64, e valida o alfabeto base64.
function limparBase64(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const semPrefixo = v.includes(",") && v.startsWith("data:") ? v.slice(v.indexOf(",") + 1) : v;
  const limpo = semPrefixo.trim();
  if (!limpo || !/^[A-Za-z0-9+/=\r\n]+$/.test(limpo)) return null;
  return limpo.replace(/[\r\n]/g, "");
}

type EntradaBruta = { media_type?: unknown; data_base64?: unknown };

// Log estruturado SEM conteúdo de documento (LGPD): só metadados.
function logEvento(campos: Record<string, unknown>): void {
  try {
    console.info(JSON.stringify({ evt: "verificador", ...campos }));
  } catch {
    /* nunca deixar o log derrubar a rota */
  }
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { erro: "Não autenticado." },
      { status: 401, headers: corsHeaders }
    );
  }

  if (rateLimited(user.id)) {
    logEvento({ userId: user.id, resultado: "rate_limited" });
    return NextResponse.json(
      { erro: "Muitas solicitações. Aguarde um instante e tente de novo." },
      { status: 429, headers: corsHeaders }
    );
  }

  // corpo
  let body: { arquivos?: unknown };
  try {
    body = (await req.json()) as { arquivos?: unknown };
  } catch {
    return NextResponse.json(
      { erro: "JSON inválido." },
      { status: 400, headers: corsHeaders }
    );
  }

  const arquivos = body?.arquivos;
  if (!Array.isArray(arquivos) || arquivos.length < MIN_ARQUIVOS) {
    return NextResponse.json(
      { erro: "Envie de 1 a 5 arquivos (PDF/JPG/PNG)." },
      { status: 400, headers: corsHeaders }
    );
  }
  if (arquivos.length > MAX_ARQUIVOS) {
    return NextResponse.json(
      { erro: `No máximo ${MAX_ARQUIVOS} arquivos por vez.` },
      { status: 400, headers: corsHeaders }
    );
  }

  const docs: DocEntrada[] = [];
  for (const item of arquivos as EntradaBruta[]) {
    const media = typeof item?.media_type === "string" ? item.media_type : "";
    if (!TIPOS_OK.has(media)) {
      return NextResponse.json(
        { erro: "Tipo não suportado. Use PDF, JPG ou PNG." },
        { status: 415, headers: corsHeaders }
      );
    }
    const b64 = limparBase64(item?.data_base64);
    if (!b64) {
      return NextResponse.json(
        { erro: "Arquivo em base64 inválido." },
        { status: 400, headers: corsHeaders }
      );
    }
    if (bytesBase64(b64) > MAX_BYTES) {
      return NextResponse.json(
        { erro: "Cada arquivo deve ter no máximo 10MB." },
        { status: 413, headers: corsHeaders }
      );
    }
    docs.push({ media_type: media as DocEntrada["media_type"], data_base64: b64 });
  }

  // Sem ANTHROPIC_API_KEY → degrada limpo (não quebra a ferramenta).
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    logEvento({ userId: user.id, resultado: "nao_configurado", qtd: docs.length });
    return NextResponse.json(
      { ok: false, modo: "nao_configurado", erro: "Verificador ainda não configurado." },
      { status: 503, headers: corsHeaders }
    );
  }

  try {
    const t0 = Date.now();
    const resultado = await extrairDocumentos(docs);
    logEvento({
      userId: user.id,
      resultado: "ok",
      qtd: docs.length,
      ms: Date.now() - t0,
      alertas: resultado.alertas.length,
    });
    return NextResponse.json(resultado, { headers: corsHeaders });
  } catch (e) {
    // Nunca vaza o erro do provedor ao client; loga só a mensagem curta.
    logEvento({
      userId: user.id,
      resultado: "erro",
      motivo: e instanceof Error ? e.message : "desconhecido",
    });
    return NextResponse.json(
      { ok: false, erro: "Não foi possível ler o documento agora. Tente novamente." },
      { status: 502, headers: corsHeaders }
    );
  }
}
