// ============================================================================
// INSTA-POST-01 (extensão diagnóstica) — GET /api/instagram/diag
// Responde uma pergunta e só uma: o IG_ACCESS_TOKEN que está no runtime
// pertence à conta que o IG_USER_ID diz que é?
// AUTORIZADO: Emerson Gomes dos Santos — 06/08/2026 ~18h45.
// ----------------------------------------------------------------------------
// POR QUE ESTA ROTA EXISTE: /api/instagram/publicar faz duas chamadas à Graph
// em sequência e qualquer uma pode falhar por motivos que se parecem. Token de
// outra conta, permissão faltando e IG_USER_ID errado produzem erros distintos
// mas igualmente crípticos, DEPOIS de já ter criado um container. Esta rota
// separa a pergunta "as credenciais casam?" da pergunta "o post subiu?" — e
// não escreve nada em lugar nenhum.
//
// ENDPOINT (medido na doc oficial em 06/08/2026):
//   GET https://graph.instagram.com/v25.0/me?fields=user_id,username,account_type
//   O exemplo literal da doc usa v25.0 e os campos user_id,username;
//   account_type aparece na tabela de campos disponíveis, mas NÃO no exemplo.
//   Daí o fallback lá embaixo: se a Graph recusar o conjunto rico, repete com
//   o conjunto mínimo que a doc mostra funcionando. Um campo opcional não pode
//   derrubar o diagnóstico inteiro — seria a ferramenta de achar problema
//   virando o problema.
//
// user_id E NÃO id: nesta API `id` é o App-scoped User ID (identidade do
// usuário DENTRO do app) e `user_id` é o ID da conta profissional do Instagram
// — que é o que IG_USER_ID guarda e o que /<IG_ID>/media endereça. Comparar
// IG_USER_ID contra `id` acusaria divergência numa configuração correta.
// Este comentário é o motivo de a rota existir com este campo e não outro.
//
// TOKEN: vai no header Authorization, JAMAIS na query string — query string
// entra em log de acesso, em Referer e no histórico de proxy. E não é logado
// nem devolvido em campo nenhum da resposta, nem mascarado: o que se mede aqui
// é a IDENTIDADE que o token carrega, não o token.
//
// GUARD: mesmo Bearer DISPARO_SECRET de /api/instagram/publicar. Expõe
// username e id de conta — pouco, mas é dado de configuração, não é público.
// ============================================================================
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IG_GRAPH_VERSION = "v25.0";
const TIMEOUT_IG_MS = 15_000;

/** Conjunto rico primeiro; o mínimo da doc como rede de segurança. */
const CAMPOS_PREFERIDOS = "user_id,username,account_type";
const CAMPOS_MINIMOS = "user_id,username";

/** Guard idêntico ao de /api/instagram/publicar e /api/whatsapp/disparo. */
function autorizado(req: Request): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type PerfilIg = {
  user_id?: string | number;
  username?: string;
  account_type?: string;
};

type ResultadoMe =
  | { ok: true; perfil: PerfilIg; campos: string }
  | { ok: false; erro: string };

/** GET /me na Graph do Instagram. Nunca lança; erro da Graph repassado literal. */
async function consultarMe(campos: string): Promise<ResultadoMe> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, erro: "env_ausente(IG_ACCESS_TOKEN)" };

  const url = `https://graph.instagram.com/${IG_GRAPH_VERSION}/me?fields=${encodeURIComponent(campos)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_IG_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const data: unknown = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const err = (data as { error?: { message?: string; code?: number; error_subcode?: number } })
        ?.error;
      const partes = [
        err?.code !== undefined ? `code=${err.code}` : null,
        err?.error_subcode !== undefined ? `subcode=${err.error_subcode}` : null,
        err?.message ?? `http_${resp.status}`,
      ].filter(Boolean);
      return { ok: false, erro: partes.join(" ").slice(0, 800) };
    }

    return { ok: true, perfil: data as PerfilIg, campos };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_instagram_api(${TIMEOUT_IG_MS}ms)` };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 800) : "erro_desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  let resultado = await consultarMe(CAMPOS_PREFERIDOS);
  // Só vale repetir se a Graph respondeu; env ausente não melhora com retry.
  if (!resultado.ok && !resultado.erro.startsWith("env_ausente")) {
    const minimo = await consultarMe(CAMPOS_MINIMOS);
    if (minimo.ok) resultado = minimo;
  }

  if (!resultado.ok) {
    console.error("[ig-diag] /me recusado:", resultado.erro);
    return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 502 });
  }

  const envUserId = process.env.IG_USER_ID ?? null;
  // A Graph pode devolver o id como número; comparar como string dos dois lados.
  const meUserId =
    resultado.perfil.user_id !== undefined && resultado.perfil.user_id !== null
      ? String(resultado.perfil.user_id)
      : null;
  const confere = !!meUserId && !!envUserId && meUserId === envUserId;

  console.log("[ig-diag] identidade do token:", {
    username: resultado.perfil.username ?? null,
    me_user_id: meUserId,
    env_user_id: envUserId,
    confere,
    campos: resultado.campos,
  });

  return NextResponse.json({
    ok: true,
    me: {
      user_id: meUserId,
      username: resultado.perfil.username ?? null,
      account_type: resultado.perfil.account_type ?? null,
    },
    env_user_id: envUserId,
    confere,
    // Deixa explícito se o account_type veio ou se caímos no conjunto mínimo.
    campos_consultados: resultado.campos,
  });
}
