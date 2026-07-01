// ============================================================================
// Contratos do fluxo pós-reserva — snapshot factual (jsonb) + texto de modelo.
// ----------------------------------------------------------------------------
// Dois contratos, na ordem jurídica confirmada (SERVIÇO → PIX → COTA):
//   1) 'servico'  — prestação de serviço de intermediação. Modelo FIXO + dados
//                   do cliente (nome/CPF do KYC + valor do sinal). NÃO cita
//                   administradora, taxa, fundo nem comissão.
//   2) 'cota'     — compra e venda da cota, gerado só APÓS o sinal pago. Descreve
//                   o bem de forma factual (tipo, crédito, entrada). Também NÃO
//                   cita administradora/taxa/comissão ao cliente.
//
// COMPLIANCE (inviolável): nenhum texto promete contemplação/prazo/rendimento/
//   investimento. Cada parágrafo gerado passa por `violaCompliance` (lib/ia.ts,
//   função PURA, sem chamada externa) — parágrafo que violar é trocado por um
//   aviso neutro. administradora/taxa/fundo/comissão NUNCA entram no snapshot do
//   cliente nem no texto.
//
// LGPD: o CPF exibido no texto vem MASCARADO (mascararCpf). O CPF cru continua
//   só no banco (KYC) e nunca é escrito aqui.
//
// Este módulo é texto/dado puro (sem I/O, sem env): pode ser importado por
// rotas de servidor. A geração da linha em `contratos` é feita pela RPC
// gerar_contrato (migration 0014); aqui montamos o `dados` jsonb e o corpo.
// ============================================================================

import { violaCompliance } from "./ia";
import { brl } from "./status";
import { LABEL_TIPO_BEM } from "./status";
import { mascararCpf } from "./format";

// Parte CONTRATADA (dado factual público da empresa). Nome jurídico confirmado.
export const CONTRATADA = {
  razaoSocial: "PROSPERITY PARTICIPACOES HOLDING LTDA",
  nomeFantasia: "Prospere Consórcios",
  marca: "Bidcon",
  cidade: "Hortolândia/SP",
} as const;

export type TipoContrato = "servico" | "cota";

// Snapshot factual gravado em contratos.dados (jsonb). Sem administradora/taxa/
// comissão — só o que o cliente pode e precisa ver.
export type DadosContratoServico = {
  tipo: "servico";
  cliente_nome: string;
  cliente_cpf_mascarado: string;
  valor_sinal: number | null;
  contratada_razao_social: string;
  gerado_em: string; // ISO
};

export type DadosContratoCota = {
  tipo: "cota";
  cliente_nome: string;
  cliente_cpf_mascarado: string;
  bem_tipo: string; // "imovel" | "veiculo" (rótulo aplicado na exibição)
  valor_credito: number | null;
  valor_entrada: number | null;
  valor_sinal: number | null;
  contratada_razao_social: string;
  gerado_em: string;
};

export type DadosContrato = DadosContratoServico | DadosContratoCota;

// Troca qualquer parágrafo que viole compliance por um aviso neutro (defensivo:
// os modelos abaixo já são conservadores, mas a barreira fica de qualquer forma).
function linhaSegura(texto: string): string {
  return violaCompliance(texto)
    ? "Condições factuais desta operação; nada aqui promete contemplação, prazo ou rendimento."
    : texto;
}

// ----------------------------------------------------------------------------
// Snapshots (o que grava em contratos.dados).
// ----------------------------------------------------------------------------
export function dadosContratoServico(input: {
  clienteNome: string;
  clienteCpf: string | null | undefined;
  valorSinal: number | null;
}): DadosContratoServico {
  return {
    tipo: "servico",
    cliente_nome: input.clienteNome,
    cliente_cpf_mascarado: mascararCpf(input.clienteCpf),
    valor_sinal: input.valorSinal,
    contratada_razao_social: CONTRATADA.razaoSocial,
    gerado_em: new Date().toISOString(),
  };
}

export function dadosContratoCota(input: {
  clienteNome: string;
  clienteCpf: string | null | undefined;
  bemTipo: string;
  valorCredito: number | null;
  valorEntrada: number | null;
  valorSinal: number | null;
}): DadosContratoCota {
  return {
    tipo: "cota",
    cliente_nome: input.clienteNome,
    cliente_cpf_mascarado: mascararCpf(input.clienteCpf),
    bem_tipo: input.bemTipo,
    valor_credito: input.valorCredito,
    valor_entrada: input.valorEntrada,
    valor_sinal: input.valorSinal,
    contratada_razao_social: CONTRATADA.razaoSocial,
    gerado_em: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Corpo do contrato (texto de exibição/assinatura). Retorna blocos de parágrafo
// já sanitizados. A UI renderiza como texto; o PDF (quando houver) usa o mesmo.
// ----------------------------------------------------------------------------
export type CorpoContrato = { titulo: string; paragrafos: string[] };

export function corpoContratoServico(d: DadosContratoServico): CorpoContrato {
  const sinal = d.valor_sinal != null ? brl(d.valor_sinal) : "a definir";
  const paragrafos = [
    `CONTRATANTE: ${d.cliente_nome}, CPF ${d.cliente_cpf_mascarado}.`,
    `CONTRATADA: ${d.contratada_razao_social} (${CONTRATADA.nomeFantasia}), ` +
      `operadora da plataforma ${CONTRATADA.marca}, com sede em ${CONTRATADA.cidade}.`,
    `OBJETO: a CONTRATADA prestará serviço de intermediação para a aquisição de ` +
      `uma cota de consórcio já contemplada, organizando a documentação e a ` +
      `transferência de titularidade junto à administradora responsável.`,
    `A ${CONTRATADA.marca} não é instituição financeira e não aprova crédito. A ` +
      `transferência da cota é sempre formalizada e validada pela administradora ` +
      `do consórcio.`,
    `SINAL DA RESERVA: para reservar a cota, o CONTRATANTE pagará, via PIX, o ` +
      `valor de ${sinal}, que segura a cota pelo prazo informado na plataforma. O ` +
      `valor pago a título de sinal é abatido da entrada da cota.`,
    `Os valores exibidos na plataforma (crédito, entrada, parcela, prazo) são ` +
      `estimativas e ficam sujeitos à análise e à transferência pela administradora ` +
      `do consórcio.`,
    `Este contrato de prestação de serviço é a etapa anterior à assinatura do ` +
      `contrato de compra e venda da cota, que só é gerado após a confirmação do ` +
      `sinal.`,
  ].map(linhaSegura);

  return { titulo: "Contrato de prestação de serviço de intermediação", paragrafos };
}

export function corpoContratoCota(d: DadosContratoCota): CorpoContrato {
  const bem = LABEL_TIPO_BEM[d.bem_tipo] ?? d.bem_tipo;
  const credito = d.valor_credito != null ? brl(d.valor_credito) : "a definir";
  const entrada = d.valor_entrada != null ? brl(d.valor_entrada) : "a definir";
  const sinal = d.valor_sinal != null ? brl(d.valor_sinal) : "—";

  const paragrafos = [
    `COMPRADOR: ${d.cliente_nome}, CPF ${d.cliente_cpf_mascarado}.`,
    `INTERMEDIADORA: ${d.contratada_razao_social} (${CONTRATADA.nomeFantasia}), ` +
      `plataforma ${CONTRATADA.marca}.`,
    `OBJETO: aquisição de uma cota de consórcio já contemplada, destinada a ${bem}, ` +
      `com crédito de ${credito}.`,
    `ENTRADA: ${entrada}. Do valor da entrada é abatido o sinal já pago (${sinal}); ` +
      `o COMPRADOR paga apenas o residual.`,
    `A transferência de titularidade da cota é formalizada e validada pela ` +
      `administradora do consórcio. A ${CONTRATADA.marca} organiza a documentação e ` +
      `acompanha o processo; não é instituição financeira e não aprova crédito.`,
    `Os valores aqui descritos são factuais desta operação e podem ser ajustados ` +
      `pela administradora na análise da transferência.`,
  ].map(linhaSegura);

  return { titulo: "Contrato de compra e venda de cota de consórcio", paragrafos };
}
