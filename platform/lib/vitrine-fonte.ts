// ============================================================================
// CATALOGO-UNIFICA-01 · FASE 2 — a IDA À REDE da vitrine unificada.
// ----------------------------------------------------------------------------
// SOMENTE SERVIDOR. Importa `createXtvClient`, que carrega a service_role do
// projeto xtv; não há "use client" aqui e não pode haver. Toda a lógica que dá
// para testar mora em `lib/vitrine.ts` (puro) — este arquivo é só a torneira.
//
// Por que o xtv e não o nnv: medido em 19/08/2026, `nnv.cartas` tinha 2 linhas
// e ZERO disponíveis, enquanto `xtv.vw_vitrine_viva` tinha 2.295. O app logado
// mostrava o vazio do nnv; o site público já lia o xtv. Uma fonte só, e é esta.
//
// A leitura é por service_role e a view é PÚBLICA por construção (crédito,
// entrada, parcela, prazo, administradora). NUNCA acrescentar `fornecedor_id`
// nem qualquer coluna de quem vendeu a carta ao SELECT — isso é segredo de
// admin e a `COLUNAS_VITRINE` explícita existe para que uma coluna nova só
// apareça aqui por decisão.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  COLUNAS_VITRINE,
  interpretarLeitura,
  adaptarCarta,
  ordenarExclusivaPrimeiro,
  type LinhaVitrine,
  type Leitura,
  type MapaAssuncao,
} from "@/lib/vitrine";
import type { CartaVitrine } from "@/components/CartaCard";

// Teto de linhas por leitura. Medido hoje: a view tem 2.295 linhas, então 3.000
// mostra a vitrine INTEIRA — que é o pedido ("quem loga vê tudo"). O teto existe
// mesmo assim porque `CartasExplorer` é Client Component: cada linha atravessa a
// fronteira servidor→cliente no payload do RSC. Sem teto, o dia em que o
// catálogo dobrar a tela fica lenta sem ninguém ter mudado uma linha de código.
// E quando o teto ENCOSTA, isso vira log — nunca corte silencioso.
export const TETO_VITRINE = 3000;

/**
 * Lê as linhas cruas de `vw_vitrine_viva`.
 *
 * ORDENAÇÃO "vitrine" (padrão): mantida EXATAMENTE a que `/cartas` já usava no
 * nnv — ágio 150 decrescente, depois crédito crescente. A view tem ordem
 * própria (exclusiva, custo), mas o PostgREST não garante preservá-la, e trocar
 * a ordem da tela junto com a troca da FONTE misturaria duas mudanças num
 * diagnóstico só. A partição por `exclusiva` entra depois, em memória, onde há
 * teste.
 *
 * ORDENAÇÃO "novidade": `criado_em` decrescente. Ela EXISTE por causa do
 * `limite`, e vale a pena dizer por quê. O feed do Início pede 60 linhas e
 * depois filtra por janela de 7 dias. Se essas 60 viessem ordenadas por ágio, o
 * banco entregaria 60 cartas quaisquer entre 2.295 — e as recém-chegadas
 * poderiam simplesmente não estar entre elas. O feed diria "nenhuma carta nova"
 * com toda a convicção, sem erro nenhum para ninguém ler. Ordem e corte não são
 * decisões independentes quando existe LIMIT.
 */
export async function lerLinhasVitrine(opts: {
  tipo?: string | null;
  limite?: number;
  ordem?: "vitrine" | "novidade";
} = {}): Promise<Leitura<LinhaVitrine>> {
  const limite = Math.min(opts.limite ?? TETO_VITRINE, TETO_VITRINE);

  const base = createXtvClient().from("vw_vitrine_viva").select(COLUNAS_VITRINE);

  let query =
    opts.ordem === "novidade"
      ? base.order("criado_em", { ascending: false })
      : base
          .order("agio_150", { ascending: false, nullsFirst: false })
          .order("credito", { ascending: true });

  query = query.limit(limite);

  if (opts.tipo) query = query.eq("tipo", opts.tipo);

  const leitura = interpretarLeitura<LinhaVitrine>(
    (await query) as unknown as {
      data: LinhaVitrine[] | null;
      error: { message?: string | null } | null;
    },
    "vitrine/vw_vitrine_viva"
  );

  if (!leitura.ok) {
    // O motivo vai para o LOG do servidor; a tela recebe MSG_FALHA_VITRINE, que
    // não menciona banco, view nem projeto.
    console.error("[vitrine] leitura falhou —", leitura.motivo);
    return leitura;
  }

  // O aviso é só para o TETO DA CASA. Um `limite` pequeno e deliberado (o feed
  // do Início pede 60 e sempre vai receber 60) não é catálogo cortado — é
  // recorte pedido. Avisar nesse caso encheria o log de ruído e ensinaria todo
  // mundo a ignorar a linha justamente no dia em que ela importar.
  if (limite === TETO_VITRINE && leitura.dados.length >= limite) {
    console.warn(
      `[vitrine] teto de ${limite} linhas ENCOSTADO — a tela pode estar cortando catálogo`
    );
  }

  return leitura;
}

/**
 * Dicionário nome → aceita_assuncao. Medido em 20/08/2026: 37 administradoras,
 * 35 true, 2 false, 0 null; a view expõe 33 nomes distintos, 0 em branco.
 *
 * FALHA AQUI NÃO DERRUBA A VITRINE. Assunção é um atributo secundário: sem ele
 * a pessoa ainda vê crédito, entrada, parcela e custo — que é o que decide a
 * compra. Então a falha vira `null` (dicionário ausente) + log, e `adaptarCarta`
 * transforma isso em `aceita_assuncao: null` (NÃO SEI) carta por carta. O que
 * NÃO se faz é devolver um mapa vazio fingindo que todas responderam "não".
 */
export async function lerMapaAssuncao(): Promise<MapaAssuncao | null> {
  const resp = await createXtvClient()
    .from("administradoras")
    .select("nome, aceita_assuncao");

  const leitura = interpretarLeitura<{
    nome: string | null;
    aceita_assuncao: boolean | null;
  }>(resp as never, "vitrine/administradoras");

  if (!leitura.ok) {
    console.error("[vitrine] dicionário de assunção indisponível —", leitura.motivo);
    return null;
  }

  const mapa: MapaAssuncao = new Map();
  for (const a of leitura.dados) {
    const nome = (a.nome ?? "").trim();
    // `aceita_assuncao` null no banco também é NÃO SEI: fica fora do mapa, e o
    // adaptador devolve null. Só entra quem tem resposta medida.
    if (nome && a.aceita_assuncao != null) mapa.set(nome, a.aceita_assuncao);
  }
  return mapa;
}

/**
 * A leitura completa que as telas de vitrine consomem: linhas + dicionário,
 * adaptadas para `CartaVitrine` e com as exclusivas na frente.
 *
 * Devolve `Leitura` — quem chama é OBRIGADO a olhar `ok` antes de olhar
 * `dados`. É essa obrigação, e não um comentário, que impede o retorno do
 * `(cartas ?? [])` que mostrava "Nenhuma carta disponível" quando a fonte caía.
 */
export async function lerCartasVitrine(opts: {
  tipo?: string | null;
  limite?: number;
} = {}): Promise<Leitura<CartaVitrine>> {
  const [linhas, mapa] = await Promise.all([
    lerLinhasVitrine(opts),
    lerMapaAssuncao(),
  ]);

  if (!linhas.ok) return linhas;

  return {
    ok: true,
    dados: ordenarExclusivaPrimeiro(linhas.dados.map((l) => adaptarCarta(l, mapa))),
  };
}
