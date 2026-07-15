// GET /api/indices
// Índices oficiais do Banco Central (SGS) usados para projeção de reajuste
// anual das parcelas de consórcio de imóvel: INCC-DI, IPCA, IGP-M.
// Fonte pública, sem autenticação: api.bcb.gov.br/dados/serie/bcdata.sgs.
// Cache em memória de 12h (módulo fica quente no runtime Node da Vercel
// entre invocações da mesma instância) — evita bater no BCB a cada request.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SERIES = {
  incc: 192, // INCC-DI (FGV)
  ipca: 433, // IPCA (IBGE) — referência geral
  igpm: 189, // IGP-M (FGV)
} as const;

type Chave = keyof typeof SERIES;

type Indice = {
  acumulado12m: number | null; // % acumulado nos últimos 12 meses
  atualizadoEm: string;
};

type CacheState = { dados: Record<Chave, Indice>; expiraEm: number } | null;

// módulo-scope: sobrevive entre invocações "quentes" da mesma instância.
let cache: CacheState = null;
const TTL_MS = 12 * 60 * 60 * 1000; // 12h

async function buscarAcumulado12m(codigo: number): Promise<number | null> {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/13?formato=json`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  const dados = (await r.json()) as { data: string; valor: string }[];
  // usa os últimos 12 meses fechados (descarta o mais antigo dos 13, se houver)
  const ultimos12 = dados.slice(-12);
  if (ultimos12.length < 12) return null;
  const fator = ultimos12.reduce((acc, d) => acc * (1 + Number(d.valor) / 100), 1);
  if (!Number.isFinite(fator)) return null;
  return Math.round((fator - 1) * 10000) / 100; // % com 2 casas
}

export async function GET() {
  const agora = Date.now();
  if (cache && cache.expiraEm > agora) {
    return NextResponse.json({ indices: cache.dados, cache: true });
  }

  try {
    const chaves = Object.keys(SERIES) as Chave[];
    const valores = await Promise.all(chaves.map((k) => buscarAcumulado12m(SERIES[k])));
    const agoraIso = new Date().toISOString();
    const dados = Object.fromEntries(
      chaves.map((k, i) => [k, { acumulado12m: valores[i], atualizadoEm: agoraIso }])
    ) as Record<Chave, Indice>;

    cache = { dados, expiraEm: agora + TTL_MS };
    return NextResponse.json({ indices: dados, cache: false });
  } catch (e: any) {
    if (cache) {
      return NextResponse.json({
        indices: cache.dados,
        cache: true,
        aviso: "BCB indisponível — servindo último valor em cache",
      });
    }
    return NextResponse.json(
      { erro: e?.message ?? "erro ao buscar índices BCB" },
      { status: 502 }
    );
  }
}
