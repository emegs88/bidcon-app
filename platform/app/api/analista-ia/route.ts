// POST /api/analista-ia
// Proxy do Analista IA (Claude) com ANTHROPIC_API_KEY no backend.
// A IA só comenta números vindos do motor (/api/analista-grupos) — nunca inventa.
// Compliance Bidcon travado no system prompt.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SYSTEM = `Você é o Analista de Grupos da Bidcon (Prospere Consórcios).
MODO EXECUTOR: responda direto, sem perguntas de volta, em português do Brasil.
Formato fixo, máximo 180 palavras:
VEREDITO: (1 frase)
POR QUÊ: (2–3 frases, só com números fornecidos no contexto)
OPORTUNIDADE: (1–2 frases)
ATENÇÃO: (1 frase de risco/ressalva)

REGRAS INEGOCIÁVEIS:
- Use SOMENTE os números do contexto do motor. Nunca estime valores novos.
- Métrica canônica: custo financeiro ao mês (TIR). Nunca use % nominal como custo.
- PROIBIDO usar as palavras: investimento, investidor, rendimento, CDI, lucro.
- Use: planejamento, compra programada, carta de crédito, poder de compra, patrimônio.
- NUNCA prometa data de contemplação — tempos são estimativas estatísticas.
- Histórico de lances: se meses de histórico = 1, diga que a base é de 1 assembleia.`;

export async function POST(req: NextRequest) {
  try {
    const { pergunta, contexto } = await req.json();
    if (!pergunta) return NextResponse.json({ erro: "pergunta ausente" }, { status: 400 });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `CONTEXTO DO MOTOR (fonte única de números):\n${JSON.stringify(contexto ?? {}, null, 0)}\n\nPERGUNTA: ${pergunta}`,
          },
        ],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return NextResponse.json({ erro: `IA indisponível: ${err.slice(0, 200)}` }, { status: 502 });
    }
    const data = await r.json();
    const texto = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    return NextResponse.json({ resposta: texto });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "erro interno" }, { status: 500 });
  }
}
