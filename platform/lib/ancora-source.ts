// ============================================================================
// Fonte Âncora — parse SEGURO do JSON da tabela de venda (cotas NOVAS).
// ----------------------------------------------------------------------------
// USO INTERNO da equipe Prospere. NÃO é a fonte de cartas contempladas — é a
// tabela de PREÇO DE ENTRADA do portal da Âncora (taxa, fundo, 1ª parcela).
//
// CONTRATO (decidido com o usuário): os valores de 1ª parcela (PF/PJ, com/sem
//   seguro) e as taxas são LIDOS PRONTOS do portal e ARMAZENADOS COMO ESTÃO.
//   Este parser NUNCA recalcula nem deriva 1ª parcela a partir de taxa/fundo.
//   Campo ausente/ilegível vira `null` (nunca é inventado, nunca vira 0).
//
// PROVENIÊNCIA DO JSON: o conteúdo bruto vem de uma captura autenticada feita
//   pelo usuário (o portal exige sessão da Prospere — fora do alcance do agente).
//   Aqui só recebemos o texto/JSON já capturado e o normalizamos. Não há fetch
//   automático a portal com credencial.
//
// As 5 GUARDAS (qualquer falha => abortar, NÃO escrever no banco):
//   1) entrada não-textual / vazia       -> aborta
//   2) parse falhou (JSON inválido)      -> aborta
//   3) formato inesperado (não-array /    -> aborta (anti-formato-novo)
//      vazio / nenhuma linha casou)
//   4) sanidade de volume (piso absoluto) -> aborta (anti-truncamento)
//   5) (transação/rollback fica na rota do importar, não aqui)
// ============================================================================

// Contrato provisório do shape, igual ao definido com o usuário. Cada campo de
// preço/taxa é opcional (number | null) porque o portal nem sempre traz todos.
export type AncoraLinhaTabela = {
  produto: string;
  bemCodigo: string;
  bemNome: string | null;
  valorDoBem: number | null;
  grupo: string;
  plano: string;
  prazoGrupo: number | null;
  prazoComercializacao: number | null;
  taxaAdministracao: number | null; // fração (0.18 = 18%)
  fundoReserva: number | null;       // fração
  pfComSeguro: number | null;        // 1ª parcela REAL, pronta do portal
  pfSemSeguro: number | null;
  pjComSeguro: number | null;
  pjSemSeguro: number | null;
  assembleia: string | null;
  cotasAtivas: number | null;
  cotasVagas: number | null;
  status: string | null;
};

export type LeituraOk = { ok: true; linhas: AncoraLinhaTabela[] };
export type LeituraErro = { ok: false; motivo: string };
export type Leitura = LeituraOk | LeituraErro;

// Guarda 4: piso absoluto de linhas. Configurável por env; default conservador.
const MIN_LINHAS = Number(process.env.ANCORA_MIN_LINHAS ?? "1");

/**
 * Converte número PT-BR ("24.140,00") OU number cru em number. Remove separador
 * de milhar `.`, troca decimal `,`→`.`. Retorna null se não for finito — NUNCA
 * 0 (campo ausente fica null e o registro pode seguir com null naquele campo).
 * NÃO arredonda: preço guarda centavos.
 */
function parseNumeroPtBr(bruto: unknown): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto !== "string") return null;
  const s = bruto.trim();
  if (s === "") return null;
  const normalizado = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fração de percentual. Aceita "18,00", "18%", 0.18 ou 18 e devolve fração
 * (0.18). Heurística: se vier > 1 assumimos que está em pontos percentuais e
 * dividimos por 100. Ausente/ilegível => null.
 */
function parseFracao(bruto: unknown): number | null {
  const txt = typeof bruto === "string" ? bruto.replace("%", "") : bruto;
  const n = parseNumeroPtBr(txt);
  if (n == null) return null;
  return n > 1 ? n / 100 : n;
}

/** Texto não-vazio normalizado, senão null. */
function texto(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const t = bruto.trim();
  return t === "" ? null : t;
}

/** Inteiro de contagem (cotas/prazo). Ausente/ilegível => null. */
function parseInteiro(bruto: unknown): number | null {
  const n = parseNumeroPtBr(bruto);
  if (n == null) return null;
  return Math.trunc(n);
}

/**
 * Lê UMA linha bruta do portal e devolve AncoraLinhaTabela, ou null se faltar a
 * identificação mínima (produto + bemCodigo + grupo + plano). Os nomes de campo
 * brutos toleram variações comuns do portal; o que não casa fica null.
 *
 * IMPORTANTE: nenhum preço é derivado aqui. Lemos pf/pj com/sem seguro tal como
 * vêm. Se o portal mudar os nomes desses campos, eles caem para null — e isso é
 * preferível a inventar valor.
 */
function mapearLinha(item: unknown): AncoraLinhaTabela | null {
  if (item == null || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;

  const produto = texto(r.produto ?? r.tipo ?? r.segmento);
  const bemCodigo = texto(r.bemCodigo ?? r.bem_codigo ?? r.codigoBem ?? r.bem);
  const grupo = texto(r.grupo);
  const plano = texto(r.plano);
  // identificação mínima obrigatória (chave de upsert): produto+bem+grupo+plano
  if (!produto || !bemCodigo || !grupo || !plano) return null;

  return {
    produto,
    bemCodigo,
    grupo,
    plano,
    bemNome: texto(r.bemNome ?? r.bem_nome ?? r.descricaoBem),
    valorDoBem: parseNumeroPtBr(r.valorDoBem ?? r.valor_do_bem ?? r.valorBem),
    prazoGrupo: parseInteiro(r.prazoGrupo ?? r.prazo_grupo ?? r.prazo),
    prazoComercializacao: parseInteiro(
      r.prazoComercializacao ?? r.prazo_comercializacao ?? r.prazoVenda
    ),
    taxaAdministracao: parseFracao(
      r.taxaAdministracao ?? r.taxa_administracao ?? r.taxaAdm ?? r.taxa
    ),
    fundoReserva: parseFracao(r.fundoReserva ?? r.fundo_reserva ?? r.fundo),
    pfComSeguro: parseNumeroPtBr(
      r.pfComSeguro ?? r.primeiraParcelaPFComSeguro ?? r.pf_com_seguro
    ),
    pfSemSeguro: parseNumeroPtBr(
      r.pfSemSeguro ?? r.primeiraParcelaPFSemSeguro ?? r.pf_sem_seguro
    ),
    pjComSeguro: parseNumeroPtBr(
      r.pjComSeguro ?? r.primeiraParcelaPJComSeguro ?? r.pj_com_seguro
    ),
    pjSemSeguro: parseNumeroPtBr(
      r.pjSemSeguro ?? r.primeiraParcelaPJSemSeguro ?? r.pj_sem_seguro
    ),
    assembleia: texto(r.assembleia),
    cotasAtivas: parseInteiro(r.cotasAtivas ?? r.cotas_ativas),
    cotasVagas: parseInteiro(r.cotasVagas ?? r.cotas_vagas),
    status: texto(r.status),
  };
}

/**
 * Recebe o TEXTO bruto (JSON) capturado do portal e devolve as linhas válidas,
 * ou um erro com motivo. Não faz rede: a captura autenticada é do usuário.
 */
export function parsearTabelaAncora(textoBruto: unknown): Leitura {
  // guarda 1: entrada precisa ser texto não-vazio
  if (typeof textoBruto !== "string" || textoBruto.trim() === "") {
    return { ok: false, motivo: "entrada_vazia_ou_nao_texto" };
  }

  // guarda 2: parse JSON
  let dados: unknown;
  try {
    dados = JSON.parse(textoBruto);
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }

  // o portal pode entregar um array direto ou { dados: [...] } / { linhas: [...] }
  const lista = Array.isArray(dados)
    ? dados
    : Array.isArray((dados as Record<string, unknown>)?.dados)
      ? ((dados as Record<string, unknown>).dados as unknown[])
      : Array.isArray((dados as Record<string, unknown>)?.linhas)
        ? ((dados as Record<string, unknown>).linhas as unknown[])
        : null;

  // guarda 3: formato inesperado
  if (!Array.isArray(lista) || lista.length === 0) {
    return { ok: false, motivo: "formato_inesperado_ou_vazio" };
  }

  const linhas: AncoraLinhaTabela[] = [];
  const vistos = new Set<string>();
  for (const item of lista) {
    const linha = mapearLinha(item);
    if (!linha) continue;
    const chave = `${linha.produto}|${linha.bemCodigo}|${linha.grupo}|${linha.plano}`;
    if (vistos.has(chave)) continue; // dedupe defensivo pela chave de upsert
    vistos.add(chave);
    linhas.push(linha);
  }

  // guarda 3 (continuação): nada casou => provavelmente o formato mudou
  if (linhas.length === 0) {
    return { ok: false, motivo: "nenhuma_linha_reconhecida" };
  }

  // guarda 4: piso absoluto (anti-truncamento)
  if (linhas.length < MIN_LINHAS) {
    return { ok: false, motivo: `abaixo_do_piso: ${linhas.length} < ${MIN_LINHAS}` };
  }

  return { ok: true, linhas };
}
