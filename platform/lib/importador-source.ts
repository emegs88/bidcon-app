// ============================================================================
// Parser tolerante do importador (FATIA F1) — CSV/texto colado.
// ----------------------------------------------------------------------------
// Arquivo NOVO, não importa de ancora-source.ts nem cotas-source.ts: decisão
// intencional de desacoplar do sync legado (F1 existe pra aposentar aquele
// caminho, não pra herdar dependência dele). Mesmo espírito das duas libs
// (mapeamento de cabeçalho tolerante a várias grafias, parse PT-BR de número,
// nunca lança exceção — linha problemática fica marcada e segue no array;
// quem decide bloquear é a rota de preview/publish, não este parser).
//
// SEM dependência externa (decisão do usuário): o parser inicial de XLSX via
// lib `xlsx`/SheetJS foi descartado — o pacote no npm está travado na 0.18.5,
// com 2 vulnerabilidades HIGH sem fix disponível ali (as versões corrigidas só
// existem no CDN próprio da SheetJS, fora do npm). O ponto decisivo: quem FAZ
// upload aqui é a equipe (allowlist), mas quem FABRICA o arquivo é o
// fornecedor — um terceiro externo — e as vulnerabilidades são exploráveis
// via arquivo malicioso. Então v1 aceita só CSV/texto colado (parser RFC4180
// simples, escrito à mão); XLSX nativo fica pra uma fatia futura opcional
// (F1.1, com `exceljs` ou equivalente) se o uso real mostrar fricção.
// Limitação aceita: não suporta campo entre aspas com quebra de linha
// embutida (multi-linha) — não esperado nas colunas numéricas deste formato.
//
// `tipo` só aceita os dois valores do enum `tipo_bem` no banco (imovel |
// veiculo, confirmado via MCP) — qualquer outra coisa vira null e cai em
// `problemas` na validação, nunca é gravado cru.
// ============================================================================

export type LinhaImportada = {
  tipo: "imovel" | "veiculo" | null;
  credito: number | null;
  entrada: number | null;
  parcela: number | null;
  parcelas: number | null;
  adm: string | null;
  numero_externo: number | null;
  problemas: string[];
};

export type LeituraImportador = {
  linhas: LinhaImportada[];
  avisos: string[];
};

type CampoLinha = keyof Omit<LinhaImportada, "problemas">;

/**
 * Converte número PT-BR ("24.140,00") OU number cru em number. null se
 * ilegível. Heurística: presença de vírgula => separador decimal PT-BR
 * (pontos são milhar); senão trata como já normalizado ("1234.56" ou "1234").
 */
function parseNumeroPtBr(bruto: unknown): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto !== "string") return null;
  const s = bruto.trim();
  if (s === "") return null;
  const normalizado = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function parseInteiro(bruto: unknown): number | null {
  const n = parseNumeroPtBr(bruto);
  return n == null ? null : Math.trunc(n);
}

function texto(bruto: unknown): string | null {
  if (typeof bruto === "number") return String(bruto);
  if (typeof bruto !== "string") return null;
  const t = bruto.trim();
  return t === "" ? null : t;
}

/** Só aceita os dois valores do enum tipo_bem; qualquer outra grafia => null. */
function tipoDe(bruto: unknown): "imovel" | "veiculo" | null {
  const t = texto(bruto);
  if (!t) return null;
  const c = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (c === "veiculo" || c === "auto" || c === "automovel") return "veiculo";
  if (c === "imovel") return "imovel";
  return null;
}

// Mapeamento de cabeçalho tolerante: cada campo lógico aceita várias grafias
// comuns (o cabeçalho é normalizado — minúsculas, sem acento — antes de comparar).
const CAMPOS: Record<CampoLinha, string[]> = {
  tipo: ["tipo", "segmento", "bem", "tipo_bem"],
  credito: ["credito", "valor_credito", "valorcredito", "c"],
  entrada: ["entrada", "valor_entrada", "valorentrada", "e"],
  parcela: ["parcela", "valor_parcela", "valorparcela", "p"],
  parcelas: ["parcelas", "qtd_parcelas", "qtdparcelas", "prazo", "x"],
  adm: ["adm", "administradora", "adm_nome"],
  numero_externo: ["numero_externo", "numeroexterno", "ref", "numero", "n", "id"],
};

function normalizarCabecalho(h: unknown): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/** Índice campo-lógico -> posição de coluna, a partir da linha de cabeçalho. */
function indexarCabecalho(cabecalho: unknown[]): Partial<Record<CampoLinha, number>> {
  const normalizados = cabecalho.map(normalizarCabecalho);
  const indice: Partial<Record<CampoLinha, number>> = {};
  for (const campo of Object.keys(CAMPOS) as CampoLinha[]) {
    const pos = normalizados.findIndex((h) => CAMPOS[campo].includes(h));
    if (pos >= 0) indice[campo] = pos;
  }
  return indice;
}

function validarLinha(l: Omit<LinhaImportada, "problemas">): string[] {
  const problemas: string[] = [];
  if (!l.tipo) problemas.push("tipo ausente ou não reconhecido");
  if (l.credito == null || l.credito <= 0) problemas.push("crédito ausente ou inválido");
  if (l.entrada == null) problemas.push("entrada ausente");
  if (l.parcela == null) problemas.push("parcela ausente");
  if (l.parcelas == null || l.parcelas <= 0) problemas.push("qtd. de parcelas ausente ou inválida");
  if (l.entrada != null && l.credito != null && l.entrada >= l.credito) {
    problemas.push("entrada maior ou igual ao crédito");
  }
  if (!l.adm) problemas.push("administradora ausente");
  return problemas;
}

function montarLinha(
  linhaBruta: unknown[],
  indice: Partial<Record<CampoLinha, number>>
): LinhaImportada {
  const get = (campo: CampoLinha) => {
    const pos = indice[campo];
    return pos == null ? undefined : linhaBruta[pos];
  };
  const base = {
    tipo: tipoDe(get("tipo")),
    credito: parseNumeroPtBr(get("credito")),
    entrada: parseNumeroPtBr(get("entrada")),
    parcela: parseNumeroPtBr(get("parcela")),
    parcelas: parseInteiro(get("parcelas")),
    adm: texto(get("adm")),
    numero_externo: parseInteiro(get("numero_externo")),
  };
  return { ...base, problemas: validarLinha(base) };
}

/** Descarta linhas totalmente vazias (todas as células em branco). */
function linhaVazia(linhaBruta: unknown[]): boolean {
  return linhaBruta.every((c) => c == null || String(c).trim() === "");
}

/**
 * Revalida uma linha vinda de fora já com campos nomeados (ex.: JSON do
 * client no /api/admin/importar/publicar, ecoando o que o preview devolveu).
 * Roda os MESMOS parsers/validações do parser de arquivo — usada pra NUNCA
 * confiar em campos/categoria vindos do client: o publish reconstrói tudo a
 * partir dos valores brutos e decide de novo.
 */
export function revalidarLinha(input: Record<string, unknown>): LinhaImportada {
  const base = {
    tipo: tipoDe(input.tipo),
    credito: parseNumeroPtBr(input.credito),
    entrada: parseNumeroPtBr(input.entrada),
    parcela: parseNumeroPtBr(input.parcela),
    parcelas: parseInteiro(input.parcelas),
    adm: texto(input.adm),
    numero_externo: parseInteiro(input.numero_externo),
  };
  return { ...base, problemas: validarLinha(base) };
}

function avisosDeColunasFaltando(indice: Partial<Record<CampoLinha, number>>): string[] {
  const faltando = (Object.keys(CAMPOS) as CampoLinha[]).filter((c) => indice[c] == null);
  return faltando.length > 0 ? [`colunas não reconhecidas no cabeçalho: ${faltando.join(", ")}`] : [];
}

/**
 * Divide UMA linha de CSV/TSV em campos, respeitando aspas (RFC4180-lite):
 * campo entre aspas pode conter o separador; `""` dentro de aspas vira `"`
 * literal. NÃO suporta quebra de linha embutida dentro de um campo — ver
 * limitação documentada no cabeçalho do arquivo.
 */
function dividirLinha(linha: string, separador: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (dentroAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          dentroAspas = false;
        }
      } else {
        atual += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === separador) {
      campos.push(atual.trim());
      atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual.trim());
  return campos;
}

/** Escolhe o separador pela 1ª linha: tab se houver, senão ';' se predominar sobre ',', senão ','. */
function detectarSeparador(primeiraLinha: string): string {
  if (primeiraLinha.includes("\t")) return "\t";
  const virgulas = (primeiraLinha.match(/,/g) ?? []).length;
  const pontoVirgulas = (primeiraLinha.match(/;/g) ?? []).length;
  return pontoVirgulas > virgulas ? ";" : ",";
}

/** Núcleo comum: texto bruto -> matriz de campos, ou null se não houver linhas de dados suficientes. */
function paraMatriz(textoBruto: string): string[][] | null {
  const linhasBrutas = textoBruto.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (linhasBrutas.length < 2) return null;
  const separador = detectarSeparador(linhasBrutas[0]);
  return linhasBrutas.map((l) => dividirLinha(l, separador));
}

function processarMatriz(matriz: string[][]): LeituraImportador {
  const [cabecalho, ...corpo] = matriz;
  const indice = indexarCabecalho(cabecalho);
  const linhas = corpo.filter((l) => !linhaVazia(l)).map((l) => montarLinha(l, indice));
  return { linhas, avisos: avisosDeColunasFaltando(indice) };
}

/**
 * Parseia um arquivo CSV (ArrayBuffer, UTF-8) — decodifica o buffer como
 * texto (BOM UTF-8, se houver, é removido automaticamente pelo TextDecoder)
 * e reaproveita o mesmo parser de `parsearTextoColado`. Nunca lança: arquivo
 * ilegível vira `{linhas: [], avisos: [motivo]}`. Só CSV nesta fatia — ver
 * nota sobre XLSX no cabeçalho do arquivo.
 */
export function parsearArquivoImportacao(
  buffer: ArrayBuffer,
  nomeArquivo: string
): LeituraImportador {
  let textoBruto: string;
  try {
    textoBruto = new TextDecoder("utf-8").decode(buffer);
  } catch {
    return { linhas: [], avisos: [`arquivo ilegível (esperado CSV em UTF-8): ${nomeArquivo}`] };
  }
  const matriz = paraMatriz(textoBruto);
  if (!matriz) return { linhas: [], avisos: ["arquivo vazio ou sem linhas de dados"] };
  return processarMatriz(matriz);
}

/**
 * Parseia texto colado (separador detectado pela 1ª linha: tab se houver
 * — colar direto do Excel/Sheets normalmente vem como TSV —, senão ';' ou
 * ',' pela predominância). Parser próprio, sem dependência externa.
 */
export function parsearTextoColado(textoColado: string): LeituraImportador {
  if (typeof textoColado !== "string" || textoColado.trim() === "") {
    return { linhas: [], avisos: ["texto vazio"] };
  }
  const matriz = paraMatriz(textoColado);
  if (!matriz) return { linhas: [], avisos: ["texto sem linhas de dados suficientes"] };
  return processarMatriz(matriz);
}
