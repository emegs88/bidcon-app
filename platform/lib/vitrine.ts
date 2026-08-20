// ============================================================================
// CATALOGO-UNIFICA-01 · FASE 2 — camada PURA da vitrine unificada.
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE, e por que ele NÃO importa o Supabase.
//
// O app logado lia `nnv.cartas` — medido em 19/08/2026: 2 linhas, 0 disponíveis.
// O site público já lia a vitrine do xtv — medido hoje: `vw_vitrine_viva` = 2.295
// linhas, das quais 3 exclusivas, 864 de veículo e 1.431 de imóvel. Duas fontes,
// uma verdade só; a decisão do Emerson foi coalescer na do site.
//
// A lógica que decide o que a pessoa vê (falha vs. vazio, quem vem primeiro,
// como a linha da view vira cartão) mora AQUI, sem `createXtvClient`, por um
// motivo de arnês e não de estética: `scripts/testes.mjs` descobre teste com
// `readdirSync` recursivo sobre DIRS = ["lib"] e o regex /\.test\.tsx?$/. Página
// e componente NÃO são varridos. Se a regra morasse em `app/cartas/page.tsx`,
// ela seria por construção inatingível pela suíte — e a Regra 19 é exatamente o
// tipo de defeito que não grita: ele pinta um vazio bonito na cara do cliente.
//
// A ida à rede mora em `lib/vitrine-fonte.ts`, que é server-only e importa este
// arquivo. A chave de serviço nunca cruza esta fronteira.
// ============================================================================

import { brl, linkWhatsApp } from "@/lib/format";
import { LABEL_TIPO_BEM } from "@/lib/status";
import type { CartaVitrine } from "@/components/CartaCard";
import type { CartaFluxo } from "@/lib/cartas-fluxo";

// ---------------------------------------------------------------------------
// A linha crua da view. São as 16 colunas de `vw_vitrine_viva`, medidas em
// 20/08/2026 por information_schema, nesta ordem:
//   id · ref · tipo · credito · entrada · parcela · parcelas · custo_am ·
//   agio_120 · agio_150 · administradora · criado_em · atualizado ·
//   fingerprint · fonte · exclusiva
//
// Repare nos nomes: a view fala `credito/entrada/parcela/parcelas`, o app fala
// `valor_credito/valor_entrada/valor_parcela/qtd_parcelas`. Nenhum dos dois vai
// ceder — a view serve o site estático e o app serve os componentes que já
// existem. A tradução é `adaptarCarta`, abaixo, e é o único lugar dela.
//
// `administradora` aqui é TEXTO (COALESCE(a.nome, c.administradora_raw, '')),
// não o objeto do embed do PostgREST. Medido: 33 nomes distintos, 0 em branco.
// ---------------------------------------------------------------------------
export type LinhaVitrine = {
  id: string;
  ref: number | null;
  tipo: string;
  credito: number;
  entrada: number | null;
  parcela: number | null;
  parcelas: number | null;
  custo_am: number | null;
  agio_120: number | null;
  agio_150: number | null;
  administradora: string | null;
  criado_em: string;
  fonte: string | null;
  exclusiva: boolean | null;
};

/**
 * Colunas pedidas ao PostgREST. NÃO é `select("*")` de propósito: `fingerprint`
 * e `atualizado` são maquinaria de sincronismo e não têm o que fazer numa tela
 * de cliente, e a lista explícita é o que faz uma coluna nova aparecer aqui por
 * decisão, e não por acidente.
 */
export const COLUNAS_VITRINE =
  "id, ref, tipo, credito, entrada, parcela, parcelas, custo_am, agio_120, agio_150, administradora, criado_em, fonte, exclusiva";

// ---------------------------------------------------------------------------
// REGRA 19 — a leitura tem TRÊS estados, não dois.
// ---------------------------------------------------------------------------
// O defeito que esta fatia mata estava escrito assim, em `app/cartas/page.tsx`:
//
//     const { data: cartas } = await query;      // erro DESCARTADO
//     const lista = (cartas ?? []).map(...)      // falha vira lista vazia
//
// e a tela seguinte dizia "Nenhuma carta disponível agora". Ou seja: a fonte
// caiu e o cliente leu, com toda a calma do mundo, que a Bidcon não tem cartas.
//
// Os três estados:
//   1. error != null              → FALHA. Tem erro para logar.
//   2. error == null && data == null → FALHA TAMBÉM. Este é o buraco silencioso:
//      não há erro para logar, e `data ?? []` o converte em zero sem deixar
//      rastro. É o estado que o `??` esconde, e é por isso que ele é nomeado
//      aqui em vez de coalescido.
//   3. error == null && data == [] → ZERO REAL. A tela pode dizer "nenhuma".
//
// `motivo` existe para o LOG do servidor, nunca para a tela — quem vai à tela é
// `MSG_FALHA_VITRINE`, que não menciona banco, coluna nem projeto.
// ---------------------------------------------------------------------------
export type RespostaSupabase<T> = {
  data: T[] | null;
  error: { message?: string | null } | null;
};

export type Leitura<T> =
  | { ok: true; dados: T[] }
  | { ok: false; motivo: string };

/** O que a PESSOA lê quando a fonte falha. Nunca "nenhuma carta disponível". */
export const MSG_FALHA_VITRINE =
  "Não consegui carregar as cartas agora. Tente de novo em instantes.";

/** O que a PESSOA lê quando o zero é de verdade. */
export const MSG_VAZIO_VITRINE = "Nenhuma carta disponível agora";

export function interpretarLeitura<T>(
  resp: RespostaSupabase<T>,
  etiqueta: string
): Leitura<T> {
  if (resp.error) {
    const msg = resp.error.message ?? "erro sem mensagem";
    return { ok: false, motivo: `${etiqueta}: ${msg}` };
  }
  if (resp.data == null) {
    // Sem erro E sem dados. Não existe leitura bem-sucedida que devolva null;
    // se chegou aqui, alguma coisa entre o cliente e o banco não respondeu.
    return { ok: false, motivo: `${etiqueta}: resposta sem erro e sem dados` };
  }
  return { ok: true, dados: resp.data };
}

// ---------------------------------------------------------------------------
// PARTIÇÃO — o eixo oficial é `exclusiva`, nunca a string.
// ---------------------------------------------------------------------------
// A casa partia por `administradora_origem === "BIDCON_DIRETO"`. Medido: hoje
// isso coincide 1:1 com `fonte = 'cliente_direto'` nas 3 linhas, mas por
// acidente de dado — não há constraint amarrando um ao outro. Decisão do
// Emerson: proveniência é identidade, então o eixo é `fonte`, e a view já
// entrega a coluna derivada `exclusiva boolean` (coluna 16 de 16, medida hoje).
// "BIDCON DIRETO" continua existindo, mas como SELO na tela. O código decide
// por booleano; a marca é exibição.
//
// A ordenação é de DOIS BALDES e ESTÁVEL: dentro de cada bloco a ordem que veio
// do banco (custo, depois crédito) é preservada byte a byte. `Array.sort` do V8
// é estável desde o Node 11, mas não dependemos disso — dois `filter` não têm
// como desordenar nada.
// ---------------------------------------------------------------------------
export function ordenarExclusivaPrimeiro<T extends { exclusiva?: boolean | null }>(
  lista: T[]
): T[] {
  const frente = lista.filter((c) => c.exclusiva === true);
  const resto = lista.filter((c) => c.exclusiva !== true);
  return [...frente, ...resto];
}

// ---------------------------------------------------------------------------
// ADAPTADORES — view → tipos que os componentes já falam.
// ---------------------------------------------------------------------------

/**
 * `vw_vitrine_viva` NÃO carrega `aceita_assuncao`; `xtv.administradoras` carrega
 * (medido: 37 linhas, 35 true, 2 false, 0 null). O casamento é por NOME, que é
 * o que a view expõe.
 *
 * Quando o nome não bate — ou quando a consulta ao dicionário falhou — o valor
 * é `null`, que quer dizer NÃO SEI. Escrever `false` aqui seria fabricar uma
 * medição: a tela passaria a afirmar que a administradora não aceita assunção
 * sem ninguém nunca ter medido isso. `null` é falsy, então o filtro "Só aceita
 * assunção" e o selo continuam se comportando; a diferença é que a casa não
 * mente.
 */
export type MapaAssuncao = Map<string, boolean>;

export function adaptarCarta(
  linha: LinhaVitrine,
  assuncao?: MapaAssuncao | null
): CartaVitrine {
  const nome = (linha.administradora ?? "").trim();
  const aceita = assuncao && nome ? assuncao.get(nome) : undefined;
  return {
    id: linha.id,
    tipo: linha.tipo,
    valor_credito: Number(linha.credito),
    valor_entrada: linha.entrada == null ? null : Number(linha.entrada),
    valor_parcela: linha.parcela == null ? null : Number(linha.parcela),
    qtd_parcelas: linha.parcelas == null ? null : Number(linha.parcelas),
    bidcon_agio_150: linha.agio_150 == null ? null : Number(linha.agio_150),
    bidcon_agio_120: linha.agio_120 == null ? null : Number(linha.agio_120),
    bidcon_custo_am: linha.custo_am == null ? null : Number(linha.custo_am),
    administradora: nome
      ? { nome, aceita_assuncao: aceita === undefined ? null : aceita }
      : null,
    exclusiva: linha.exclusiva === true,
  };
}

/**
 * View → `CartaFluxo`, o formato que `cartasNovas()` consome no Início.
 *
 * O `status: "disponivel"` fixo NÃO é invenção, e é o único ponto deste arquivo
 * onde um valor aparece do nada — então fica declarado: `vw_vitrine_viva` não
 * tem coluna `status` porque ela é definida COM `where status = 'disponivel'`.
 * Toda linha que sai da view já provou ser disponível; o campo aqui só reafirma
 * o invariante da própria view para um consumidor que pede a coluna. Se um dia
 * a view passar a devolver carta não-disponível, este comentário é a dívida a
 * cobrar.
 */
export function paraFluxo(linha: LinhaVitrine): CartaFluxo {
  return {
    id: linha.id,
    valor_credito: Number(linha.credito),
    valor_entrada: linha.entrada == null ? null : Number(linha.entrada),
    valor_parcela: linha.parcela == null ? null : Number(linha.parcela),
    qtd_parcelas: linha.parcelas == null ? null : Number(linha.parcelas),
    status: "disponivel",
    criado_em: linha.criado_em,
  };
}

// ---------------------------------------------------------------------------
// REFERÊNCIA HUMANA DA CARTA
// ---------------------------------------------------------------------------
// Mesma forma já usada em `app/cartas/[id]/page.tsx`: número externo quando
// existe, senão os 8 primeiros do UUID. Serve para a pessoa dizer no WhatsApp
// "a nº 1234" sem precisar ler um UUID em voz alta.
// ---------------------------------------------------------------------------
export function refCarta(ref: number | null | undefined, id: string): string {
  if (ref != null) return `nº ${ref}`;
  return `ref. ${id.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// RESERVA-PONTE — decisão 2 do Emerson.
// ---------------------------------------------------------------------------
// A FASE 2 entrega 2.295 cartas ao app logado, mas a reserva self-service ainda
// aponta para `nnv.cartas`, onde essas cartas não existem. Reservar daria 404.
// A decisão foi PONTE, não bloqueio: o botão vai para o canal que já funciona
// hoje — o WhatsApp do Time Prosperito — com o crédito, a entrada, a parcela e
// o identificador da carta já escritos na mensagem.
//
// SOBRE O MARCADOR `[carta <uuid>]`, e isto precisa ficar escrito porque é fácil
// de acreditar no contrário: ele é o MESMO formato que `public/index.html` usa,
// mas NADA no `platform/` o interpreta. Medido: "[carta " tem 0 ocorrências em
// `platform/` e 1 em `public/`. Não existe parser, não existe rota que o leia,
// não existe gatilho. Quem lê o marcador é uma PESSOA (ou o Prosperito lendo a
// conversa). Ele é uma etiqueta de conferência para ninguém confirmar a carta
// errada — não uma integração. No dia em que virar integração, ela nasce com
// teste e com nome próprio.
//
// O NÚMERO, e por que é ESTE (decisão do Emerson, 20/08/2026 — critério de
// funil, não de gosto): 5511973202967 é a linha da WABA VIVA, onde o cérebro do
// Prosperito atende, onde o `[carta <uuid>]` do prefill é lido por gente e onde
// a conversa vira `wa_conversas`. O 5519997561909 é porta sem ninguém atrás:
// quem chega lá não encontra agente, não entra na fila e não vira lead
// rastreável. Mandar o cliente para uma porta dessas é pior do que não ter
// botão — ele acha que falou com a casa.
//
// ARQUEOLOGIA, porque este número já foi trocado cinco vezes e alguém vai
// querer "consertar" de novo. Medido no git: 11/07 migrou 5519→5511 · 14/07
// voltou para 5519 (bloqueio no WhatsApp Business) · 14/07 voltou para 5511
// (bloqueio resolvido) · 15/07 voltou para 5519 (novo bloqueio) · 03/08
// `ee26b1d` fixou 5511 como "WhatsApp canônico" — mas tocou 18 arquivos, TODOS
// em `public/` e `scripts/`, NENHUM em `platform/`. A divergência não era
// política de dois canais: era uma migração que parou no meio, e ficou 17 dias
// mandando cliente logado para a porta vazia. Esta linha fecha a migração.
//
// Estes são os cinco pontos do app logado: `app/reservar`, `app/minha-carta`,
// `app/meu-processo`, `app/cartas` e `app/cartas/[id]`. Todos importam DAQUI —
// nenhum guarda literal próprio, para que a sexta troca seja uma linha só.
// (`lib/whatsapp/sala.test.ts` também contém 5519997561909, e deve continuar
// contendo: lá é telefone de CONTATO num caso de teste, não a linha da casa.)
// ---------------------------------------------------------------------------
export const WA_PROSPERITO = "5511973202967";

/** Texto honesto da tela. Sem promessa de contemplação, sem léxico de mercado. */
export const NOTA_RESERVA_PONTE = "Reserva acompanhada pelo Time Prosperito";

export function mensagemReservaPonte(carta: {
  id: string;
  ref?: number | null;
  tipo: string;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
}): string {
  const rotulo = (LABEL_TIPO_BEM[carta.tipo] ?? carta.tipo).toLowerCase();
  const referencia = refCarta(carta.ref, carta.id);

  const partes = [`crédito de ${brl(carta.valor_credito)}`];
  if (carta.valor_entrada != null) {
    partes.push(`entrada de ${brl(carta.valor_entrada)}`);
  }
  if (carta.valor_parcela != null) {
    const vezes = carta.qtd_parcelas != null ? `×${carta.qtd_parcelas}` : "";
    partes.push(`parcela de ${brl(carta.valor_parcela)}${vezes}`);
  }

  return (
    `Olá! Quero reservar a carta contemplada de ${rotulo} (${referencia}) — ` +
    `${partes.join(", ")}. Pode me acompanhar nesse passo?` +
    `\n\n[carta ${carta.id}]`
  );
}

export function linkReservaPonte(
  carta: Parameters<typeof mensagemReservaPonte>[0],
  numero: string = WA_PROSPERITO
): string {
  return linkWhatsApp(numero, mensagemReservaPonte(carta));
}
