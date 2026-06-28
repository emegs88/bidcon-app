// ============================================================================
// Fonte de cotas — fetch + parse SEGURO do JSON upstream de contempladas.
// ----------------------------------------------------------------------------
// Lemos a fonte ORIGINAL (JSON público de contempladas), de onde o estoque já
// derivava. Não é integração nova de dados de cliente: só lê o catálogo público
// de cartas disponíveis. Mesma chave de upsert (`numero` => numero_externo),
// então as cartas existentes são ATUALIZADAS no lugar, nunca duplicadas.
//
// COMPLIANCE: a fonte traz campos de mecânica interna/sigilo que NÃO podem
//   chegar ao cliente. Esses campos são DESCARTADOS aqui no parser — nunca são
//   lidos para o objeto de saída, nunca gravados, nunca vetorizados. O objeto
//   `CotaFonte` só carrega: numero, tipo, crédito, entrada, parcela, qtd.
//
// As 5 GUARDAS (qualquer falha => abortar, NÃO escrever no banco):
//   1) HTTP != 200            -> aborta
//   2) timeout (sem resposta) -> aborta
//   3) parse falhou           -> aborta (JSON inválido / não-array / vazio /
//                                formato novo)
//   4) sanidade de volume     -> 0 cotas, ou queda > MAX_QUEDA, ou abaixo do
//                                piso absoluto MIN_COTAS => aborta (anti-vazio/
//                                anti-truncamento). Protege o estoque.
//   5) (transação/rollback fica na rota do cron, não aqui)
// ============================================================================

export type CotaFonte = {
  numero: number;        // `id` da fonte — chave única (=> numero_externo)
  tipo: "imovel" | "veiculo";
  valorCredito: number;  // `valor_credito`
  valorEntrada: number;  // `entrada`
  valorParcela: number;  // `valor_parcela`
  qtdParcelas: number;   // `parcelas`
};

export type LeituraOk = { ok: true; cotas: CotaFonte[] };
export type LeituraErro = { ok: false; motivo: string };
export type Leitura = LeituraOk | LeituraErro;

const URL_FONTE = "https://contempladas.lanceconsorcio.com.br/";
const TIMEOUT_MS = 20_000;

// Guarda 4 (configuráveis por env, com defaults sensatos p/ ~373 cotas):
//   - piso absoluto: aborta se vier menos que isso (protege estoque pequeno)
//   - queda máxima: aborta se cair mais que isso vs. a última contagem boa
const MIN_COTAS = Number(process.env.SYNC_MIN_COTAS ?? "50");
const MAX_QUEDA = Number(process.env.SYNC_MAX_QUEDA ?? "0.6"); // 60%

/**
 * Converte número em formato PT-BR ("24.140,00") para inteiro (24140).
 * Remove separador de milhar `.`, troca decimal `,`→`.` e arredonda — o schema
 * de cartas guarda inteiros. Retorna null se não der um número finito (registro
 * é então pulado, nunca entra como 0).
 */
function parsePtBrNumero(bruto: unknown): number | null {
  if (typeof bruto !== "string") return null;
  const normalizado = bruto.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Mapeia a categoria PT-BR da fonte para o tipo interno. */
function tipoDeCategoria(cat: unknown): "imovel" | "veiculo" | null {
  if (typeof cat !== "string") return null;
  const c = cat.trim().toLowerCase();
  if (c === "veículo" || c === "veiculo") return "veiculo";
  if (c === "imóvel" || c === "imovel") return "imovel";
  return null;
}

/**
 * Extrai as cotas DISPONÍVEIS do JSON da fonte. Registros com
 * `reserva != "Disponível"` (Reservada/vendida na fonte) são ignorados — o sync
 * segue a mesma regra de hoje (some da lista => tratada como ausente =>
 * 'indisponivel' lá na rota).
 *
 * COMPLIANCE: só os campos públicos do bem são lidos. `administradora`, `taxa`
 *   e `fundo` (mecânica interna/sigilo) NUNCA são lidos para o objeto de saída.
 */
function parsearCotas(texto: string): CotaFonte[] | null {
  let dados: unknown;
  try {
    dados = JSON.parse(texto);
  } catch {
    return null; // guarda 3: JSON inválido / formato novo
  }
  if (!Array.isArray(dados) || dados.length === 0) {
    return null; // guarda 3: não é array, ou veio vazio
  }

  const cotas: CotaFonte[] = [];
  const vistos = new Set<number>();

  for (const item of dados) {
    if (item == null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    // só estoque disponível (Reservada/vendida fica de fora)
    if (typeof r.reserva !== "string" || r.reserva.trim() !== "Disponível") {
      continue;
    }

    const numero = parsePtBrNumero(r.id) ?? Number(r.id);
    if (!Number.isFinite(numero) || numero <= 0) continue;
    if (vistos.has(numero)) continue; // dedupe defensivo
    const tipo = tipoDeCategoria(r.categoria);
    if (!tipo) continue;

    const valorCredito = parsePtBrNumero(r.valor_credito);
    const valorEntrada = parsePtBrNumero(r.entrada);
    const valorParcela = parsePtBrNumero(r.valor_parcela);
    const qtdParcelas = parsePtBrNumero(r.parcelas);
    if (
      valorCredito == null ||
      valorEntrada == null ||
      valorParcela == null ||
      qtdParcelas == null
    ) {
      continue; // registro incompleto/ilegível => pula (nunca grava 0)
    }

    vistos.add(numero);
    cotas.push({
      numero,
      tipo,
      valorCredito,
      valorEntrada,
      valorParcela,
      qtdParcelas,
      // administradora / taxa / fundo: DESCARTADOS (compliance).
    });
  }

  // se não casou nada, o formato provavelmente mudou => trata como parse
  // inválido (guarda 3), nunca como "estoque zerou".
  return cotas.length > 0 ? cotas : null;
}

/**
 * Busca + valida a fonte. `contagemAnterior` é a última contagem BOA conhecida
 * (do banco) para a guarda de queda; passe 0 se ainda não houver base.
 */
export async function lerCotasFonte(contagemAnterior: number): Promise<Leitura> {
  let resp: Response;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    resp = await fetch(URL_FONTE, { signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    // guarda 2: timeout/erro de rede
    return { ok: false, motivo: "fetch_falhou: " + (e as Error).name };
  } finally {
    clearTimeout(t);
  }

  // guarda 1: HTTP
  if (resp.status !== 200) {
    return { ok: false, motivo: "http_" + resp.status };
  }

  let texto: string;
  try {
    texto = await resp.text();
  } catch {
    return { ok: false, motivo: "corpo_ilegivel" };
  }

  // guarda 3: parse (JSON inválido, não-array, vazio ou formato novo)
  const cotas = parsearCotas(texto);
  if (!cotas) {
    return { ok: false, motivo: "parse_vazio_ou_formato_novo" };
  }

  // guarda 4: sanidade de volume (anti-vazio / anti-truncamento)
  if (cotas.length < MIN_COTAS) {
    return {
      ok: false,
      motivo: `abaixo_do_piso: ${cotas.length} < ${MIN_COTAS}`,
    };
  }
  if (contagemAnterior > 0) {
    const queda = (contagemAnterior - cotas.length) / contagemAnterior;
    if (queda > MAX_QUEDA) {
      return {
        ok: false,
        motivo: `queda_suspeita: ${cotas.length} vs ${contagemAnterior} (${Math.round(
          queda * 100
        )}%)`,
      };
    }
  }

  return { ok: true, cotas };
}
