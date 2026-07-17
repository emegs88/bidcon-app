// ============================================================================
// Fonte de cotas — PLAYCONTEMPLADAS (playcontempladas.com.br). PLAYCONTEMPLADAS-01.
// ----------------------------------------------------------------------------
// Diferente das demais fontes (lib/cotas-source.ts), que leem um envelope
// JSON já normalizado do prospere-360, esta lê HTML DIRETO do site do
// parceiro — não existe API/JSON pública lá. O site é server-renderizado: a
// tabela inteira de cotas (imóveis + veículos) vem embutida em duas
// <table style="display:none;"> no HTML da home, sem precisar de headless
// browser/JS. Parceria confirmada com o fornecedor (ver PLANO_MESTRE §4).
//
// COMPLIANCE (§1.3, mesma regra das fontes externas CBC/PIFFER/CARTAS/
//   SERVOPA): a entrada bruta do parceiro NÃO é a entrada exibida ao
//   cliente. A Bidcon soma 7% do crédito à entrada crua antes de exibir —
//   fórmula confirmada em scripts/fixture-sync-multifonte.mjs (linha ~163:
//   entrada_parceiro=20000, valor_credito=100000, e=27000 = 20000 +
//   100000*0.07). Nas outras fontes essa conta já vem pronta do prospere-360
//   (camada intermediária); aqui NÃO existe essa camada — o cálculo é feito
//   NESTE arquivo. entradaParceiro (cru) só é usado internamente/admin
//   (entrada_parceiro_raw), nunca exposto ao cliente.
//
// As mesmas 5 GUARDAS de lib/cotas-source.ts, adaptadas pra HTML:
//   1) HTTP != 200            -> aborta a fonte
//   2) timeout (sem resposta) -> aborta a fonte
//   3) parse falhou           -> aborta a fonte (tabela não encontrada /
//                                formato de linha mudou / 0 linhas válidas)
//   4) sanidade de volume     -> abaixo do piso ou queda > MAX_QUEDA vs.
//                                última contagem boa desta fonte
//   5) (transação/rollback fica na RPC/rota do cron, não aqui)
// ============================================================================
import { tipoDe, type CotaFonte, type Leitura } from "@/lib/cotas-source";

const BASE_URL = (
  process.env.PLAYCONTEMPLADAS_URL ?? "https://playcontempladas.com.br/"
).trim();

const TIMEOUT_MS = 20_000;

// Guarda 4: piso PRÓPRIO (não o SYNC_MIN_COTAS=5 genérico, fraco demais pra
// uma fonte que tem ~980 itens normalmente) — protege contra página vindo
// vazia/quebrada sem disparar falso-positivo nas fontes pequenas.
const MIN_COTAS = Number(process.env.PLAYCONTEMPLADAS_MIN_COTAS ?? "200");
const MAX_QUEDA = Number(process.env.SYNC_MAX_QUEDA ?? "0.6"); // 60%, mesma guarda global

const MARGEM_CREDITO = 0.07; // 7% do crédito somado à entrada crua (§1.3)

/** Converte "R$ 1.115.750,00" -> 1115750 (ou null se ilegível). */
function parseBRL(bruto: string): number | null {
  const limpo = bruto
    .replace(/&nbsp;/g, " ")
    .replace(/[^\d.,]/g, "") // tira "R$", espaços etc.
    .trim();
  if (!limpo) return null;
  // formato pt-BR: "." = milhar, "," = decimal
  const semMilhar = limpo.replace(/\./g, "").replace(",", ".");
  const n = Number(semMilhar);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Converte "981" -> 981 (ou null se ilegível/<=0). */
function parseInteiro(bruto: string): number | null {
  const n = Number(bruto.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function normalizarCelula(html: string): string {
  return html
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "") // sem tags aninhadas nas células observadas, defensivo mesmo assim
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrai as cotas a partir do HTML bruto da home do site. Único formato
 * observado: linhas <tr> com exatamente 11 <td> (Cód. Cota | Categoria |
 * Crédito | Entrada | Nº Parcelas | Vlr Parcela | Saldo devedor | Fundo
 * comum | Ref. garantia | Administradora | Status). Cada linha aparece 2x
 * no HTML (artefato do template, confirmado por inspeção) — dedupe por
 * numero+tipo. Status "Reservada" é ignorado (não entra no payload; some
 * da fonte -> sync_varrer_ausentes cuida de marcar indisponível).
 */
function parsearHtml(html: string): CotaFonte[] | null {
  const linhas = html.match(/<tr>([\s\S]*?)<\/tr>/g);
  if (!linhas || linhas.length === 0) return null; // guarda 3

  const cotas: CotaFonte[] = [];
  const vistos = new Map<number, "imovel" | "veiculo">();

  for (const linha of linhas) {
    const celulasBrutas = linha.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
    if (!celulasBrutas || celulasBrutas.length !== 11) continue;
    const celulas = celulasBrutas.map((c) =>
      normalizarCelula(c.replace(/^<td[^>]*>/, "").replace(/<\/td>$/, ""))
    );

    const numero = parseInteiro(celulas[0]);
    const tipo = tipoDe(celulas[1]);
    const status = celulas[10];
    if (numero == null || !tipo) continue;
    if (status !== "Disponível") continue; // Reservada etc. fica de fora

    // dedupe defensivo: mesma numero com tipo divergente = colisão real
    // entre categorias (nunca visto, mas não confiamos cegamente) -> pula
    // a linha e deixa o log de volume acusar se isso virar a maioria.
    const jaVisto = vistos.get(numero);
    if (jaVisto) {
      if (jaVisto !== tipo) continue;
      continue; // duplicata normal do template (2ª ocorrência), ignora
    }

    const valorCredito = parseBRL(celulas[2]);
    const entradaParceiro = parseBRL(celulas[3]);
    const qtdParcelas = parseInteiro(celulas[4]);
    const valorParcela = parseBRL(celulas[5]);
    const administradoraRaw = celulas[9];

    if (
      valorCredito == null || valorCredito <= 0 ||
      entradaParceiro == null ||
      valorParcela == null ||
      qtdParcelas == null
    ) {
      continue; // registro incompleto/ilegível => pula (nunca grava 0)
    }

    // COMPLIANCE §1.3: entrada exibida = crua do parceiro + 7% do crédito.
    const valorEntrada = entradaParceiro + Math.round(valorCredito * MARGEM_CREDITO);

    const administradora =
      administradoraRaw.trim() !== "" ? administradoraRaw.trim() : null;

    vistos.set(numero, tipo);
    cotas.push({
      numero,
      tipo,
      valorCredito,
      valorEntrada,
      valorParcela,
      qtdParcelas,
      entradaParceiro,
      administradora,
    });
  }

  return cotas.length > 0 ? cotas : null; // guarda 3: 0 linhas casadas => formato mudou
}

/**
 * Busca + valida a fonte PLAYCONTEMPLADAS. Mesmo contrato de
 * lerCotasFonte() em lib/cotas-source.ts (guardas 1-4), só que lendo HTML
 * em vez de JSON.
 */
export async function lerCotasPlaycontempladas(
  contagemAnterior: number
): Promise<Leitura> {
  const origem = "PLAYCONTEMPLADAS" as const;

  let resp: Response;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    resp = await fetch(BASE_URL, { signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    return { ok: false, origem, motivo: "fetch_falhou: " + (e as Error).name };
  } finally {
    clearTimeout(t);
  }

  if (resp.status !== 200) {
    return { ok: false, origem, motivo: "http_" + resp.status };
  }

  let html: string;
  try {
    html = await resp.text();
  } catch {
    return { ok: false, origem, motivo: "corpo_ilegivel" };
  }

  const cotas = parsearHtml(html);
  if (!cotas) {
    return { ok: false, origem, motivo: "parse_vazio_ou_formato_novo" };
  }

  if (cotas.length < MIN_COTAS) {
    return {
      ok: false,
      origem,
      motivo: `abaixo_do_piso: ${cotas.length} < ${MIN_COTAS}`,
    };
  }
  if (contagemAnterior > 0) {
    const queda = (contagemAnterior - cotas.length) / contagemAnterior;
    if (queda > MAX_QUEDA) {
      return {
        ok: false,
        origem,
        motivo: `queda_suspeita: ${cotas.length} vs ${contagemAnterior} (${Math.round(
          queda * 100
        )}%)`,
      };
    }
  }

  return { ok: true, origem, cotas };
}
