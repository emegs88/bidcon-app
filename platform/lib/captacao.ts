// ============================================================================
// captacao.ts — o lado do CEDENTE (quem vende a carta), lógica pura
// ----------------------------------------------------------------------------
// CAPTACAO-OFERTA-01 F2. A tabela `captacoes` nasceu na migration 0088 e até
// hoje tem ZERO linhas porque NINGUÉM ESCREVE NELA: o formulário de
// /vender-consorcio-contemplado abria o WhatsApp e não persistia nada — nem o
// consentimento, que era coletado e jogado fora. Este módulo é a metade
// testável do conserto; a outra metade é app/api/captacao/route.ts.
//
// POR QUE A LÓGICA MORA AQUI E NÃO DENTRO DA ROTA. Rota não entra na suíte
// (scripts/testes.mjs só varre `lib/`), e as três regras abaixo são
// exatamente as que quebram em silêncio:
//   1. a normalização de tipo de bem (a armadilha declarada na 0088);
//   2. a conta da faixa sobre o CRÉDITO LÍQUIDO (pedra 1 do Emerson);
//   3. a chave de idempotência (sem ela, cada re-envio vira lead novo).
//
// A ARMADILHA DA 0088, LITERAL. O <select> da página emite `Imóvel` e
// `Veículo` — acentuados e capitalizados. O check `captacoes_tipo_bem_sano`
// aceita SOMENTE `imovel` e `veiculo`. A 0088 escolheu de propósito rejeitar
// ruidosamente em vez de deixar duas grafias conviverem, e escreveu que
// normalizar é obrigação de quem ingere. `normalizarTipoBem` é essa obrigação
// sendo cumprida — e o teste dela usa os literais do <select> como fixture,
// não strings inventadas.
//
// AS CINCO PEDRAS (palavra do Emerson, 29/08/2026) e onde cada uma vive:
//   1. valores sempre sobre o crédito líquido ao cessionário  -> creditoLiquido()
//   2. custo da Conta Notarial dentro de qualquer conta       -> tarifaNotarial()
//   3. TIR canônica se aparecer taxa; nunca % nominal         -> ver AVISO abaixo
//   4. léxico (nada de investimento/rendimento/CDI/lucro)     -> travado por teste
//   5. pagamento só por Conta Notarial                        -> travado por teste
//
// PEDRA 2 — CORREÇÃO DE 29/08/2026. ESTE BLOCO JÁ ESTEVE ERRADO.
//
// A primeira versão deste arquivo afirmava que "o custo da Conta Notarial NÃO
// TEM VALOR EM LUGAR NENHUM" e, por causa disso, desenhava o simulador para
// nunca exibir uma conta fechada. A medição que sustentava a frase era
// verdadeira NO REPO (`grep` por custo/emolumento em `platform/` devolvia
// zero) — e mesmo assim a conclusão era falsa, porque o número existe fora do
// repo. O Emerson trouxe a fonte: INFORME NOTARIAL Nº 09/2026, do Colégio
// Notarial do Brasil – Conselho Federal, "Conta Notarial - Nova Precificação".
//
// A lição, para não repetir: "não achei no repositório" NÃO É "não existe".
// Ausência de medição e medição de ausência continuam sendo coisas
// diferentes — a mesma armadilha da Regra 19, agora do lado de fora do banco.
//
// O QUE O INFORME DIZ, e que vira `TABELA_NOTARIAL` abaixo: a tarifa da conta
// notarial sem rentabilidade passa a ser estruturada POR FAIXA DE VALOR DA
// OPERAÇÃO. Abaixo de R$ 100.000,00 é um valor FIXO (R$ 500,00); daí para
// cima é PERCENTUAL SOBRE O DEPÓSITO, caindo de 0,45% a 0,13%.
//
// O QUE O INFORME **NÃO** DIZ, e que este módulo por isso NÃO INVENTA:
//   (a) QUEM ARCA com a tarifa (comprador, cedente ou rateio) — decisão
//       comercial do Emerson, registrada como pergunta aberta;
//   (b) se a tarifa entra ou não na conta do CEDENTE. Enquanto (a) não tem
//       resposta, `faixaProposta` continua devolvendo a faixa BRUTA e a
//       página exibe a tarifa como LINHA SEPARADA e nomeada. Abater do
//       cedente um custo que talvez seja do comprador seria trocar a omissão
//       antiga por um erro pior: um número errado com cara de exato.
//
// DUAS AMBIGUIDADES DO PRÓPRIO DOCUMENTO, registradas em vez de silenciadas:
//   - o título diz "a partir de março" e o corpo diz "a partir do mês de
//     abril". `NOTARIAL_VIGENCIA` guarda a divergência por escrito.
//   - a FAIXA 2 vem impressa "0.45%" (ponto) enquanto as demais usam vírgula.
//     Lido como 0,45%, coerente com a curva decrescente das outras dez.
//
// OS 59% NÃO SÃO CUSTO ADICIONAL. O informe diz que "a remuneração do
// tabelião de notas corresponderá a 59% do resultado da multiplicação do
// valor do depósito pela percentagem da tarifária" — isto é, 59% DA TARIFA,
// repartição interna entre cartório/banco/CNB-CF. Somar isso ao que o usuário
// paga inflaria a conta em 59%. Fica em `PARTE_TABELIAO`, documentado e NÃO
// somado, para que ninguém "conserte" isso mais tarde por engano.
//
// AVISO SOBRE A PEDRA 3. Este módulo continua sem calcular NENHUMA taxa: não
// há juros, não há custo ao mês, não há TIR. A pedra 3 é condicional ("se
// aparecer taxa") e segue satisfeita por ausência. Atenção ao que a tarifa
// notarial É e ao que ela NÃO É: um percentual DO DEPÓSITO é proporção de um
// valor, não taxa no tempo — por isso não dispara a exigência de TIR. Quem
// acrescentar aqui qualquer coisa por PERÍODO tem de trazer TIR canônica.
// ============================================================================

/** Piso da faixa de proposta ao cedente: 15% do crédito líquido. */
export const PROPOSTA_MIN = 0.15;

/** Teto da faixa de proposta ao cedente: 20% do crédito líquido. */
export const PROPOSTA_MAX = 0.2;

/**
 * Texto obrigatório da faixa, palavra por palavra (despacho de 28/08/2026).
 * Exportado para que o teste de acoplamento compare o HTML da página com ESTA
 * constante — cópia literal envelhecida passa no tsc e passa em teste de
 * conteúdo; só o teste de acoplamento pega.
 */
export const TEXTO_FAIXA =
  "Proposta típica entre 15% e 20% do valor do crédito, conforme análise da cota.";

/** Texto obrigatório da Conta Notarial, palavra por palavra (mesmo despacho). */
export const TEXTO_NOTARIAL =
  "Pagamento 100% protegido pela Conta Notarial — o valor só é liberado com a transferência aprovada pela administradora.";

/**
 * Léxico proibido em qualquer copy desta fatia (pedra 4). Consórcio é compra
 * programada; nada aqui pode soar produto de rentabilidade.
 */
export const LEXICO_PROIBIDO = [
  "investimento",
  "investidor",
  "rendimento",
  "lucro",
  "CDI",
] as const;

/** Vocabulário aceito pelo check `captacoes_tipo_bem_sano` da 0088. */
export const TIPOS_BEM = ["imovel", "veiculo"] as const;
export type TipoBem = (typeof TIPOS_BEM)[number];

/** Vocabulário aceito pelo check `captacoes_origem_sana` da 0088. */
export const ORIGENS = ["site", "whatsapp", "painel", "indicacao"] as const;
export type OrigemCaptacao = (typeof ORIGENS)[number];

/**
 * Tira acento e caixa. Usado só na normalização de vocabulário fechado — não
 * é sanitização de texto livre.
 */
function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * `Imóvel` -> `imovel`, `Veículo` -> `veiculo`. Devolve `null` para qualquer
 * coisa fora do vocabulário — e `null` é gravável (a coluna é nullable),
 * enquanto um valor inventado quebraria o check no banco.
 *
 * Aceita de propósito as duas pontas: o que o <select> emite hoje
 * (`Imóvel`/`Veículo`) e o que o banco já guarda (`imovel`/`veiculo`), para
 * que a rota funcione se um dia a página passar a mandar o valor certo.
 */
export function normalizarTipoBem(bruto: unknown): TipoBem | null {
  if (typeof bruto !== "string") return null;
  const chave = semAcento(bruto.trim().toLowerCase());
  if (chave === "imovel") return "imovel";
  if (chave === "veiculo") return "veiculo";
  return null;
}

/** Só os dígitos do telefone. Não valida DDD nem operadora — só forma. */
export function digitosTelefone(bruto: unknown): string {
  if (typeof bruto !== "string" && typeof bruto !== "number") return "";
  return String(bruto).replace(/\D/g, "");
}

/** Telefone brasileiro plausível: DDD + número, 10 ou 11 dígitos. */
export function telefoneValido(digitos: string): boolean {
  return digitos.length >= 10 && digitos.length <= 13;
}

/**
 * Chave de idempotência. A 0088 criou um índice único PARCIAL sobre
 * `origem_chave`, valendo só enquanto o status está vivo
 * (novo/em_analise/proposta_enviada/aceita) — de propósito, para que uma
 * captação perdida meses atrás não impeça a mesma pessoa de voltar.
 *
 * A chave é por PESSOA e por ORIGEM, não por envio: a mesma pessoa mandando o
 * formulário curto do topo e depois o simulador detalhado tem de virar UMA
 * linha que se enriquece, não duas linhas concorrentes.
 */
export function chaveOrigem(
  origem: OrigemCaptacao,
  telefoneDigitos: string
): string | null {
  if (!telefoneValido(telefoneDigitos)) return null;
  return `${origem}:${telefoneDigitos}`;
}

/**
 * Lê dinheiro como a página escreve. A máscara `maskMoneyBR` da página faz
 * `Number(digitos).toLocaleString("pt-BR")`, ou seja: SÓ REAIS INTEIROS,
 * separador de milhar, nunca centavos. Então "150.000" são cento e cinquenta
 * mil, e tratar o ponto como decimal daria 150 — erro de mil vezes, calado.
 *
 * Aceita também número puro (caso o chamador já tenha convertido).
 * Devolve `null` quando não há dígito nenhum; devolve 0 quando o valor é
 * legitimamente zero (saldo devedor quitado, por exemplo) — quem não pode
 * receber zero é o crédito, e essa regra é de quem chama, não daqui.
 */
export function moedaParaNumero(bruto: unknown): number | null {
  if (typeof bruto === "number") {
    return Number.isFinite(bruto) && bruto >= 0 ? bruto : null;
  }
  if (typeof bruto !== "string") return null;
  const digitos = bruto.replace(/\D/g, "");
  if (!digitos) return null;
  const n = Number(digitos);
  return Number.isFinite(n) ? n : null;
}

/** Inteiro >= 0 (parcelas pagas). `null` para vazio ou inválido. */
export function inteiroNaoNegativo(bruto: unknown): number | null {
  if (typeof bruto === "number") {
    return Number.isInteger(bruto) && bruto >= 0 ? bruto : null;
  }
  if (typeof bruto !== "string") return null;
  const digitos = bruto.replace(/\D/g, "");
  if (!digitos) return null;
  const n = Number(digitos);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Texto livre aparado e limitado. `null` quando sobra vazio. */
export function textoCurto(bruto: unknown, max: number): string | null {
  if (typeof bruto !== "string") return null;
  const limpo = bruto.trim().replace(/\s+/g, " ");
  if (!limpo) return null;
  return limpo.slice(0, max);
}

/**
 * PEDRA 1 — crédito líquido ao cessionário.
 *
 * Lance embutido NÃO é desembolso de ninguém: é parte do próprio crédito que
 * a administradora retém para quitar o lance. Quem compra a cota recebe
 * `crédito − lance embutido` de poder de compra, e é sobre ESSE valor que a
 * proposta ao cedente tem de ser calculada. Calcular sobre o crédito bruto
 * inflaria a proposta exatamente nas cotas com lance embutido alto — que são
 * justamente as que menos entregam.
 *
 * Devolve `null` quando o crédito não é positivo, quando o lance é negativo,
 * ou quando o lance come o crédito inteiro (>=): não existe faixa sobre nada,
 * e devolver 0 aqui faria a página exibir "R$ 0 a R$ 0" como se fosse uma
 * proposta real.
 */
export function creditoLiquido(
  credito: number | null,
  lanceEmbutido: number | null
): number | null {
  if (credito === null || !Number.isFinite(credito) || credito <= 0) return null;
  const lance = lanceEmbutido === null ? 0 : lanceEmbutido;
  if (!Number.isFinite(lance) || lance < 0) return null;
  if (lance >= credito) return null;
  return credito - lance;
}

/**
 * A faixa de proposta ao cedente, sobre o crédito LÍQUIDO (pedra 1).
 *
 * Não devolve um número único de propósito: a palavra obrigatória é
 * "conforme análise da cota", e um valor cravado viraria promessa. Também não
 * devolve nada líquido de custo notarial — ver o AVISO SOBRE A PEDRA 2 no
 * topo deste arquivo.
 */
export function faixaProposta(
  creditoLiquidoValor: number | null
): { min: number; max: number } | null {
  if (
    creditoLiquidoValor === null ||
    !Number.isFinite(creditoLiquidoValor) ||
    creditoLiquidoValor <= 0
  ) {
    return null;
  }
  return {
    min: creditoLiquidoValor * PROPOSTA_MIN,
    max: creditoLiquidoValor * PROPOSTA_MAX,
  };
}

// ----------------------------------------------------------------------------
// PEDRA 2 — a tarifa da Conta Notarial (INFORME NOTARIAL Nº 09/2026, CNB/CF)
// ----------------------------------------------------------------------------

/** Fonte da tabela, citada na página. Sem isto o número vira folclore. */
export const NOTARIAL_FONTE =
  "Tabela do serviço nacional de Conta Notarial (convênio CNB/CF), Informe Notarial nº 09/2026.";

/**
 * O informe diverge de si mesmo: título "a partir de março", corpo "a partir
 * do mês de abril". Guardado por escrito em vez de escolhido no escuro.
 */
export const NOTARIAL_VIGENCIA =
  "Informe nº 09/2026: título indica início em março; corpo indica abril. Divergência do documento, não resolvida aqui.";

/**
 * Parcela da TARIFA que remunera o tabelião (59%). É repartição interna, NÃO
 * é acréscimo ao que o usuário paga. Existe aqui documentada exatamente para
 * que ninguém a some por engano em `tarifaNotarial`.
 */
export const PARTE_TABELIAO = 0.59;

export type FaixaNotarial = {
  /** Número da faixa como impresso no informe (1 a 11). */
  faixa: number;
  /** Piso da faixa, inclusivo. */
  min: number;
  /** Teto impresso, inclusivo. `null` na faixa 11, que é aberta. */
  max: number | null;
  /** `fixa` = reais; `percentual` = fração do depósito. */
  tipo: "fixa" | "percentual";
  /** R$ quando `fixa`; fração (0.0045 = 0,45%) quando `percentual`. */
  valor: number;
};

/**
 * As onze faixas do informe, na ordem impressa.
 *
 * Os tetos ficam registrados como no documento (…99.999,99) mas a BUSCA usa
 * o piso, não o teto: `min <= valor`. Comparar por teto criaria um buraco
 * entre 99.999,99 e 100.000,00 — inatingível em centavos, mas um `null`
 * esperando alguém passar um valor arredondado. Faixa sem resposta seria pior
 * que faixa aproximada.
 */
export const TABELA_NOTARIAL: readonly FaixaNotarial[] = [
  { faixa: 1, min: 0, max: 99999.99, tipo: "fixa", valor: 500 },
  { faixa: 2, min: 100000, max: 299999.99, tipo: "percentual", valor: 0.0045 },
  { faixa: 3, min: 300000, max: 499999.99, tipo: "percentual", valor: 0.0035 },
  { faixa: 4, min: 500000, max: 699999.99, tipo: "percentual", valor: 0.0032 },
  { faixa: 5, min: 700000, max: 999999.99, tipo: "percentual", valor: 0.0031 },
  { faixa: 6, min: 1000000, max: 1999999.99, tipo: "percentual", valor: 0.0023 },
  { faixa: 7, min: 2000000, max: 2999999.99, tipo: "percentual", valor: 0.0017 },
  { faixa: 8, min: 3000000, max: 3999999.99, tipo: "percentual", valor: 0.0016 },
  { faixa: 9, min: 4000000, max: 4999999.99, tipo: "percentual", valor: 0.0015 },
  { faixa: 10, min: 5000000, max: 5999999.99, tipo: "percentual", valor: 0.0014 },
  { faixa: 11, min: 6000000, max: null, tipo: "percentual", valor: 0.0013 },
] as const;

/**
 * A tarifa da Conta Notarial para uma operação de `valorOperacao` reais.
 *
 * QUAL VALOR É "A OPERAÇÃO". O informe fala em "valor do depósito". Na cessão
 * de cota, o que entra na conta vinculada é o que o COMPRADOR paga pela
 * carta — isto é, a proposta ao cedente —, não o valor do crédito. Usar o
 * crédito subiria a faixa em uma ordem de grandeza: numa carta de R$ 150 mil,
 * a operação real fica perto de R$ 30 mil (faixa 1, R$ 500 fixos) e não na
 * faixa 2. Quem chamar esta função é responsável por passar o DEPÓSITO.
 * Confirmação formal dessa leitura está pendurada como pergunta ao Emerson.
 *
 * Devolve `null` para valor ausente, não-finito ou negativo — nunca zero
 * disfarçado de resposta.
 */
export function tarifaNotarial(
  valorOperacao: number | null
): { valor: number; faixa: number; tipo: "fixa" | "percentual" } | null {
  if (
    valorOperacao === null ||
    !Number.isFinite(valorOperacao) ||
    valorOperacao < 0
  ) {
    return null;
  }

  let escolhida: FaixaNotarial | null = null;
  for (const f of TABELA_NOTARIAL) {
    if (valorOperacao >= f.min) escolhida = f;
  }
  if (escolhida === null) return null;

  const valor =
    escolhida.tipo === "fixa"
      ? escolhida.valor
      : valorOperacao * escolhida.valor;

  // Centavos. A tarifa é cobrança real, não estimativa de tela.
  return {
    valor: Math.round(valor * 100) / 100,
    faixa: escolhida.faixa,
    tipo: escolhida.tipo,
  };
}
