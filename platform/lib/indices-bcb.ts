// Índices oficiais do Banco Central (SGS) — INCC-DI, IPCA, IGP-M — extraído
// de app/api/indices/route.ts pra uma função server-side chamável direto
// (sem round-trip HTTP), reaproveitável pela tool buscar_planos e por
// qualquer superfície que precise do acumulado 12m real como proxy de
// "índice projetado". A rota GET /api/indices vira wrapper fino desta
// função — contrato HTTP inalterado.

const SERIES = {
  incc: 192, // INCC-DI (FGV)
  ipca: 433, // IPCA (IBGE) — referência geral
  igpm: 189, // IGP-M (FGV)
} as const;

export type ChaveIndiceBcb = keyof typeof SERIES;

export type Indice = {
  acumulado12m: number | null; // % acumulado nos últimos 12 meses
  atualizadoEm: string;
};

export type IndicesBcb = Record<ChaveIndiceBcb, Indice>;

type CacheState = { dados: IndicesBcb; expiraEm: number } | null;

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

/**
 * Busca os índices BCB (com cache de 12h em memória do processo). Nunca
 * lança — em caso de falha da API, devolve o último valor em cache (se
 * houver) ou índices com `acumulado12m: null` (nunca inventa um número).
 */
export async function getIndicesBcb(): Promise<{
  indices: IndicesBcb;
  cache: boolean;
  aviso?: string;
}> {
  const agora = Date.now();
  if (cache && cache.expiraEm > agora) {
    return { indices: cache.dados, cache: true };
  }

  try {
    const chaves = Object.keys(SERIES) as ChaveIndiceBcb[];
    const valores = await Promise.all(chaves.map((k) => buscarAcumulado12m(SERIES[k])));
    const agoraIso = new Date().toISOString();
    const dados = Object.fromEntries(
      chaves.map((k, i) => [k, { acumulado12m: valores[i], atualizadoEm: agoraIso }])
    ) as IndicesBcb;

    cache = { dados, expiraEm: agora + TTL_MS };
    return { indices: dados, cache: false };
  } catch {
    if (cache) {
      return {
        indices: cache.dados,
        cache: true,
        aviso: "BCB indisponível — servindo último valor em cache",
      };
    }
    // sem cache e sem sucesso: devolve estrutura com nulls (nunca inventa)
    const agoraIso = new Date().toISOString();
    const chaves = Object.keys(SERIES) as ChaveIndiceBcb[];
    const dados = Object.fromEntries(
      chaves.map((k) => [k, { acumulado12m: null, atualizadoEm: agoraIso }])
    ) as IndicesBcb;
    return { indices: dados, cache: false, aviso: "BCB indisponível" };
  }
}
