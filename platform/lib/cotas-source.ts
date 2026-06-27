// ============================================================================
// Fonte de cotas — fetch + parse SEGURO de 360prospere.vercel.app/cotas.js
// ----------------------------------------------------------------------------
// Mesma fonte JÁ PROVADA que o site estático usa no simulador. Não é
// integração nova: só lemos `window.PROSPERE_COTAS` do arquivo JS público.
//
// As 5 GUARDAS (qualquer falha => abortar, NÃO escrever no banco):
//   1) HTTP != 200            -> aborta
//   2) timeout (sem resposta) -> aborta
//   3) parse falhou           -> aborta
//   4) sanidade de volume     -> 0 cotas, ou queda > MAX_QUEDA, ou abaixo do
//                                piso absoluto MIN_COTAS => aborta (anti-vazio/
//                                anti-truncamento). Protege o estoque.
//   5) (transação/rollback fica na rota do cron, não aqui)
// ============================================================================

export type CotaFonte = {
  numero: number;        // `n` — chave única da cota
  tipo: "imovel" | "veiculo";
  valorCredito: number;  // `c`
  valorEntrada: number;  // `e`
  valorParcela: number;  // `p`
  qtdParcelas: number;   // `x`
};

export type LeituraOk = { ok: true; cotas: CotaFonte[] };
export type LeituraErro = { ok: false; motivo: string };
export type Leitura = LeituraOk | LeituraErro;

const URL_FONTE = "https://360prospere.vercel.app/cotas.js";
const TIMEOUT_MS = 20_000;

// Guarda 4 (configuráveis por env, com defaults sensatos p/ ~373 cotas):
//   - piso absoluto: aborta se vier menos que isso (protege estoque pequeno)
//   - queda máxima: aborta se cair mais que isso vs. a última contagem boa
const MIN_COTAS = Number(process.env.SYNC_MIN_COTAS ?? "50");
const MAX_QUEDA = Number(process.env.SYNC_MAX_QUEDA ?? "0.6"); // 60%

/**
 * Remove comentários do arquivo JS antes de parsear, para o EXEMPLO do
 * cabeçalho ({n:4033,...,r:1}) não vazar como se fosse uma cota real.
 */
function tirarComentarios(js: string): string {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, " ") // bloco /* ... */
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // linha // ... (preserva "http://")
}

/**
 * Extrai as cotas DISPONÍVEIS. Cotas com r:1 (reservadas/vendidas na fonte)
 * são ignoradas — o site só mostra disponíveis, o sync segue a mesma regra
 * (some da lista => tratada como ausente => 'indisponivel' lá na rota).
 */
function parsearCotas(js: string): CotaFonte[] | null {
  const limpo = tirarComentarios(js);
  // só olhamos a partir do array `cotas:` para não pegar `leilao: []`
  const ini = limpo.indexOf("cotas");
  const corpo = ini >= 0 ? limpo.slice(ini) : limpo;

  const re =
    /\{\s*n:\s*(\d+)\s*,\s*t:\s*"(imovel|veiculo)"\s*,\s*c:\s*(\d+)\s*,\s*e:\s*(\d+)\s*,\s*p:\s*(\d+)\s*,\s*x:\s*(\d+)\s*(,\s*r:\s*1\s*)?\}/g;

  const cotas: CotaFonte[] = [];
  const vistos = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpo)) !== null) {
    const reservada = m[7] != null; // tem ,r:1 => indisponível na fonte
    if (reservada) continue;
    const numero = Number(m[1]);
    if (vistos.has(numero)) continue; // dedupe defensivo
    vistos.add(numero);
    cotas.push({
      numero,
      tipo: m[2] as "imovel" | "veiculo",
      valorCredito: Number(m[3]),
      valorEntrada: Number(m[4]),
      valorParcela: Number(m[5]),
      qtdParcelas: Number(m[6]),
    });
  }
  // se não casou nada, o arquivo provavelmente mudou de formato => trata como
  // parse inválido (guarda 3), nunca como "estoque zerou".
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

  // guarda 3: parse
  if (!texto.includes("PROSPERE_COTAS")) {
    return { ok: false, motivo: "marcador_ausente" };
  }
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
