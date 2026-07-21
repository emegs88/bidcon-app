// ============================================================================
// POST /api/whatsapp/disparo — envio em massa de campanha WhatsApp (template
// Meta aprovado, ex. bidcon_vitrine_cartas_v1 — carrossel de 6 cards).
// FATIA DISPARO-01. Gatilhada MANUALMENTE (não é cron) por quem opera a
// campanha — o número real de produção já está ativo, então esta rota lida
// com envio de verdade a clientes. Todos os guards abaixo são obrigatórios e
// "burros à prova de erro humano": secret dedicado, dry_run obrigatório no
// corpo, exclusão codificada de um número específico, e checagem dupla de
// opt-out (LGPD).
// ----------------------------------------------------------------------------
// Lista de alvos: vem explícita no corpo (`telefones: string[]`) — sem query
// automática em wa_conversas/interesses. Componentes do template: a rota
// recebe o array `components` já pronto (estrutura do carrossel Meta) e só
// repassa pro sendTemplate() existente — montar os 6 cards a partir da
// vitrine é responsabilidade de quem chama a rota (fora de escopo).
//
// Reaproveita sendTemplate() (lib/whatsapp/graph.ts) sem alterar nada do seu
// comportamento — ele já faz o guard de opt-out (2ª checagem, cobre corrida
// com a checagem #1 explícita abaixo) + chamada à Graph API + log em
// wa_mensagens. graph.ts fica 100% intocado nesta fatia.
//
// Sequencial (não paralelo): throttle de 1 msg / 2s só faz sentido com envio
// um-a-um — loop for...of com await, nada de Promise.all.
//
// dry_run:true = ZERO efeito colateral (nenhum upsert, nenhum insert, nenhuma
// chamada à Graph API) — só valida normalização/exclusão/opt-out/duplicata e
// reporta o que aconteceria.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { sendTemplate } from "@/lib/whatsapp/graph";
import { normalizarTelefoneBR } from "@/lib/telefone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NUMERO_EXCLUIDO = "5511973202967"; // hard-exclusão pedida, sem exceção
const THROTTLE_MS = 2000; // 1 msg / 2s
const MAX_TELEFONES_POR_CHAMADA = 500; // guard de segurança anti-blast por erro de digitação

function autorizado(req: Request): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type ResultadoTelefone = {
  telefone: string;
  ok: boolean;
  motivo?: "invalido" | "excluido" | "opt_out" | "duplicado" | "falha_envio";
  waMessageId?: string;
  erro?: string;
};

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    telefones?: unknown;
    templateName?: unknown;
    languageCode?: unknown;
    components?: unknown;
    textoRegistro?: unknown;
    dry_run?: unknown;
  } | null;

  if (!body || typeof body.dry_run !== "boolean") {
    return NextResponse.json(
      { erro: "dry_run (boolean) é obrigatório no corpo da requisição." },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.telefones) || body.telefones.length === 0) {
    return NextResponse.json(
      { erro: "telefones: string[] obrigatório." },
      { status: 400 }
    );
  }
  if (body.telefones.length > MAX_TELEFONES_POR_CHAMADA) {
    return NextResponse.json(
      { erro: `máximo ${MAX_TELEFONES_POR_CHAMADA} telefones por chamada.` },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.components) || body.components.length === 0) {
    return NextResponse.json(
      { erro: "components (array do template) obrigatório." },
      { status: 400 }
    );
  }

  const templateName =
    typeof body.templateName === "string" && body.templateName
      ? body.templateName
      : "bidcon_vitrine_cartas_v1";
  const languageCode =
    typeof body.languageCode === "string" ? body.languageCode : "pt_BR";
  const textoRegistro =
    typeof body.textoRegistro === "string" && body.textoRegistro
      ? body.textoRegistro
      : `[template] ${templateName}`;
  const dryRun = body.dry_run;

  const db = createXtvClient();
  const vistos = new Set<string>();
  const resultados: ResultadoTelefone[] = [];

  for (const bruto of body.telefones as unknown[]) {
    const telefone = normalizarTelefoneBR(bruto);

    if (!telefone) {
      resultados.push({ telefone: String(bruto), ok: false, motivo: "invalido" });
      continue;
    }
    if (telefone === NUMERO_EXCLUIDO) {
      resultados.push({ telefone, ok: false, motivo: "excluido" });
      continue;
    }
    if (vistos.has(telefone)) {
      resultados.push({ telefone, ok: false, motivo: "duplicado" });
      continue;
    }
    vistos.add(telefone);

    // Guard opt-out #1: checagem explícita ANTES de qualquer upsert/envio
    // (leitura simples; se o contato não existe ainda, não está opt-out).
    const { data: existente } = await db
      .from("wa_conversas")
      .select("id, opt_out")
      .eq("telefone", telefone)
      .maybeSingle();
    if (existente?.opt_out === true) {
      resultados.push({ telefone, ok: false, motivo: "opt_out" });
      continue;
    }

    if (dryRun) {
      // dry_run = zero efeito colateral: nenhum upsert, nenhum insert,
      // nenhuma chamada à Graph API — só reporta o que aconteceria.
      resultados.push({ telefone, ok: true });
      continue;
    }

    // Upsert do contato (mesmo padrão do webhook) — só no envio de verdade.
    const { data: conversa, error: errConversa } = await db
      .from("wa_conversas")
      .upsert({ telefone }, { onConflict: "telefone" })
      .select("id")
      .single();
    if (errConversa || !conversa) {
      resultados.push({
        telefone,
        ok: false,
        motivo: "falha_envio",
        erro: "upsert_wa_conversas",
      });
      continue;
    }

    // Guard opt-out #2: dentro do sendTemplate (conversaOptOut, já existe em
    // graph.ts) — cobre corrida entre a leitura acima e o envio agora.
    const envio = await sendTemplate({
      conversaId: conversa.id,
      telefone,
      templateName,
      languageCode,
      components: body.components as unknown[],
      textoRegistro,
    });

    resultados.push(
      envio.ok
        ? { telefone, ok: true, waMessageId: envio.waMessageId }
        : {
            telefone,
            ok: false,
            motivo: envio.erro === "opt_out" ? "opt_out" : "falha_envio",
            erro: envio.erro,
          }
    );

    await new Promise((r) => setTimeout(r, THROTTLE_MS)); // 1 msg / 2s
  }

  const enviados = resultados.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    total: resultados.length,
    enviados,
    falhas: resultados.length - enviados,
    resultados,
  });
}
