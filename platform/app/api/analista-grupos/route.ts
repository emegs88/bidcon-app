// POST /api/analista-grupos
// Motor de análise de grupos em andamento (multi-administradora).
// Lê consorcios.vw_grupos_calibrados via service role e calcula:
// parcela por diluição, tempo esperado de contemplação, custo financeiro/mês (TIR)
// e multi-junção de cartas (greedy) para créditos altos.
// Espelha o motor validado nos simuladores Bidcon (jul/2026).
//
// Dados: schema `consorcios` vive no projeto Supabase "xtv" (mesmo projeto de
// administradoras/fornecedores/vitrine — ver lib/supabase-xtv.ts), não no
// projeto principal "nnv" (auth + profiles). Por isso usamos createXtvClient()
// aqui, igual a /api/whatsapp e /api/atende — NUNCA a chave nnv p/ este schema.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createXtvClient } from "@/lib/supabase-xtv";

export const dynamic = "force-dynamic";

const FR = 0.005; // fundo de reserva ~0,5%
const JANELA_PTS = 8; // a até 8 pts do corte → ~3 assembleias

type Grupo = {
  codigo: string;
  segmento: string;
  administradora: string;
  prazo_meses: number;
  assembleia_atual: number;
  restantes: number;
  participantes: number;
  taxa_adm: number | null;
  plano_desc: string | null;
  cred_min: number | null;
  cred_max: number | null;
  corte_ultimo: number | null;
  corte_medio: number | null;
  corte_media_3m: number | null;
  teto_max: number | null;
  tendencia_lance: string | null;
  vencedores_ultimo: number | null;
  vencedores_medio: number | null;
  meses_lance: number | null;
  cotas_venda: number | null;
  redutor_pct: number | null;
  lance_embutido_pct: number | null;
  fila_estimada: number | null;
  vazao_ass: number | null;
};

// ---------- motor ----------
function sorteiosCalibrados(g: Grupo): number {
  const vazao = g.participantes / g.prazo_meses;
  const lances = g.vencedores_ultimo ?? g.vencedores_medio ?? 0;
  return Math.max(0.5, vazao - Number(lances));
}

// corte de referência: média histórica se houver >1 mês, senão último
function corteRef(g: Grupo): number | null {
  if (g.meses_lance && g.meses_lance > 1 && g.corte_media_3m != null)
    return Number(g.corte_media_3m);
  return g.corte_ultimo != null ? Number(g.corte_ultimo) : null;
}

function tempoEsperado(g: Grupo, lancePct: number): number {
  const corte = corteRef(g);
  if (corte != null) {
    if (lancePct >= corte) return 1;
    if (corte - lancePct <= JANELA_PTS) return 3;
  }
  const fila = g.fila_estimada != null ? Number(g.fila_estimada) : g.restantes;
  const t = Math.ceil(fila / sorteiosCalibrados(g));
  return Math.max(1, Math.min(t, g.restantes));
}

function parcelaDiluicao(g: Grupo, credito: number): number {
  const taxa = Number(g.taxa_adm ?? 0) / 100;
  return (credito * (1 + taxa + FR)) / g.restantes;
}

// TIR mensal por bisseção (robusta; Newton puro estoura nesse fluxo)
function tirMensal(fluxo: number[]): number | null {
  const npv = (r: number) =>
    fluxo.reduce((s, f, t) => s + f / Math.pow(1 + r, t), 0);
  let lo = -0.9, hi = 5.0;
  let flo = npv(lo), fhi = npv(hi);
  if (isNaN(flo) || isNaN(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

export type Opcao = {
  codigo: string;
  administradora: string;
  segmento: string;
  credito: number;
  creditoLiquido: number;
  parcela: number;
  tempoEsperadoMeses: number;
  lancePct: number;
  lanceEmbutidoPct: number;
  lanceProprioPct: number;
  lanceProprioRS: number;
  comissaoRS: number; // 7% do crédito, somada à entrada (regra Bidcon)
  desembolsoContemplacao: number;
  saldoDevedorPos: number;
  parcelasRestantesPos: number;
  tirMes: number | null; // custo financeiro ao mês — métrica canônica
  corteReferencia: number | null;
  tendencia: string | null;
  mesesHistorico: number;
  veredito: "vence_agora" | "janela_3m" | "fila";
};

function simular(g: Grupo, credito: number, lancePct: number, tipoLance: "livre" | "embutido"): Opcao | null {
  if (!g.restantes || g.restantes < 1) return null;
  const tetoEmb = Number(g.lance_embutido_pct ?? 0);
  const emb = tipoLance === "embutido" ? Math.min(lancePct, tetoEmb) : 0;
  const proprio = Math.max(0, lancePct - emb);
  const creditoLiquido = credito * (1 - emb / 100);
  const parcela = parcelaDiluicao(g, credito);
  const T = tempoEsperado(g, lancePct);
  const comissao = credito * 0.07; // Bidcon: 7% do crédito na entrada
  const lanceProprioRS = (credito * proprio) / 100;

  // lance abate parcelas finais
  const abateMeses = Math.floor((credito * lancePct) / 100 / parcela);
  const nTotal = Math.max(T, g.restantes - abateMeses);
  const parcelasPos = Math.max(0, nTotal - T);

  // fluxo: t0 = comissão; t1..T = −parcela; em T recebe créditoLiquido e paga lance próprio; depois paga parcelas restantes
  const fluxo: number[] = [-comissao];
  for (let t = 1; t <= nTotal; t++) {
    let f = -parcela;
    if (t === T) f += creditoLiquido - lanceProprioRS;
    fluxo.push(f);
  }
  const tir = tirMensal(fluxo);

  const corte = corteRef(g);
  const veredito: Opcao["veredito"] =
    corte != null && lancePct >= corte ? "vence_agora"
    : corte != null && corte - lancePct <= JANELA_PTS ? "janela_3m"
    : "fila";

  return {
    codigo: g.codigo,
    administradora: g.administradora,
    segmento: g.segmento,
    credito, creditoLiquido, parcela,
    tempoEsperadoMeses: T,
    lancePct, lanceEmbutidoPct: emb, lanceProprioPct: proprio,
    lanceProprioRS, comissaoRS: comissao,
    desembolsoContemplacao: lanceProprioRS + comissao,
    saldoDevedorPos: parcelasPos * parcela,
    parcelasRestantesPos: parcelasPos,
    tirMes: tir != null ? Math.round(tir * 10000) / 100 : null, // % a.m.
    corteReferencia: corte,
    tendencia: g.tendencia_lance,
    mesesHistorico: Number(g.meses_lance ?? 0),
    veredito,
  };
}

// multi-junção diversificada, em camadas de prioridade:
// 1) exclui grupos degenerados: restantes < 10 (parcela diluída explode perto
//    do fim do grupo) e candidatos cuja amostra (simulação em cred_max) dê
//    TIR nula ou <= 0 (grupo não fecha conta — não é opção real de venda).
// 2) camadas por veredito: vence_agora > janela_3m > fila. Só avança pra
//    próxima camada quando a atual não tem mais o que oferecer (estoque/cap
//    esgotados) ou o alvo já foi atingido.
// 3) dentro de cada camada, ordena por TIR crescente (menor custo primeiro)
//    e aloca em rodízio (round-robin) entre os grupos, respeitando cap por
//    grupo = min(vencedores_ultimo ?? 2, 3) e estoque (cotas_venda) — evita
//    concentrar tudo num único grupo.
function multiJuncao(grupos: Grupo[], alvo: number, lancePct: number, tipoLance: "livre" | "embutido", segmento?: string) {
  const CAMADAS: Opcao["veredito"][] = ["vence_agora", "janela_3m", "fila"];

  const eleg = grupos
    .filter(g => (!segmento || g.segmento === segmento) && g.cred_max && g.restantes >= 10)
    .map(g => {
      const amostra = simular(g, Number(g.cred_max), lancePct, tipoLance);
      const capGrupo = Math.max(1, Math.min(Number(g.vencedores_ultimo ?? 2), 3));
      const estoque = g.cotas_venda != null ? Number(g.cotas_venda) : 1;
      const limiteGrupo = Math.min(capGrupo, estoque);
      return { g, amostra, limiteGrupo };
    })
    .filter(
      (e): e is { g: Grupo; amostra: Opcao; limiteGrupo: number } =>
        e.limiteGrupo > 0 && e.amostra != null && e.amostra.tirMes != null && e.amostra.tirMes > 0
    );

  const porCamada = CAMADAS.map(v =>
    eleg.filter(e => e.amostra.veredito === v).sort((a, b) => a.amostra.tirMes! - b.amostra.tirMes!)
  );

  const cartas: Opcao[] = [];
  const usoPorGrupo = new Map<string, number>();
  let acumulado = 0;

  for (const camada of porCamada) {
    if (acumulado >= alvo || cartas.length >= 80) break;
    let progrediu = true;
    while (acumulado < alvo && cartas.length < 80 && progrediu) {
      progrediu = false;
      for (const { g, limiteGrupo } of camada) {
        if (acumulado >= alvo || cartas.length >= 80) break;
        const usadas = usoPorGrupo.get(g.codigo) ?? 0;
        if (usadas >= limiteGrupo) continue;
        const falta = alvo - acumulado;
        const credito = Math.min(Number(g.cred_max), Math.max(Number(g.cred_min ?? 0), falta));
        const op = simular(g, credito, lancePct, tipoLance);
        if (!op || op.tirMes == null || op.tirMes <= 0) continue;
        cartas.push(op);
        acumulado += credito;
        usoPorGrupo.set(g.codigo, usadas + 1);
        progrediu = true;
      }
    }
  }

  const tempoTotal = Math.max(...cartas.map(c => c.tempoEsperadoMeses), 0);
  const resumo = {
    creditoTotal: acumulado,
    cartas: cartas.length,
    gruposDistintos: usoPorGrupo.size,
    parcelaTotal: cartas.reduce((s, c) => s + c.parcela, 0),
    desembolsoTotal: cartas.reduce((s, c) => s + c.desembolsoContemplacao, 0),
    saldoDevedorTotal: cartas.reduce((s, c) => s + c.saldoDevedorPos, 0),
    tempoEsperadoMeses: tempoTotal,
    tirMedia:
      cartas.length > 0
        ? Math.round(
            (cartas.reduce((s, c) => s + (c.tirMes ?? 0), 0) / cartas.length) * 100
          ) / 100
        : null,
  };
  return { resumo, cartas };
}

// ---------- handler ----------
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

    const body = await req.json();
    const {
      modo = "grupo",            // "grupo" | "juncao" | "ranking"
      administradora,            // opcional: slug (ex. "porto"); ausente = TODAS (cruzamento multi-admin)
      segmento,                  // "auto" | "imovel"
      codigo,                    // p/ modo grupo
      credito = 100000,
      creditoAlvo = 1000000,     // p/ modo juncao
      lancePct = 30,
      tipoLance = "livre",       // "livre" | "embutido"
      limite = 10,
    } = body ?? {};

    const db = createXtvClient();

    // RPC (security definer, sem args) — evita expor o schema `consorcios`
    // via .schema().from() e cobre o caso do schema não estar em "Exposed
    // schemas" da API. Filtros aplicados aqui, em memória.
    const { data, error } = await db.rpc("consorcios_grupos_calibrados");
    if (error) throw error;
    let grupos = (data ?? []) as unknown as Grupo[];
    if (administradora) grupos = grupos.filter((g) => g.administradora === administradora);
    if (segmento) grupos = grupos.filter((g) => g.segmento === segmento);
    if (modo === "grupo" && codigo) {
      const alvo = String(codigo).toLowerCase();
      grupos = grupos.filter((g) => g.codigo?.toLowerCase() === alvo);
    }

    if (modo === "grupo") {
      const g = grupos[0];
      if (!g) return NextResponse.json({ erro: "grupo não encontrado" }, { status: 404 });
      return NextResponse.json({ opcao: simular(g, credito, lancePct, tipoLance) });
    }

    if (modo === "juncao") {
      return NextResponse.json(multiJuncao(grupos, creditoAlvo, lancePct, tipoLance, segmento));
    }

    // ranking: melhores opções para o crédito informado
    const ops = grupos
      .filter(g => g.cred_min != null && g.cred_max != null &&
                   credito >= Number(g.cred_min) && credito <= Number(g.cred_max))
      .map(g => simular(g, credito, lancePct, tipoLance))
      .filter((o): o is Opcao => !!o && o.tirMes != null)
      .sort((a, b) => (a.tempoEsperadoMeses - b.tempoEsperadoMeses) || (a.tirMes! - b.tirMes!))
      .slice(0, limite);
    return NextResponse.json({ opcoes: ops });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "erro interno" }, { status: 500 });
  }
}
