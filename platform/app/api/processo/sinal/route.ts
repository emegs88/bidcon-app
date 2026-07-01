// POST /api/processo/sinal — sinal (2% do crédito) da reserva da cota (etapa 4).
// Dois modos, ambos do próprio cliente (confirmado por cliente_id = user):
//
//   A) JSON { processo_id }  → registra a INTENÇÃO de pagamento.
//      Com PIX_PROVIDER on, criaria a cobrança e devolveria o copia-e-cola.
//      Sem provedor (padrão), grava a intenção 'pendente' via RPC
//      registrar_pagamento_sinal e devolve { status: 'nao_configurado' } —
//      o cliente paga por fora e anexa o comprovante (modo B).
//
//   B) FormData(processo_id, comprovante) → anexa o comprovante ao bucket
//      PRIVADO `processo-docs` e marca a última linha de sinal como 'manual'
//      (aguardando conferência do admin — fallback sem gateway).
//
// O VALOR do sinal é calculado no servidor (2% do crédito da carta), nunca vem
// do client. Nenhum dado bancário do cliente é coletado aqui.
//
// COMPLIANCE: sem administradora/taxa/comissão. LGPD: comprovante é sensível →
// bucket privado; leitura só por signed URL server-side.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validarArquivo } from "@/lib/kyc";
import { resumoSinal } from "@/lib/sinal";

export const dynamic = "force-dynamic";

const BUCKET = "processo-docs";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// extensão segura a partir do MIME (não usa o nome do arquivo do cliente).
function extDoMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const admin = createAdminClient();

  // ---------- Modo B: anexo de comprovante (multipart/form-data) ----------
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
    }
    const processoId = String(form.get("processo_id") ?? "").trim();
    const comprovante = form.get("comprovante");

    if (!UUID_RE.test(processoId)) {
      return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
    }
    if (!(comprovante instanceof File)) {
      return NextResponse.json({ erro: "Comprovante ausente." }, { status: 422 });
    }
    const val = validarArquivo({ size: comprovante.size, type: comprovante.type }, true);
    if (!val.ok) {
      return NextResponse.json({ erro: val.erro }, { status: 422 });
    }

    // dono do processo + crédito da carta p/ calcular o sinal no servidor.
    const { data: processo } = await supabase
      .from("processos")
      .select("id, valor_entrada, carta_id")
      .eq("id", processoId)
      .eq("cliente_id", user.id)
      .maybeSingle();
    if (!processo) {
      return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
    }

    // sobe o comprovante ao bucket privado.
    const nome = `sinal-${Date.now()}.${extDoMime(comprovante.type)}`;
    const path = `${processoId}/${nome}`;
    const bytes = new Uint8Array(await comprovante.arrayBuffer());
    const up = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: comprovante.type,
      upsert: false,
    });
    if (up.error) {
      return NextResponse.json(
        { erro: "Falha ao armazenar o comprovante." },
        { status: 400 }
      );
    }

    // procura a última linha de sinal do processo; se não houver, cria uma
    // (intenção) com o valor factual do sinal, para o admin conferir.
    const { data: ultimo } = await admin
      .from("pagamentos_sinal")
      .select("id, status")
      .eq("processo_id", processoId)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    let sinalId = (ultimo as { id: string } | null)?.id ?? null;

    if (!sinalId) {
      const { data: carta } = processo.carta_id
        ? await admin
            .from("cartas")
            .select("valor_credito, valor_entrada")
            .eq("id", processo.carta_id)
            .maybeSingle()
        : { data: null };
      const c = carta as { valor_credito: number; valor_entrada: number | null } | null;
      const { sinal } = resumoSinal({
        valor_credito: c?.valor_credito ?? null,
        valor_entrada: c?.valor_entrada ?? processo.valor_entrada ?? null,
      });
      if (sinal == null) {
        await admin.storage.from(BUCKET).remove([path]);
        return NextResponse.json(
          { erro: "Valor do sinal indisponível para este processo." },
          { status: 422 }
        );
      }
      const { data: novo, error: regErr } = await supabase.rpc(
        "registrar_pagamento_sinal",
        { p_processo: processoId, p_valor: sinal }
      );
      if (regErr || !novo) {
        await admin.storage.from(BUCKET).remove([path]);
        return NextResponse.json(
          { erro: "Não foi possível registrar o sinal." },
          { status: 400 }
        );
      }
      sinalId = String(novo);
    }

    // anexa o comprovante e coloca em 'manual' (aguarda conferência do admin).
    const { error: upErr } = await admin
      .from("pagamentos_sinal")
      .update({ comprovante_path: path, status: "manual" })
      .eq("id", sinalId)
      .eq("processo_id", processoId);
    if (upErr) {
      await admin.storage.from(BUCKET).remove([path]);
      return NextResponse.json(
        { erro: "Não foi possível anexar o comprovante." },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, status: "manual" });
  }

  // ---------- Modo A: intenção de pagamento (JSON) ----------
  const body = (await req.json().catch(() => ({}))) as { processo_id?: unknown };
  const processoId = String(body.processo_id ?? "").trim();
  if (!UUID_RE.test(processoId)) {
    return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
  }

  const { data: processo } = await supabase
    .from("processos")
    .select("id, valor_entrada, carta_id")
    .eq("id", processoId)
    .eq("cliente_id", user.id)
    .maybeSingle();
  if (!processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  const { data: carta } = processo.carta_id
    ? await admin
        .from("cartas")
        .select("valor_credito, valor_entrada")
        .eq("id", processo.carta_id)
        .maybeSingle()
    : { data: null };
  const c = carta as { valor_credito: number; valor_entrada: number | null } | null;
  const { sinal } = resumoSinal({
    valor_credito: c?.valor_credito ?? null,
    valor_entrada: c?.valor_entrada ?? processo.valor_entrada ?? null,
  });
  if (sinal == null) {
    return NextResponse.json(
      { erro: "Valor do sinal indisponível para este processo." },
      { status: 422 }
    );
  }

  // registra a intenção 'pendente'. Idempotência simples: se já houver uma
  // linha pendente/manual, não cria outra.
  const { data: aberto } = await admin
    .from("pagamentos_sinal")
    .select("id, status")
    .eq("processo_id", processoId)
    .in("status", ["pendente", "manual", "pago"])
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!aberto) {
    const { error: regErr } = await supabase.rpc("registrar_pagamento_sinal", {
      p_processo: processoId,
      p_valor: sinal,
    });
    if (regErr) {
      return NextResponse.json(
        { erro: "Não foi possível registrar o sinal." },
        { status: 400 }
      );
    }
  }

  // Sem PIX_PROVIDER, o pagamento é manual (cliente paga por fora e anexa o
  // comprovante). Com provedor, aqui criaríamos a cobrança e devolveríamos o
  // copia-e-cola / QR. A ligação é feita quando a chave for definida e autorizada.
  if (!process.env.PIX_PROVIDER) {
    return NextResponse.json({ ok: true, status: "nao_configurado", valor: sinal });
  }

  // provedor configurado: ponto de integração (criar cobrança e devolver payload).
  return NextResponse.json({ ok: true, status: "pendente", valor: sinal });
}
