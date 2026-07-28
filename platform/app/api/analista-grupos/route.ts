// POST /api/analista-grupos
// Motor de análise de grupos em andamento (multi-administradora).
// Lê consorcios.vw_grupos_calibrados via service role e calcula:
// parcela por diluição, tempo esperado de contemplação, custo financeiro/mês (TIR)
// e multi-junção de cartas (greedy) para créditos altos.
// Espelha o motor validado nos simuladores Bidcon (jul/2026).
//
// Modalidade (v3): "venda_nova" (padrão) = cota NÃO contemplada — o cliente
// não paga os 7% Bidcon, e a comissão da Prospere (receita, paga pela
// administradora) vem junto só para o vendedor, fora do fluxo da TIR.
// "contemplada" = marketplace Bidcon, mantém os 7% na entrada.
//
// Dados: schema `consorcios` vive no projeto Supabase "xtv" (mesmo projeto de
// administradoras/fornecedores/vitrine — ver lib/supabase-xtv.ts), não no
// projeto principal "nnv" (auth + profiles). Por isso usamos createXtvClient()
// aqui, igual a /api/whatsapp e /api/atende — NUNCA a chave nnv p/ este schema.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { tirMensal, tirMensalMenorRaiz } from "@/lib/tir";
import { getIndicesBcb } from "@/lib/indices-bcb";

export const dynamic = "force-dynamic";

const FR = 0.005; // fundo de reserva ~0,5%
const JANELA_PTS = 8; // a até 8 pts do corte → ~3 assembleias

type Grupo = {
  codigo: string;
  segmento: string;
  administradora: string;
  administradora_id: number | null;
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

// Modalidade da simulação — decide QUEM paga o quê.
// - "contemplada": marketplace Bidcon de cartas já contempladas. O cliente
//   paga 7% do crédito à Bidcon, somados à entrada (regra canônica).
// - "venda_nova": os grupos da tabela Porto são cotas NÃO contempladas —
//   o cliente não paga os 7%. Cobrar aqui inflaria o fluxo e jogaria a TIR
//   pra cima artificialmente. Default, porque é o caso desta tela.
type Modalidade = "venda_nova" | "contemplada";

type ParcelamentoAdesao = "a_vista" | "3x" | "5x" | "12x" | "qualquer";

// Grade de comissão da Prospere (consorcios.comissoes via RPC). É RECEITA da
// Prospere, paga pela administradora — NUNCA custo do cliente. Por isso não
// entra em nenhum fluxo de TIR; viaja ao lado, só para o vendedor.
type GradeComissao = {
  administradora_id: number | null;
  segmento: string;
  parcelamento_adesao: string;
  pct_total: number | string | null;
  cronograma: number[] | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  observacao: string | null;
};

export type ComissaoProspere = {
  pctTotal: number;
  totalRS: number;
  cronogramaRS: number[];
  parcelas: number;
  observacao: string | null;
};

type Ctx = {
  modalidade: Modalidade;
  parcelamentoAdesao: ParcelamentoAdesao;
  grades: GradeComissao[];
};

const CTX_PADRAO: Ctx = { modalidade: "venda_nova", parcelamentoAdesao: "qualquer", grades: [] };

const cent = (v: number) => Math.round(v * 100) / 100;

// Escolha da grade: casa segmento; imóvel usa o parcelamento da adesão
// (default "qualquer" → cai em "a_vista"), auto e pesados têm grade única
// gravada como "qualquer".
// A administradora entra como trava, não como fallback: só serve a grade da
// própria administradora do grupo (ou uma grade genérica, sem administradora).
// Se amanhã entrar uma administradora sem grade cadastrada, o certo é não
// mostrar comissão — nunca emprestar a grade da Porto pra outra.
function selecionarGrade(g: Grupo, ctx: Ctx): GradeComissao | null {
  const parcelamento: string =
    g.segmento === "imovel"
      ? ctx.parcelamentoAdesao === "qualquer" ? "a_vista" : ctx.parcelamentoAdesao
      : "qualquer";
  const candidatas = ctx.grades.filter(
    (x) => x.segmento === g.segmento && x.parcelamento_adesao === parcelamento
  );
  return (
    candidatas.find((x) => x.administradora_id === g.administradora_id) ??
    candidatas.find((x) => x.administradora_id == null) ??
    null
  );
}

function comissaoProspereDe(g: Grupo, credito: number, ctx: Ctx): ComissaoProspere | null {
  if (ctx.modalidade !== "venda_nova") return null;
  const grade = selecionarGrade(g, ctx);
  if (!grade) return null;
  const pctTotal = Number(grade.pct_total);
  if (!Number.isFinite(pctTotal)) return null;
  const totalRS = (credito * pctTotal) / 100;
  const pesos = (grade.cronograma ?? []).map(Number).filter((n) => Number.isFinite(n));
  const cronograma = pesos.length ? pesos : [1];
  return {
    pctTotal,
    totalRS: cent(totalRS),
    cronogramaRS: cronograma.map((p) => cent(totalRS * p)),
    parcelas: cronograma.length,
    observacao: grade.observacao ?? null,
  };
}

// soma posição a posição de cronogramas de comprimentos diferentes
function somarCronogramas(listas: number[][]): number[] {
  const n = Math.max(0, ...listas.map((l) => l.length));
  const out = new Array(n).fill(0);
  for (const l of listas) l.forEach((v, i) => { out[i] += v; });
  return out.map(cent);
}

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

// TIR mensal por bisseção — ver lib/tir.ts (extraído daqui pra reaproveitar
// noutras superfícies; comportamento idêntico, zero mudança de resultado).

// Regra permanente "toda simulação termina em TIR": além do tirMes nominal
// (já validado em produção, comportamento inalterado), cada opção também
// traz o custo efetivo COM índice projetado — mesmo padrão do vendanova
// (lib/disal/custo-efetivo-plano-novo.ts): parcela reajustada em degrau
// anual pelo índice real (BCB, acumulado 12m) e o crédito recebido na
// contemplação também corrigido até lá (mesma correção validada no caso
// Disal — reajuste pré-contemplação acompanha o crédito, não só a parcela).
// vw_grupos_calibrados não tem coluna de índice por grupo — mapeamento
// estático por segmento, igual ao vendanova: imovel→INCC, auto→IPCA.
export type IndicesSegmento = { imovel: number | null; auto: number | null };

function indiceLabelSegmento(segmento: string): "INCC" | "IPCA" | null {
  if (segmento === "imovel") return "INCC";
  if (segmento === "auto") return "IPCA";
  return null;
}

function indicePctSegmento(segmento: string, indices?: IndicesSegmento | null): number | null {
  if (!indices) return null;
  if (segmento === "imovel") return indices.imovel;
  if (segmento === "auto") return indices.auto;
  return null;
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
  modalidade: Modalidade;
  comissaoRS: number; // custo do cliente: 7% do crédito só em "contemplada"; 0 em venda nova
  comissaoProspere: ComissaoProspere | null; // receita da Prospere (só venda nova) — fora do fluxo
  desembolsoContemplacao: number;
  saldoDevedorPos: number;
  parcelasRestantesPos: number;
  tirMes: number | null; // custo financeiro ao mês — métrica canônica
  tirMesComIndice: number | null; // idem, com índice projetado (estimativa)
  indiceLabel: "INCC" | "IPCA" | null;
  corteReferencia: number | null;
  tendencia: string | null;
  mesesHistorico: number;
  veredito: "vence_agora" | "janela_3m" | "fila";
};

function simular(
  g: Grupo,
  credito: number,
  lancePct: number,
  tipoLance: "livre" | "embutido",
  indices?: IndicesSegmento | null,
  ctx: Ctx = CTX_PADRAO
): Opcao | null {
  if (!g.restantes || g.restantes < 1) return null;
  const tetoEmb = Number(g.lance_embutido_pct ?? 0);
  const emb = tipoLance === "embutido" ? Math.min(lancePct, tetoEmb) : 0;
  const proprio = Math.max(0, lancePct - emb);
  const creditoLiquido = credito * (1 - emb / 100);
  const parcela = parcelaDiluicao(g, credito);
  const T = tempoEsperado(g, lancePct);
  // 7% Bidcon na entrada SÓ existe no marketplace de contempladas. Em venda
  // nova (cota não contemplada) o cliente não paga essa comissão.
  const comissao = ctx.modalidade === "contemplada" ? credito * 0.07 : 0;
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

  // fluxo com índice projetado (estimativa) — parcela em degrau anual pelo
  // índice real do segmento; crédito e lance próprio recebidos/pagos em T
  // também corrigidos pelo fator acumulado até lá (mesmo padrão validado
  // no vendanova). tirMensalMenorRaiz (não tirMensal) porque esse fluxo
  // pode ter mais de uma raiz — pega a economicamente relevante.
  const gPct = indicePctSegmento(g.segmento, indices);
  let tirComIndice: number | null = null;
  if (gPct != null) {
    const gFrac = gPct / 100;
    const fatorEmT = Math.pow(1 + gFrac, Math.floor((T - 1) / 12));
    const fluxoComIndice: number[] = [-comissao];
    for (let t = 1; t <= nTotal; t++) {
      const fatorMes = Math.pow(1 + gFrac, Math.floor((t - 1) / 12));
      let f = -(parcela * fatorMes);
      if (t === T) f += (creditoLiquido - lanceProprioRS) * fatorEmT;
      fluxoComIndice.push(f);
    }
    tirComIndice = tirMensalMenorRaiz(fluxoComIndice);
  }

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
    lanceProprioRS,
    modalidade: ctx.modalidade,
    comissaoRS: comissao,
    comissaoProspere: comissaoProspereDe(g, credito, ctx),
    desembolsoContemplacao: lanceProprioRS + comissao,
    saldoDevedorPos: parcelasPos * parcela,
    parcelasRestantesPos: parcelasPos,
    tirMes: tir != null ? Math.round(tir * 10000) / 100 : null, // % a.m.
    tirMesComIndice: tirComIndice != null ? Math.round(tirComIndice * 10000) / 100 : null,
    indiceLabel: indiceLabelSegmento(g.segmento),
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
function multiJuncao(
  grupos: Grupo[],
  alvo: number,
  lancePct: number,
  tipoLance: "livre" | "embutido",
  segmento?: string,
  indices?: IndicesSegmento | null,
  ctx: Ctx = CTX_PADRAO
) {
  const CAMADAS: Opcao["veredito"][] = ["vence_agora", "janela_3m", "fila"];

  const eleg = grupos
    .filter(g => (!segmento || g.segmento === segmento) && g.cred_max && g.restantes >= 10)
    .map(g => {
      const amostra = simular(g, Number(g.cred_max), lancePct, tipoLance, indices, ctx);
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
        const op = simular(g, credito, lancePct, tipoLance, indices, ctx);
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
    // receita consolidada da Prospere na cesta (só venda nova; null quando não há grade)
    comissaoProspereTotal: (() => {
      const com = cartas.filter(c => c.comissaoProspere != null);
      return com.length > 0 ? cent(com.reduce((s, c) => s + c.comissaoProspere!.totalRS, 0)) : null;
    })(),
    comissaoProspereCronograma: (() => {
      const cron = cartas.filter(c => c.comissaoProspere != null).map(c => c.comissaoProspere!.cronogramaRS);
      return cron.length > 0 ? somarCronogramas(cron) : null;
    })(),
    tirMedia:
      cartas.length > 0
        ? Math.round(
            (cartas.reduce((s, c) => s + (c.tirMes ?? 0), 0) / cartas.length) * 100
          ) / 100
        : null,
    tirMediaComIndice: (() => {
      const comIndice = cartas.filter(c => c.tirMesComIndice != null);
      return comIndice.length > 0
        ? Math.round(
            (comIndice.reduce((s, c) => s + (c.tirMesComIndice ?? 0), 0) / comIndice.length) * 100
          ) / 100
        : null;
    })(),
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
      segmento,                  // "auto" | "imovel" | "pesados" — sem hardcode, vale o que vier do banco
      codigo,                    // p/ modo grupo
      credito = 100000,
      creditoAlvo = 1000000,     // p/ modo juncao
      lancePct = 30,
      tipoLance = "livre",       // "livre" | "embutido"
      limite = 10,
      modalidade: modalidadeBody,        // "venda_nova" (padrão) | "contemplada"
      parcelamentoAdesao: parcBody,      // "a_vista" | "3x" | "5x" | "12x" | "qualquer" (padrão)
    } = body ?? {};

    const modalidade: Modalidade = modalidadeBody === "contemplada" ? "contemplada" : "venda_nova";
    const parcelamentoAdesao: ParcelamentoAdesao =
      ["a_vista", "3x", "5x", "12x"].includes(parcBody) ? parcBody : "qualquer";

    const db = createXtvClient();

    // RPC (security definer, sem args) — evita expor o schema `consorcios`
    // via .schema().from() e cobre o caso do schema não estar em "Exposed
    // schemas" da API. Filtros aplicados aqui, em memória. Índices BCB
    // buscados em paralelo (cache 12h — ver lib/indices-bcb.ts) pro
    // tirMesComIndice; nunca inventa valor, só null se indisponível.
    // A grade de comissão da Prospere (consorcios_comissoes) só é usada em
    // venda nova — em "contemplada" nem se busca. Falha na grade não derruba
    // a simulação: sem grade, a opção volta com comissaoProspere = null.
    const [{ data, error }, indicesResult, gradesResult] = await Promise.all([
      db.rpc("consorcios_grupos_calibrados"),
      getIndicesBcb(),
      modalidade === "venda_nova"
        ? db.rpc("consorcios_comissoes")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (error) throw error;
    const indices: IndicesSegmento = {
      imovel: indicesResult.indices.incc.acumulado12m,
      auto: indicesResult.indices.ipca.acumulado12m,
    };

    const hoje = new Date().toISOString().slice(0, 10);
    const grades = ((gradesResult.data ?? []) as unknown as GradeComissao[]).filter(
      (x) =>
        (x.vigencia_inicio == null || x.vigencia_inicio <= hoje) &&
        (x.vigencia_fim == null || x.vigencia_fim >= hoje)
    );
    const ctx: Ctx = { modalidade, parcelamentoAdesao, grades };
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
      return NextResponse.json({ opcao: simular(g, credito, lancePct, tipoLance, indices, ctx) });
    }

    if (modo === "juncao") {
      return NextResponse.json(multiJuncao(grupos, creditoAlvo, lancePct, tipoLance, segmento, indices, ctx));
    }

    // ranking: melhores opções para o crédito informado
    const ops = grupos
      .filter(g => g.cred_min != null && g.cred_max != null &&
                   credito >= Number(g.cred_min) && credito <= Number(g.cred_max))
      .map(g => simular(g, credito, lancePct, tipoLance, indices, ctx))
      .filter((o): o is Opcao => !!o && o.tirMes != null)
      .sort((a, b) => (a.tempoEsperadoMeses - b.tempoEsperadoMeses) || (a.tirMes! - b.tirMes!))
      .slice(0, limite);
    return NextResponse.json({ opcoes: ops });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "erro interno" }, { status: 500 });
  }
}
