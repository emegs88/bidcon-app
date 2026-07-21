// GET /api/indices
// Índices oficiais do Banco Central (SGS) usados para projeção de reajuste
// anual das parcelas de consórcio: INCC-DI, IPCA, IGP-M.
// Lógica de fetch+cache mora em lib/indices-bcb.ts (reaproveitada
// server-side sem round-trip HTTP por outras superfícies, ex. buscar_planos
// e /interno/simulador-porto). Esta rota é só um wrapper fino — contrato
// HTTP inalterado.

import { NextResponse } from "next/server";
import { getIndicesBcb } from "@/lib/indices-bcb";

export const dynamic = "force-dynamic";

export async function GET() {
  const resultado = await getIndicesBcb();
  // 502 só no caso "falhou de verdade e não tem nem cache pra servir"
  // (mesmo critério da rota original); índice individual nulo (ex.: só
  // uma das 3 séries do BCB fora do ar) continua 200, sem inventar valor.
  if (resultado.aviso && !resultado.cache) {
    return NextResponse.json({ erro: resultado.aviso }, { status: 502 });
  }
  return NextResponse.json({
    indices: resultado.indices,
    cache: resultado.cache,
    ...(resultado.aviso ? { aviso: resultado.aviso } : {}),
  });
}
