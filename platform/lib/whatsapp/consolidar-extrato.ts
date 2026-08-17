// ============================================================================
// Consolidação de fragmentos de extrato. EXTRATO-ANALISE-01, Entrega 1.
// ----------------------------------------------------------------------------
// O PROBLEMA, MEDIDO CONTRA OS 15 ANEXOS REAIS DE 20/07 A 10/08/2026.
// O cedente fotografa o extrato página por página. Cada foto vira uma leitura
// separada em `extratos_cotas`, e cada leitura enxerga só o pedaço que estava
// naquela página. Medido na conversa 0d9d74d9, rajada das 16:43:
//
//   msg 225 -> administradora, parcela 3.234,60, pagas 17, restantes 82
//   msg 226 -> administradora, contemplada=false
//   msg 227 -> administradora, grupo 000800, cota 519-0, crédito 260.650
//
// Os fragmentos são COMPLEMENTARES, não redundantes. Nenhum dos três, sozinho,
// permite calcular TIR nenhum: falta crédito em dois e falta parcela no outro.
// Sem consolidar, a tela mostra três leituras pobres e zero cotas analisáveis.
//
// POR QUE NÃO SE AGRUPA POR CONVERSA. A ordem original mandava juntar "todos os
// anexos da mesma conversa numa análise só". Medido: a MESMA conversa 0d9d74d9
// contém DUAS cotas distintas, separadas por 153,1 s —
//   rajada 1 (16:43:09-10): grupo 000800, cota 519-0, crédito 260.650,00
//   rajada 2 (16:45:43-44): grupo 003093, cota 90-0,  crédito 297.645,51
// Fundir a conversa produziria uma quimera com TODOS os campos preenchidos —
// crédito de uma cota, parcela da outra — e portanto um preço com aparência
// perfeita para uma cota que não existe.
//
// POR QUE A RAJADA AGRUPA E O CONFLITO APENAS AUDITA. Dentro de cada rajada não
// existe conflito algum: só a msg 227 tem grupo, só a 235 tem grupo. O conflito
// DETECTA que há duas cotas, mas não sabe DIVIDIR — nada no conteúdo da msg 225
// diz que a parcela de 3.234,60 pertence ao grupo 000800. A única coisa que liga
// a 225 à 227 é o tempo. Então: a rajada agrupa; o conflito é a auditoria que
// recusa a fusão quando o agrupamento por tempo errou.
//
// A JANELA DE 30 s, E POR QUE ESSE NÚMERO. Distribuição completa dos 15 anexos:
//   intervalos INTERNOS (dentro de uma cota): 0,19 0,23 0,45 0,77 3,10 4,59 s
//   intervalos SEPARADORES:                   153,11  421,62  2.325,90 s
// Máximo interno 4,59 s; mínimo separador 153,11 s; vazio limpo entre os dois.
// 30 s fica 6,5x acima do maior interno e 5,1x abaixo do menor separador. A base
// é fina (3 rajadas) — por isso a auditoria por identificador não é opcional.
//
// NADA AQUI TOCA REDE, BANCO OU MODELO. Funções puras sobre linhas já lidas.
// A aritmética de dinheiro não mora aqui: vive em lib/farol/precificar-cota.ts.
// ============================================================================

/** Uma leitura de `extratos_cotas`, do jeito que a tabela guarda. */
export type FragmentoExtrato = {
  mensagem_id: number;
  conversa_id: string;
  /** ISO-8601. É o `criado_em` de `wa_mensagens` — quando o anexo CHEGOU. */
  criado_em: string;
  administradora: string | null;
  grupo: string | null;
  cota: string | null;
  valor_credito: number | null;
  saldo_devedor: number | null;
  parcelas_pagas: number | null;
  parcelas_restantes: number | null;
  valor_parcela: number | null;
  contemplada: boolean | null;
  /** 0..1. `extratos_cotas` guarda UMA confiança por leitura, não por campo. */
  confianca: number | null;
};

/** Janela que separa duas rajadas, em segundos. Ver cabeçalho. */
export const JANELA_RAJADA_S = 30;

/** Abaixo disto a tela pinta o campo em âmbar. Vem da ordem. */
export const CONFIANCA_BAIXA = 0.7;

/** Um campo consolidado carrega de ONDE veio — sem procedência não há correção. */
export type CampoConsolidado<T> = {
  valor: T | null;
  /** mensagem_id que forneceu o valor escolhido. */
  origem: number | null;
  /** Confiança da leitura de origem, não do campo: a tabela não tem por campo. */
  confianca: number | null;
  /** Outros valores não-nulos vistos para o mesmo campo, se houve. */
  divergencias: Array<{ mensagem_id: number; valor: T; confianca: number | null }>;
};

export type CamposCota = {
  administradora: CampoConsolidado<string>;
  grupo: CampoConsolidado<string>;
  cota: CampoConsolidado<string>;
  valor_credito: CampoConsolidado<number>;
  saldo_devedor: CampoConsolidado<number>;
  parcelas_pagas: CampoConsolidado<number>;
  parcelas_restantes: CampoConsolidado<number>;
  valor_parcela: CampoConsolidado<number>;
  contemplada: CampoConsolidado<boolean>;
};

/** Chaves de `CamposCota`, para percorrer sem `any`. */
export const CAMPOS: Array<keyof CamposCota> = [
  "administradora",
  "grupo",
  "cota",
  "valor_credito",
  "saldo_devedor",
  "parcelas_pagas",
  "parcelas_restantes",
  "valor_parcela",
  "contemplada",
];

/** Rótulo humano do campo — usado na tela e na pergunta pronta ao cedente. */
export const ROTULO_CAMPO: Record<keyof CamposCota, string> = {
  administradora: "administradora",
  grupo: "grupo",
  cota: "cota",
  valor_credito: "valor do crédito",
  saldo_devedor: "saldo devedor",
  parcelas_pagas: "parcelas pagas",
  parcelas_restantes: "parcelas restantes",
  valor_parcela: "valor da parcela",
  contemplada: "se a cota está contemplada",
};

/**
 * Os três campos sem os quais NÃO existe custo ao mês.
 * `saldo_devedor` fica de fora de propósito: ele não entra no cálculo — entra
 * na conferência de coerência (ver `coerenciaDe`). Quem manda no fluxo é
 * `valor_parcela x parcelas_restantes` contra `valor_credito`.
 */
export const CAMPOS_PARA_TIR: Array<keyof CamposCota> = [
  "valor_credito",
  "valor_parcela",
  "parcelas_restantes",
];

export type Coerencia = {
  /** saldo_devedor / valor_parcela — quantas parcelas o saldo representa. */
  parcelas_implicitas: number;
  /** O que o extrato declara. */
  parcelas_declaradas: number;
  /** Desvio relativo, 0..1. */
  desvio: number;
  ok: boolean;
};

export type AnaliseCota = {
  conversa_id: string;
  /** mensagem_ids da rajada, em ordem de chegada. */
  fragmentos: number[];
  inicio: string;
  fim: string;
  campos: CamposCota;
  /** Campos de `CAMPOS_PARA_TIR` que continuam nulos depois de consolidar. */
  faltantes: Array<keyof CamposCota>;
  /**
   * `conflito` = a rajada juntou coisas que não são a mesma cota (identificador
   * batendo de frente). É recusa, não aviso: nada é fundido.
   * `divergente` = os identificadores fecham, mas algum número apareceu com dois
   * valores. Fundido, porém marcado — humano decide antes de precificar.
   * `incompleta` = falta campo para o cálculo.
   */
  status: "completa" | "incompleta" | "divergente" | "conflito";
  /** Preenchido só quando status === "conflito". Texto para a tela. */
  motivo_conflito: string | null;
  /** Menor confiança entre as leituras da rajada — a corrente arrebenta no elo fraco. */
  confianca_minima: number | null;
  coerencia: Coerencia | null;
};

// ----- normalização ---------------------------------------------------------

/**
 * Forma canônica de um identificador (grupo/cota) SÓ PARA COMPARAÇÃO.
 * O valor exibido continua sendo o original — isto aqui nunca vai à tela.
 *
 * Maiúsculas, fora tudo que não for A-Z0-9, e zeros à esquerda removidos.
 * O motivo dos zeros: duas fotos do mesmo documento saem como "000800" e "800"
 * conforme o recorte, e tratar isso como conflito partiria uma cota inteira.
 * O motivo de não afrouxar mais que isso: um falso conflito custa uma tela com
 * duas análises (que um humano remenda), enquanto um conflito NÃO detectado
 * custa uma quimera precificada. Erra-se para o lado barato.
 */
export function normalizarIdentificador(v: string | null | undefined): string | null {
  const bruto = (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!bruto) return null;
  const semZeros = bruto.replace(/^0+/, "");
  return semZeros || "0";
}

function ehVazio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return !Number.isFinite(v);
  return false;
}

function conf(f: FragmentoExtrato): number {
  // Leitura sem confiança registrada vale menos que qualquer leitura com ela.
  return typeof f.confianca === "number" && Number.isFinite(f.confianca) ? f.confianca : -1;
}

// ----- rajadas --------------------------------------------------------------

/**
 * Corta uma lista de fragmentos em rajadas pela janela de tempo.
 * Ordena por chegada; corta quando o intervalo passa de `JANELA_RAJADA_S`.
 * Fragmentos de conversas diferentes NUNCA caem na mesma rajada, mesmo que
 * cheguem no mesmo segundo — conversa é cedente, e cedente não se mistura.
 */
export function agruparEmRajadas(
  fragmentos: FragmentoExtrato[],
  janelaSegundos: number = JANELA_RAJADA_S,
): FragmentoExtrato[][] {
  const ordenados = [...fragmentos].sort((a, b) => {
    if (a.conversa_id !== b.conversa_id) return a.conversa_id < b.conversa_id ? -1 : 1;
    const ta = Date.parse(a.criado_em);
    const tb = Date.parse(b.criado_em);
    if (ta !== tb) return ta - tb;
    return a.mensagem_id - b.mensagem_id;
  });

  const rajadas: FragmentoExtrato[][] = [];
  let atual: FragmentoExtrato[] = [];

  for (const f of ordenados) {
    if (atual.length === 0) {
      atual = [f];
      continue;
    }
    const anterior = atual[atual.length - 1];
    const mesmaConversa = anterior.conversa_id === f.conversa_id;
    const dt = (Date.parse(f.criado_em) - Date.parse(anterior.criado_em)) / 1000;
    // Data ilegível não vira fusão: na dúvida, corta.
    const dentro = Number.isFinite(dt) && dt <= janelaSegundos;
    if (mesmaConversa && dentro) {
      atual.push(f);
    } else {
      rajadas.push(atual);
      atual = [f];
    }
  }
  if (atual.length > 0) rajadas.push(atual);

  return rajadas;
}

// ----- consolidação ---------------------------------------------------------

function consolidarCampo<T>(
  fragmentos: FragmentoExtrato[],
  ler: (f: FragmentoExtrato) => T | null,
  mesmoValor: (a: T, b: T) => boolean,
): CampoConsolidado<T> {
  const vistos: Array<{ mensagem_id: number; valor: T; confianca: number | null }> = [];
  for (const f of fragmentos) {
    const v = ler(f);
    if (ehVazio(v)) continue;
    vistos.push({ mensagem_id: f.mensagem_id, valor: v as T, confianca: f.confianca });
  }
  if (vistos.length === 0) {
    return { valor: null, origem: null, confianca: null, divergencias: [] };
  }

  // Vence a maior confiança; empate resolve pela chegada (ordem já é a de chegada).
  let escolhido = vistos[0];
  for (const v of vistos) {
    const c = typeof v.confianca === "number" ? v.confianca : -1;
    const ce = typeof escolhido.confianca === "number" ? escolhido.confianca : -1;
    if (c > ce) escolhido = v;
  }

  const divergencias = vistos.filter(
    (v) => v.mensagem_id !== escolhido.mensagem_id && !mesmoValor(v.valor, escolhido.valor),
  );

  return {
    valor: escolhido.valor,
    origem: escolhido.mensagem_id,
    confianca: escolhido.confianca,
    divergencias,
  };
}

const igualTexto = (a: string, b: string) => a.trim() === b.trim();
const igualIdent = (a: string, b: string) =>
  normalizarIdentificador(a) === normalizarIdentificador(b);
// Centavos: diferença abaixo de meio centavo é a mesma quantia.
const igualNumero = (a: number, b: number) => Math.abs(a - b) < 0.005;
const igualBool = (a: boolean, b: boolean) => a === b;

/**
 * Conflito de identidade dentro da rajada: dois fragmentos afirmam grupos (ou
 * cotas) diferentes. Devolve o texto do motivo, ou null quando não há conflito.
 */
export function conflitoDeIdentidade(fragmentos: FragmentoExtrato[]): string | null {
  const partes: string[] = [];
  for (const chave of ["grupo", "cota"] as const) {
    const mapa = new Map<string, number[]>();
    for (const f of fragmentos) {
      const norm = normalizarIdentificador(f[chave]);
      if (!norm) continue;
      const lista = mapa.get(norm) ?? [];
      lista.push(f.mensagem_id);
      mapa.set(norm, lista);
    }
    if (mapa.size > 1) {
      const descricao = [...mapa.entries()]
        .map(([valor, msgs]) => `${valor} (msg ${msgs.join(", ")})`)
        .join(" contra ");
      partes.push(`${chave}: ${descricao}`);
    }
  }
  if (partes.length === 0) return null;
  return `Fragmentos da mesma rajada apontam cotas diferentes — ${partes.join("; ")}. Nada foi fundido.`;
}

/**
 * Conferência interna de graça: `saldo_devedor / valor_parcela` deve bater com
 * `parcelas_restantes`. Medido na msg 27 (a única leitura completa da base):
 * 93.147 / 854,67 = 108,99 contra 109 declaradas — desvio de 0,01%.
 * Não é regra de negócio, é termômetro da leitura. Tolerância de 5% porque o
 * saldo do extrato costuma trazer taxa de administração de meio período.
 */
export function coerenciaDe(campos: CamposCota, tolerancia = 0.05): Coerencia | null {
  const saldo = campos.saldo_devedor.valor;
  const parcela = campos.valor_parcela.valor;
  const restantes = campos.parcelas_restantes.valor;
  if (saldo === null || parcela === null || restantes === null) return null;
  if (!(parcela > 0) || !(restantes > 0)) return null;

  const implicitas = saldo / parcela;
  const desvio = Math.abs(implicitas - restantes) / restantes;
  return {
    parcelas_implicitas: implicitas,
    parcelas_declaradas: restantes,
    desvio,
    ok: desvio <= tolerancia,
  };
}

/**
 * Funde os fragmentos de UMA rajada numa análise.
 * Em conflito de identidade a fusão é recusada: os campos voltam vazios e o
 * status é `conflito`. Devolver a quimera "com um avisinho" seria oferecer à
 * tela exatamente o número que não deve existir.
 */
export function consolidarRajada(fragmentos: FragmentoExtrato[]): AnaliseCota {
  if (fragmentos.length === 0) {
    throw new Error("consolidarRajada: rajada vazia");
  }
  const emOrdem = [...fragmentos].sort(
    (a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em) || a.mensagem_id - b.mensagem_id,
  );

  const vazio = <T>(): CampoConsolidado<T> => ({
    valor: null,
    origem: null,
    confianca: null,
    divergencias: [],
  });

  const conflito = conflitoDeIdentidade(emOrdem);

  const campos: CamposCota = conflito
    ? {
        administradora: vazio<string>(),
        grupo: vazio<string>(),
        cota: vazio<string>(),
        valor_credito: vazio<number>(),
        saldo_devedor: vazio<number>(),
        parcelas_pagas: vazio<number>(),
        parcelas_restantes: vazio<number>(),
        valor_parcela: vazio<number>(),
        contemplada: vazio<boolean>(),
      }
    : {
        administradora: consolidarCampo(emOrdem, (f) => f.administradora, igualTexto),
        grupo: consolidarCampo(emOrdem, (f) => f.grupo, igualIdent),
        cota: consolidarCampo(emOrdem, (f) => f.cota, igualIdent),
        valor_credito: consolidarCampo(emOrdem, (f) => f.valor_credito, igualNumero),
        saldo_devedor: consolidarCampo(emOrdem, (f) => f.saldo_devedor, igualNumero),
        parcelas_pagas: consolidarCampo(emOrdem, (f) => f.parcelas_pagas, igualNumero),
        parcelas_restantes: consolidarCampo(emOrdem, (f) => f.parcelas_restantes, igualNumero),
        valor_parcela: consolidarCampo(emOrdem, (f) => f.valor_parcela, igualNumero),
        contemplada: consolidarCampo(emOrdem, (f) => f.contemplada, igualBool),
      };

  const faltantes = CAMPOS_PARA_TIR.filter((c) => campos[c].valor === null);

  // Divergência só pesa nos campos que viram dinheiro. Duas grafias de
  // administradora não podem bloquear um preço.
  const temDivergenciaRelevante = ([...CAMPOS_PARA_TIR, "saldo_devedor"] as Array<
    keyof CamposCota
  >).some((c) => campos[c].divergencias.length > 0);

  const confiancas = emOrdem
    .map((f) => f.confianca)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));

  let status: AnaliseCota["status"];
  if (conflito) status = "conflito";
  else if (faltantes.length > 0) status = "incompleta";
  else if (temDivergenciaRelevante) status = "divergente";
  else status = "completa";

  return {
    conversa_id: emOrdem[0].conversa_id,
    fragmentos: emOrdem.map((f) => f.mensagem_id),
    inicio: emOrdem[0].criado_em,
    fim: emOrdem[emOrdem.length - 1].criado_em,
    campos,
    faltantes,
    status,
    motivo_conflito: conflito,
    confianca_minima: confiancas.length > 0 ? Math.min(...confiancas) : null,
    coerencia: coerenciaDe(campos),
  };
}

/** Atalho: de fragmentos crus a análises, uma por rajada. */
export function consolidarExtratos(
  fragmentos: FragmentoExtrato[],
  janelaSegundos: number = JANELA_RAJADA_S,
): AnaliseCota[] {
  return agruparEmRajadas(fragmentos, janelaSegundos).map(consolidarRajada);
}

// ----- pendência ------------------------------------------------------------

/**
 * A pergunta pronta para o operador mandar ao cedente quando falta campo.
 * Devolve null quando não falta nada.
 *
 * Restrições de linguagem da casa: nada de prometer prazo, nada de sugerir
 * contemplação, nada do léxico vedado (investimento/rendimento/retorno). O texto
 * pede documento, não vende nada.
 */
export function perguntaPendencia(faltantes: Array<keyof CamposCota>): string | null {
  if (faltantes.length === 0) return null;
  const nomes = faltantes.map((f) => ROTULO_CAMPO[f]);
  const lista =
    nomes.length === 1
      ? nomes[0]
      : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return (
    `Consegui ler parte do seu extrato, mas ficou faltando ${lista}. ` +
    `Pode me mandar a página do extrato onde aparece esse dado? ` +
    `Com ele eu finalizo a análise da sua carta de crédito.`
  );
}

/**
 * Uma linha de resumo, montada SÓ com os campos já extraídos.
 * Não relê documento e não inventa: campo nulo simplesmente não entra na frase.
 * Existe para a tela ter um texto determinístico quando o resumo por IA estiver
 * indisponível — e para os testes terem contra o que comparar.
 */
export function resumoDeterministico(campos: CamposCota): string {
  const p: string[] = [];
  const adm = campos.administradora.valor;
  const contempl = campos.contemplada.valor;

  if (contempl === true) p.push(adm ? `Cota contemplada da ${adm}` : "Cota contemplada");
  else if (contempl === false) p.push(adm ? `Cota não contemplada da ${adm}` : "Cota não contemplada");
  else p.push(adm ? `Cota da ${adm}` : "Cota");

  if (campos.grupo.valor) p.push(`grupo ${campos.grupo.valor}`);
  if (campos.cota.valor) p.push(`cota ${campos.cota.valor}`);
  if (campos.valor_credito.valor !== null) p.push(`crédito de ${brl(campos.valor_credito.valor)}`);
  if (campos.saldo_devedor.valor !== null) p.push(`saldo de ${brl(campos.saldo_devedor.valor)}`);
  if (campos.parcelas_restantes.valor !== null && campos.valor_parcela.valor !== null) {
    p.push(
      `${campos.parcelas_restantes.valor} parcelas restantes de ${brl(campos.valor_parcela.valor)}`,
    );
  } else if (campos.parcelas_restantes.valor !== null) {
    p.push(`${campos.parcelas_restantes.valor} parcelas restantes`);
  }

  return `${p.join(", ")}.`;
}

function brl(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
