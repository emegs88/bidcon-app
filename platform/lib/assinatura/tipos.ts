// ============================================================================
// BIDCON-ASSINATURA-01 — contrato do provedor de assinatura eletrônica.
// ----------------------------------------------------------------------------
// A fatia assina DOIS documentos no MESMO link: o contrato de cessão e o
// requerimento de abertura da conta notarial (Anexo II do 5º Tabelionato).
// Todos os signatários assinam os dois — por isso o conceito central aqui é o
// ENVELOPE, não o documento solto.
//
// Este arquivo NÃO fala HTTP e NÃO importa nada do Supabase: é só o contrato
// que qualquer provedor (ZapSign hoje; Clicksign/Docusign amanhã) precisa
// cumprir. Trocar de provedor é escrever um novo arquivo que exporte um
// AssinaturaProvider — nada nas rotas muda.
//
// Os literais aqui espelham os CHECKs das tabelas criadas em
// migrations-nnv/0071_assinatura_01.sql (+ delta 0072). Se um CHECK mudar no
// banco, muda aqui junto — o compilador não enxerga o Postgres.
// ============================================================================

/** Provedores previstos no CHECK de assinatura_envelopes.provedor. */
export type ProvedorNome = "zapsign" | "clicksign" | "docusign";

/** Papéis da operação Bidcon (CHECK de assinatura_signatarios.papel). */
export type PapelSignatario =
  | "cedente"
  | "cessionario"
  | "pagadora"
  | "comissionada"
  | "bidcon"
  | "testemunha";

/** CHECK de assinatura_envelopes.status. */
export type StatusEnvelope =
  | "rascunho"
  | "enviado"
  | "parcial"
  | "assinado"
  | "recusado"
  | "expirado"
  | "cancelado";

/** CHECK de assinatura_signatarios.status. */
export type StatusSignatario = "pendente" | "visualizou" | "assinado" | "recusado";

/**
 * Item = o documento dentro do envelope. O valor é usado no PATH do Storage
 * ({processo_id}/{item}-{ts}.pdf), por isso usa hífen.
 * O `tipo` correspondente em public.contratos usa underscore
 * ('cessao' | 'requerimento_conta') — ver TIPO_CONTRATO_POR_ITEM.
 */
export type ItemDocumento = "cessao" | "requerimento-conta";

/** Valor de public.contratos.tipo para cada item (CHECK contratos_tipo_check). */
export const TIPO_CONTRATO_POR_ITEM: Record<ItemDocumento, string> = {
  cessao: "cessao",
  "requerimento-conta": "requerimento_conta",
};

/** Um PDF já montado, pronto para ir ao provedor. */
export type DocumentoParaAssinar = {
  item: ItemDocumento;
  /** Nome legível que o signatário vê na tela do provedor. */
  titulo: string;
  pdf: Uint8Array;
};

/**
 * Signatário de entrada. `whatsapp` em E.164 SEM o "+" (ex.: 5519988303000),
 * igual ao que a coluna assinatura_signatarios.whatsapp documenta.
 */
export type SignatarioEntrada = {
  papel: PapelSignatario;
  nome: string;
  cpfCnpj?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  /** 1 = primeiro a assinar. Default 1 (todos em paralelo). */
  ordem?: number;
};

/** Signatário como o provedor devolveu (já com o link individual). */
export type SignatarioCriado = SignatarioEntrada & {
  provedorSignerId: string | null;
  /**
   * URL-CAPACIDADE: quem tem o link assina. Nunca sai para o cliente nesta
   * fatia (a 0072 removeu a policy de select do cliente em
   * assinatura_signatarios exatamente por isso).
   */
  linkAssinatura: string | null;
  ordem: number;
};

/** Resposta de criarEnvelope. */
export type EnvelopeCriado = {
  provedorEnvelopeId: string;
  signatarios: SignatarioCriado[];
};

/**
 * Evento de webhook já NORMALIZADO — o formato que as rotas entendem,
 * independente do provedor.
 *
 * `tipoCru` é preservado para ir inteiro ao log assinatura_eventos: auditoria
 * quer o que o provedor disse, não a nossa tradução.
 */
export type EventoNormalizado = {
  tipoCru: string;
  provedorEnvelopeId: string | null;
  /** null = evento que não muda o status do envelope (ex.: e-mail entregue). */
  statusEnvelope: StatusEnvelope | null;
  /** URL TEMPORÁRIA do provedor. Baixar e reguardar no bucket; nunca persistir. */
  urlArquivoAssinado: string | null;
  signatarios: { provedorSignerId: string; status: StatusSignatario }[];
};

export type EntradaEnvelope = {
  /** Título do envelope na tela do provedor. */
  titulo: string;
  /** Ordem importa: o primeiro vira o documento principal do provedor. */
  documentos: DocumentoParaAssinar[];
  signatarios: SignatarioEntrada[];
};

/**
 * O contrato. Um provedor novo implementa estes três métodos e mais nada.
 *
 * `interpretarEvento` é SÍNCRONO e PURO de propósito: é a única parte com
 * regra de negócio de verdade (mapa de status), então precisa ser testável
 * sem rede. Ver lib/assinatura/eventos.test.ts.
 */
export interface AssinaturaProvider {
  readonly nome: ProvedorNome;
  criarEnvelope(entrada: EntradaEnvelope): Promise<EnvelopeCriado>;
  interpretarEvento(payload: unknown): EventoNormalizado;
  baixarAssinado(url: string): Promise<Uint8Array>;
}
