// ============================================================================
// CARROSSEL-OPS-01 Peça 3 — POST /api/whatsapp/carrossel-payload
// Monta o corpo pronto do carrossel `bidcon_vitrine_cartas_v2` a partir do
// estoque vivo. NÃO ENVIA NADA.
// ----------------------------------------------------------------------------
// POR QUE UMA ROTA SÓ PRA MONTAR: `/api/whatsapp/disparo` recebe `components`
// já pronto e só repassa — montar os 6 cards a partir da vitrine sempre foi
// "responsabilidade de quem chama a rota" (comentário de cabeçalho de lá). Até
// agora isso era feito à mão, e um payload montado à mão é onde nasce o card com
// número errado. Esta rota fecha esse buraco sem tocar em uma linha do disparo:
// ela devolve o objeto, um humano lê, e SÓ ENTÃO alguém chama o disparo.
//
// A SEPARAÇÃO É O CONTROLE: aqui não há Graph API, não há upsert, não há insert,
// não há checagem de opt-out — porque não há envio. O `dry_run: true` já vem
// cravado no payload devolvido; quem quiser disparar de verdade precisa trocar
// para `false` conscientemente, no ato de chamar a outra rota. Não existe
// caminho em que uma chamada a esta rota mande mensagem para alguém.
//
// GUARD: mesmo Bearer DISPARO_SECRET do disparo. Mesmo sem enviar nada, a rota
// revela a curadoria da campanha e o estoque ordenado — não é público.
//
// SELEÇÃO: view `vw_vitrine_viva` com a MESMA cadeia de ordenação de
// `/api/vitrine` (exclusiva → ágio 150 → custo → id). A view já garante
// disponível + contemplada + crédito > 0 + sem reserva ativa; ver o cabeçalho de
// lib/carrossel-formato.ts para a medição que justifica usar a view e não
// `cartas` direto. Todos os números saem de lá também, para a arte do card e o
// texto do card nunca discordarem.
//
// COMPLIANCE: nada de "investimento/rendimento/lucro/CDI"; custo em "% a.m.";
// nenhuma promessa de contemplação — o texto do template já é o aprovado.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  CAMPOS_VITRINE,
  normalizarCarta,
  paramTipoAdm,
  paramCredito,
  paramCondicoes,
  urlImagemCard,
  paramBotao,
  type CartaCarrossel,
  type LinhaVitrine,
} from "@/lib/carrossel-formato";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEMPLATE = "bidcon_vitrine_cartas_v2";
const IDIOMA = "pt_BR";
const CARDS = 6;
const POR_TIPO = 3;

// Mesmo guard de /api/whatsapp/disparo, copiado deliberadamente em vez de
// importado: aquele arquivo é intocável nesta fatia.
function autorizado(req: Request): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type Db = ReturnType<typeof createXtvClient>;

/**
 * Lê a vitrine viva na ordem canônica de /api/vitrine. `tipo` nulo = sem filtro.
 * A ordenação por `id` no fim é o desempate estável — sem ele, cartas com mesmo
 * ágio e mesmo custo podem trocar de lugar entre duas chamadas e a campanha sai
 * diferente da que foi conferida.
 */
async function lerVitrine(
  db: Db,
  tipo: string | null,
  limite: number
): Promise<CartaCarrossel[]> {
  let q = db.from("vw_vitrine_viva").select(CAMPOS_VITRINE);
  if (tipo) q = q.eq("tipo", tipo);
  const { data, error } = await q
    .order("exclusiva", { ascending: false })
    .order("agio_150", { ascending: false })
    .order("custo_am", { ascending: true })
    .order("id", { ascending: true })
    .limit(limite);
  if (error) throw error;
  return ((data ?? []) as unknown as LinhaVitrine[])
    .map(normalizarCarta)
    .filter((c): c is CartaCarrossel => c !== null);
}

/**
 * 3 imóveis + 3 veículos quando há pelo menos 3 de cada; senão as 6 melhores do
 * estoque inteiro. Em seguida traz as cartas próprias da Bidcon para a frente —
 * partição ESTÁVEL: dentro de cada bloco a ordem da vitrine é preservada.
 */
async function escolherCartas(db: Db): Promise<CartaCarrossel[]> {
  const [imoveis, veiculos] = await Promise.all([
    lerVitrine(db, "imovel", POR_TIPO),
    lerVitrine(db, "veiculo", POR_TIPO),
  ]);

  const selecionadas =
    imoveis.length >= POR_TIPO && veiculos.length >= POR_TIPO
      ? [...imoveis, ...veiculos]
      : await lerVitrine(db, null, CARDS);

  const proprias = selecionadas.filter((c) => c.exclusiva);
  const demais = selecionadas.filter((c) => !c.exclusiva);
  return [...proprias, ...demais].slice(0, CARDS);
}

/** Um card do carrossel no formato que a Graph API espera. */
function montarCard(carta: CartaCarrossel, indice: number) {
  return {
    card_index: indice,
    components: [
      {
        type: "header",
        parameters: [
          { type: "image", image: { link: urlImagemCard(carta.id) } },
        ],
      },
      {
        type: "body",
        parameters: [
          { type: "text", text: paramTipoAdm(carta) },
          { type: "text", text: paramCredito(carta) },
          { type: "text", text: paramCondicoes(carta) },
        ],
      },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: paramBotao(carta.id) }],
      },
    ],
  };
}

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json(
      { ok: false, erro: "nao_autorizado" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    nome?: unknown;
    telefones?: unknown;
  } | null;

  const nome =
    body && typeof body.nome === "string" && body.nome.trim()
      ? body.nome.trim()
      : null;
  if (!nome) {
    return NextResponse.json(
      { ok: false, erro: "nome (string) obrigatório — é o {{1}} do corpo." },
      { status: 400 }
    );
  }

  // Repassados como vieram: quem valida/normaliza telefone é o disparo, que já
  // faz isso (normalizarTelefoneBR + exclusão + opt-out). Duplicar a regra aqui
  // criaria duas verdades sobre quem pode receber mensagem.
  const telefones = Array.isArray(body?.telefones)
    ? (body.telefones as unknown[]).filter(
        (t): t is string => typeof t === "string"
      )
    : [];

  let cartas: CartaCarrossel[];
  try {
    cartas = await escolherCartas(createXtvClient());
  } catch {
    return NextResponse.json(
      { ok: false, erro: "falha ao ler a vitrine" },
      { status: 500 }
    );
  }

  if (cartas.length < CARDS) {
    return NextResponse.json(
      {
        ok: false,
        erro: `estoque insuficiente: ${cartas.length} carta(s) elegível(is), o template exige ${CARDS}.`,
      },
      { status: 409 }
    );
  }

  const components = [
    { type: "body", parameters: [{ type: "text", text: nome }] },
    { type: "carousel", cards: cartas.map(montarCard) },
  ];

  return NextResponse.json({
    ok: true,
    payload: {
      dry_run: true, // cravado: esta rota nunca entrega algo pronto pra enviar
      telefones,
      templateName: TEMPLATE,
      languageCode: IDIOMA,
      components,
    },
    // Resumo legível pra conferência humana antes de chamar o disparo.
    cartas: cartas.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      administradora: c.administradora,
      credito: c.credito,
      entrada: c.entrada,
      parcelas: c.parcelas,
      parcela: c.parcela,
      custo_am: c.custoAm,
      exclusiva: c.exclusiva,
      imagem: urlImagemCard(c.id),
      linha_1: paramTipoAdm(c),
      linha_2: paramCredito(c),
      linha_3: paramCondicoes(c),
    })),
  });
}
