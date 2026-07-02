// ============================================================================
// Bidcon Reserve — máquina de estados (Slice 1) · FONTE ÚNICA lógica.
// ----------------------------------------------------------------------------
// Espelha `reserva_transicao_valida` da migration 0016 (RPC 5.4). Usada na UI
// (para habilitar/desabilitar ações) e nos testes de conformidade. Aritmética/
// lógica pura: sem dependências, sem I/O, sem banco.
//
// COMPLIANCE: só descreve o passo real da operação de custódia. Nada aqui
// promete contemplação/prazo/rendimento. Rótulos de cliente são neutros.
// ============================================================================

/** Estados canônicos do escrow (§5 do Master Build Prompt). `state text` no banco. */
export type ReservaState =
  | "DRAFT"
  | "TERMS_SIGNED"
  | "SIGNAL_DEPOSITED"
  | "VERIFIED"
  | "ANUENCIA_REQUESTED"
  | "ANUENCIA_APPROVED"
  | "ANUENCIA_DENIED"
  | "FULLY_FUNDED"
  | "SETTLED"
  | "REFUNDED"
  | "DISPUTED"
  | "CLOSED";

/** Todos os estados, em ordem de referência (não é ordem obrigatória de fluxo). */
export const RESERVA_STATES: ReservaState[] = [
  "DRAFT",
  "TERMS_SIGNED",
  "SIGNAL_DEPOSITED",
  "VERIFIED",
  "ANUENCIA_REQUESTED",
  "ANUENCIA_APPROVED",
  "ANUENCIA_DENIED",
  "FULLY_FUNDED",
  "SETTLED",
  "REFUNDED",
  "DISPUTED",
  "CLOSED",
];

/**
 * Transições válidas: de → conjunto de destinos permitidos.
 * IDÊNTICA à lista de `reserva_transicao_valida` (0016 §5.4). Se mudar aqui,
 * muda lá — e vice-versa. Os testes de conformidade travam essa paridade.
 */
export const TRANSICOES: Record<ReservaState, ReservaState[]> = {
  DRAFT: ["TERMS_SIGNED"],
  TERMS_SIGNED: ["SIGNAL_DEPOSITED", "DISPUTED"],
  SIGNAL_DEPOSITED: ["VERIFIED", "DISPUTED"],
  VERIFIED: ["ANUENCIA_REQUESTED", "DISPUTED"],
  ANUENCIA_REQUESTED: ["ANUENCIA_APPROVED", "ANUENCIA_DENIED", "DISPUTED"],
  ANUENCIA_APPROVED: ["FULLY_FUNDED", "DISPUTED"],
  ANUENCIA_DENIED: ["REFUNDED"],
  FULLY_FUNDED: ["SETTLED", "DISPUTED"],
  SETTLED: ["CLOSED"],
  REFUNDED: ["CLOSED"],
  DISPUTED: ["REFUNDED", "SETTLED", "CLOSED"],
  CLOSED: [],
};

/**
 * Estados que exigem GATE HUMANO por envolverem dinheiro (§4.6). A transição
 * PARA um destes só é registrada após ação explícita de um operador; a RPC
 * apenas marca a intenção (as legs vão PLANNED→INSTRUCTED→CONFIRMED à mão).
 */
export const DESTINOS_COM_DINHEIRO: ReservaState[] = [
  "SIGNAL_DEPOSITED",
  "FULLY_FUNDED",
  "SETTLED",
  "REFUNDED",
];

/** Estados terminais (nenhuma transição sai deles). */
export const ESTADOS_TERMINAIS: ReservaState[] = ["CLOSED"];

/**
 * Estados considerados ATIVOS para a invariante "no máx. 1 reserva ativa por
 * carta" (espelha o guard de `reserva_criar`, 0016 §5.2). Uma carta pode ter
 * N reservas na vida, mas só 1 fora deste conjunto de estados finais.
 */
export const ESTADOS_INATIVOS: ReservaState[] = [
  "REFUNDED",
  "SETTLED",
  "CLOSED",
  "ANUENCIA_DENIED",
];

/** Erro tipado de transição inválida (para a UI/servidor tratarem com precisão). */
export class TransicaoInvalidaError extends Error {
  readonly de: ReservaState;
  readonly para: string;
  constructor(de: ReservaState, para: string) {
    super(`transicao invalida: ${de} -> ${para}`);
    this.name = "TransicaoInvalidaError";
    this.de = de;
    this.para = para;
  }
}

/** True se `para` é um estado conhecido do enum. */
export function isReservaState(v: string): v is ReservaState {
  return (RESERVA_STATES as string[]).includes(v);
}

/** True se a transição de → para é permitida pela máquina. */
export function podeTransicionar(de: ReservaState, para: string): boolean {
  if (!isReservaState(para)) return false;
  return TRANSICOES[de].includes(para);
}

/**
 * Valida a transição e LANÇA `TransicaoInvalidaError` quando proibida. Retorna
 * o destino tipado quando válida (para encadear com segurança de tipos).
 */
export function assertTransicao(de: ReservaState, para: string): ReservaState {
  if (!podeTransicionar(de, para)) throw new TransicaoInvalidaError(de, para);
  return para as ReservaState;
}

/** True se o destino exige gate humano (dinheiro). */
export function exigeGateHumano(para: ReservaState): boolean {
  return DESTINOS_COM_DINHEIRO.includes(para);
}

/** True se a reserva está ATIVA (conta para a invariante de 1-ativa-por-carta). */
export function reservaAtiva(state: ReservaState): boolean {
  return !ESTADOS_INATIVOS.includes(state);
}
