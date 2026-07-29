// POST /api/interpretar
// Recebe uma frase solta do vendedor ("cliente quer 300 mil em imóvel, tem 80 mil pra lance")
// e devolve os parâmetros prontos para o /api/analista-grupos.
// A IA SÓ extrai parâmetros — ela nunca calcula nem opina aqui.
//
// AUTH: mesma checagem de sessão + papel admin de /api/analista-ia e
// /api/analista-grupos (401 sem sessão, 403 se profiles.tipo !== 'admin'),
// no início do handler, antes de qualquer chamada externa.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const SYSTEM = `Você extrai parâmetros de simulação de consórcio a partir de uma frase em português.
Responda SOMENTE com um objeto JSON válido, sem markdown, sem crases, sem explicação.

Campos e valores permitidos:
- modo: "ranking" (melhores grupos para um crédito) | "juncao" (somar cartas até um valor alto) | "grupo" (um grupo específico foi citado)
- segmento: "auto" | "imovel" | "pesados" | null
- credito: número em reais (modo ranking) ou null
- creditoAlvo: número em reais (modo juncao) ou null
- lancePct: número de 0 a 80; se a pessoa der o lance em reais, converta para % do crédito; se não mencionar, use 30
- tipoLance: "livre" (recurso próprio) | "embutido" (abate do crédito)
- codigo: código do grupo se citado (ex.: "AF217"), senão null
- quantidade: número de 1 a 100 — quantas cartas IGUAIS o cliente quer ("juntar 3 cartas de 200 mil" => 3); se não disser, 1
- modalidade: "venda_nova" (cota não contemplada, padrão) | "contemplada" (se falar em carta contemplada, Bidcon, cota já contemplada)
- parcelamentoAdesao: "a_vista" | "3x" | "5x" | "12x" | "qualquer" (padrão "qualquer")
- resumoPedido: frase curta em português confirmando o que foi entendido

Regras de interpretação:
- Valores acima de R$ 500 mil geralmente indicam modo "juncao"; abaixo disso, "ranking".
- "caminhão", "carreta", "cavalo mecânico", "frota" => segmento "pesados".
- "casa", "apartamento", "terreno", "imóvel", "obra" => "imovel". "carro", "veículo", "moto" => "auto".
- Se o lance vier em reais, lancePct = round(lance / crédito * 100).
- "juntar N cartas de X" / "N cotas de X" => modo "juncao", quantidade N,
  credito = X (valor de CADA carta) e creditoAlvo = N × X (o total).
- Nunca invente segmento: se não der para saber, use null.`;

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
    }
    const { data: perfil } = await supabase
      .from("profiles")
      .select("tipo")
      .eq("id", user.id)
      .maybeSingle();
    if (perfil?.tipo !== "admin") {
      return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
    }

    const { texto } = await req.json();
    if (!texto || typeof texto !== "string") {
      return NextResponse.json({ erro: "texto ausente" }, { status: 400 });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: "user", content: texto }],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return NextResponse.json({ erro: `IA indisponível: ${err.slice(0, 200)}` }, { status: 502 });
    }

    const data = await r.json();
    const bruto = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    let params: any;
    try {
      params = JSON.parse(bruto);
    } catch {
      return NextResponse.json({ erro: "não consegui entender o pedido — tente reescrever" }, { status: 422 });
    }

    // saneamento: a IA propõe, o backend valida
    const seg = ["auto", "imovel", "pesados"].includes(params.segmento) ? params.segmento : null;
    const lim = (v: any, min: number, max: number, dflt: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
    };

    return NextResponse.json({
      parametros: {
        modo: ["ranking", "juncao", "grupo"].includes(params.modo) ? params.modo : "ranking",
        segmento: seg,
        credito: params.credito != null ? lim(params.credito, 1000, 50_000_000, 100_000) : null,
        creditoAlvo: params.creditoAlvo != null ? lim(params.creditoAlvo, 1000, 50_000_000, 1_000_000) : null,
        lancePct: lim(params.lancePct, 0, 80, 30),
        quantidade: Math.round(lim(params.quantidade, 1, 100, 1)),
        tipoLance: params.tipoLance === "embutido" ? "embutido" : "livre",
        codigo: typeof params.codigo === "string" ? params.codigo.toUpperCase() : null,
        modalidade: params.modalidade === "contemplada" ? "contemplada" : "venda_nova",
        parcelamentoAdesao: ["a_vista", "3x", "5x", "12x"].includes(params.parcelamentoAdesao)
          ? params.parcelamentoAdesao
          : "qualquer",
      },
      resumoPedido: typeof params.resumoPedido === "string" ? params.resumoPedido : "",
    });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "erro interno" }, { status: 500 });
  }
}
