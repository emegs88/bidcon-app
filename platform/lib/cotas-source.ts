// ============================================================================
// Fonte de cotas — fetch + parse SEGURO do feed MULTI-FONTE do prospere-360.
// ----------------------------------------------------------------------------
// Antes esta lib lia a Lance direto (contempladas.lanceconsorcio.com.br). Agora
// consome o feed já normalizado do prospere-360 — as MESMAS rotas que a vitrine
// pública usa — em modo ?admin=1, para que "visível na vitrine" seja de fato
// "reservável na plataforma". São 4 fontes-marca externas + a Lance:
//   - LANCE   -> /api/cotas            (Lance/HS; 7% já embutido na origem)
//   - CBC     ┐
//   - PIFFER  ├ /api/cotas-extra       (Bidcon soma 7% na entrada exibida)
//   - CARTAS  ┘
//   - SERVOPA -> /api/cotas-servopa    (Bidcon soma 7% na entrada exibida)
//
// Cada fonte é lida SEPARADAMENTE e passa pelas 5 guardas por conta própria
// (decisão B): a falha de uma fonte NUNCA derruba nem apaga o estoque de outra.
// A rota do cron (app/api/sync-cotas) itera as fontes e aplica cada uma via
// sync_aplicar_cotas(p_origem, p_cotas), fonte a fonte.
//
// COMPLIANCE (§1.3): a entrada EXIBIDA (`e`) já vem pronta da fonte (com os 7%
//   nas externas; crua==correta na Lance) — a plataforma NÃO recalcula comissão.
//   `entrada_parceiro` (valor CRU do parceiro) só vem em ?admin=1 e é gravado em
//   entrada_parceiro_raw (admin-only), NUNCA exposto ao cliente. `adm` (nome da
//   administradora) passa a ser lido a partir da fatia 0023; mecânica de
//   margem segue não lida aqui.
//
// As 5 GUARDAS (por fonte; qualquer falha => aquela fonte é PULADA, sem escrever):
//   1) HTTP != 200            -> aborta a fonte
//   2) timeout (sem resposta) -> aborta a fonte
//   3) parse falhou           -> aborta a fonte (JSON inválido / envelope errado
//                                / cotas não-array / vazio / formato novo)
//   4) sanidade de volume     -> 0 cotas, ou queda > MAX_QUEDA vs. a última
//                                contagem boa DAQUELA fonte, ou abaixo do piso
//                                MIN_COTAS => aborta a fonte (anti-vazio/
//                                anti-truncamento). Protege o estoque.
//   5) (transação/rollback fica na RPC/rota do cron, não aqui)
// ============================================================================

export type FonteMarca =
  | "LANCE"
  | "CBC"
  | "PIFFER"
  | "CARTAS"
  | "SERVOPA"
  | "PLAYCONTEMPLADAS";

export type CotaFonte = {
  numero: number;        // id nativo da fonte (`n` na Lance, `id` nas demais) => numero_externo
  tipo: "imovel" | "veiculo";
  valorCredito: number;  // `c` — crédito
  valorEntrada: number;  // `e` — entrada JÁ EXIBIDA ao cliente (com 7% nas externas)
  valorParcela: number;  // `p` — valor da parcela
  qtdParcelas: number;   // `x` — nº de parcelas
  // valor CRU do parceiro (Opção B), só nas fontes externas em ?admin=1.
  // null para LANCE (não há valor cru separado) e quando a fonte não trouxe.
  entradaParceiro: number | null;
  // nome da administradora, lido a partir da fatia 0023 (`adm` no envelope).
  administradora: string | null;
};

export type LeituraOk = { ok: true; origem: FonteMarca; cotas: CotaFonte[] };
export type LeituraErro = { ok: false; origem: FonteMarca; motivo: string };
export type Leitura = LeituraOk | LeituraErro;

// Base do backend de dados (prospere-360). Configurável por env; default = o
// mesmo host que a vitrine pública já consome.
const BASE = (
  process.env.PROSPERE_360_BASE ?? "https://360prospere.vercel.app"
).replace(/\/+$/, "");

const TIMEOUT_MS = 20_000;

// Guarda 4 (configuráveis por env). O piso e a queda valem POR FONTE — cada
// fonte tem volume próprio, então o piso é propositalmente baixo (fontes menores
// existem). A queda compara contra a última contagem boa daquela fonte.
const MIN_COTAS = Number(process.env.SYNC_MIN_COTAS ?? "5");
const MAX_QUEDA = Number(process.env.SYNC_MAX_QUEDA ?? "0.6"); // 60%

// Mapa fonte-marca -> endpoint. A Lance tem shape ligeiramente diferente (id em
// `n`, sem entrada_parceiro); as demais compartilham o shape de cotas-extra/servopa.
// Partial (não Record<FonteMarca,...>): PLAYCONTEMPLADAS não tem endpoint JSON
// aqui (lida via HTML em lib/playcontempladas-source.ts, nunca por esta função) —
// ver guarda defensiva em lerCotasFonte() logo abaixo.
const ENDPOINTS: Partial<Record<FonteMarca, string>> = {
  LANCE:   "/api/cotas?admin=1",
  CBC:     "/api/cotas-extra?admin=1",
  PIFFER:  "/api/cotas-extra?admin=1",
  CARTAS:  "/api/cotas-extra?admin=1",
  SERVOPA: "/api/cotas-servopa?admin=1",
};

/** Converte para inteiro não-negativo, ou null se não for número finito. */
function inteiro(bruto: unknown): number | null {
  const n = typeof bruto === "number" ? bruto : Number(bruto);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Normaliza o tipo do bem vindo da fonte ('imovel'|'veiculo'). Exportada
 *  pra reuso em lib/playcontempladas-source.ts (mesma regra de mapeamento,
 *  aplicada agora a texto de coluna HTML em vez de campo `t` do JSON). */
export function tipoDe(bruto: unknown): "imovel" | "veiculo" | null {
  if (typeof bruto !== "string") return null;
  const c = bruto.trim().toLowerCase();
  if (c === "veiculo" || c === "veículo") return "veiculo";
  if (c === "imovel" || c === "imóvel") return "imovel";
  return null;
}

/**
 * Extrai as cotas de UMA fonte a partir do envelope JSON do prospere-360.
 * Filtra por `fonte` quando o endpoint agrega várias marcas (cotas-extra traz
 * CBC+PIFFER+CARTAS juntas; aqui pegamos só as da `origem` pedida).
 *
 * `id` nativo: a Lance usa `n`, as demais usam `id`. Ambos viram `numero` /
 * numero_externo — a chave de upsert (administradora_origem, numero_externo)
 * cuida da colisão de id entre fontes distintas.
 *
 * COMPLIANCE: campos públicos do bem + entrada_parceiro (admin) + `adm` (nome
 *   da administradora, lido a partir da fatia 0023). `ac`, `custoEfetivo`,
 *   `idParceiro`, metadados de dedup: seguem NÃO lidos aqui.
 */
function parsearEnvelope(texto: string, origem: FonteMarca): CotaFonte[] | null {
  let env: unknown;
  try {
    env = JSON.parse(texto);
  } catch {
    return null; // guarda 3: JSON inválido / formato novo
  }
  if (env == null || typeof env !== "object") return null;
  const cotasRaw = (env as Record<string, unknown>).cotas;
  if (!Array.isArray(cotasRaw) || cotasRaw.length === 0) {
    return null; // guarda 3: envelope sem array de cotas, ou vazio
  }

  const ehLance = origem === "LANCE";
  const cotas: CotaFonte[] = [];
  const vistos = new Set<number>();

  for (const item of cotasRaw) {
    if (item == null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    // cotas-extra agrega 3 marcas: filtra só a que estamos ingerindo agora.
    // (cotas/servopa são single-fonte; o filtro é inócuo lá.)
    if (!ehLance && typeof r.fonte === "string" && r.fonte !== origem) continue;

    const numero = inteiro(ehLance ? r.n : r.id);
    if (numero == null || numero <= 0) continue;
    if (vistos.has(numero)) continue; // dedupe defensivo

    const tipo = tipoDe(r.t);
    if (!tipo) continue;

    const valorCredito = inteiro(r.c);
    const valorEntrada = inteiro(r.e);
    const valorParcela = inteiro(r.p);
    const qtdParcelas = inteiro(r.x);
    if (
      valorCredito == null || valorCredito <= 0 ||
      valorEntrada == null ||
      valorParcela == null ||
      qtdParcelas == null
    ) {
      continue; // registro incompleto/ilegível => pula (nunca grava 0)
    }

    // valor cru do parceiro: só existe em ?admin=1 nas externas; nunca na Lance.
    const entradaParceiro = ehLance ? null : inteiro(r.entrada_parceiro);

    // nome da administradora, lido a partir da fatia 0023 (`adm` no envelope).
    const administradora =
      typeof r.adm === "string" && r.adm.trim() !== "" ? r.adm.trim() : null;

    vistos.add(numero);
    cotas.push({
      numero,
      tipo,
      valorCredito,
      valorEntrada,
      valorParcela,
      qtdParcelas,
      entradaParceiro,
      administradora,
      // ac / custoEfetivo / idParceiro / dedup: DESCARTADOS (compliance).
    });
  }

  // nada casou => provável mudança de formato: trata como parse inválido
  // (guarda 3), nunca como "estoque zerou".
  return cotas.length > 0 ? cotas : null;
}

/**
 * Busca + valida UMA fonte. `contagemAnterior` é a última contagem BOA daquela
 * fonte (do banco) para a guarda de queda; passe 0 se ainda não houver base.
 * Retorna sempre com `origem` para o chamador saber a qual fonte o resultado
 * (ok OU erro) pertence.
 */
export async function lerCotasFonte(
  origem: FonteMarca,
  contagemAnterior: number
): Promise<Leitura> {
  const endpoint = ENDPOINTS[origem];
  if (!endpoint) {
    // defensivo: nunca deve acontecer em uso normal (route.ts desvia
    // PLAYCONTEMPLADAS pro leitor de HTML antes de chegar aqui) — mas se
    // chegar, falha como fonte inválida em vez de montar uma URL quebrada.
    return { ok: false, origem, motivo: "sem_endpoint_json_configurado" };
  }
  const url = BASE + endpoint;

  let resp: Response;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    resp = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    // guarda 2: timeout/erro de rede
    return { ok: false, origem, motivo: "fetch_falhou: " + (e as Error).name };
  } finally {
    clearTimeout(t);
  }

  // guarda 1: HTTP
  if (resp.status !== 200) {
    return { ok: false, origem, motivo: "http_" + resp.status };
  }

  let texto: string;
  try {
    texto = await resp.text();
  } catch {
    return { ok: false, origem, motivo: "corpo_ilegivel" };
  }

  // guarda 3: parse (JSON inválido, envelope errado, vazio ou formato novo)
  const cotas = parsearEnvelope(texto, origem);
  if (!cotas) {
    return { ok: false, origem, motivo: "parse_vazio_ou_formato_novo" };
  }

  // guarda 4: sanidade de volume (anti-vazio / anti-truncamento), POR FONTE
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

// Ordem de ingestão. LANCE inclusa: passa a ser tratada uniforme (config de
// carimbo por administradora_origem existe pra todas — ver migration 0015).
//
// SERVOPA aposentada da rotação automática em 2026-07 (SYNC-SERVOPA-01):
// autópsia (ver PLANO_MESTRE §4) mostrou que a fonte não é bloqueada por
// anti-bot — o fetch upstream sempre teve sucesso — mas o RPC
// sync_aplicar_cotas estourava o timeout do gateway porque o lote 1 nunca
// commitou uma vez sequer (sempre 100% INSERT novo + trigger de preço por
// linha). Decisão de negócio: a parceria Servopa é comercial, sem
// integração técnica; o canal oficial passa a ser o importador do /admin,
// não o sync automático. FonteMarca, ENDPOINTS.SERVOPA e o parsing em
// parsearEnvelope() ficam intactos/dormentes — reversível com uma linha se
// a parceria voltar a ser técnica.
//
// PLAYCONTEMPLADAS entra DIRETO na rotação (PLAYCONTEMPLADAS-01, 2026-07):
// diferente da SERVOPA, o problema que a aposentou (timeout de lote único)
// já foi resolvido antes desta fonte existir — app/api/sync-cotas/route.ts
// aplica em lotes de 100 (fatia 0027) desde então. Fonte lida via HTML
// (lib/playcontempladas-source.ts), não pelo lerCotasFonte/ENDPOINTS
// genérico daqui (que é JSON-only) — ver escolha de leitor por origem no
// próprio route.ts.
export const FONTES: FonteMarca[] = [
  "LANCE",
  "CBC",
  "PIFFER",
  "CARTAS",
  "PLAYCONTEMPLADAS",
];
