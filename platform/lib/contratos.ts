// ============================================================================
// Contratos do fluxo pós-reserva — snapshot factual (jsonb) + texto de modelo.
// ----------------------------------------------------------------------------
// Dois contratos, na ordem jurídica confirmada (SERVIÇO → TERMO DE RESERVA →
// DOCUMENTAÇÃO → COTA):
//   1) 'servico'  — prestação de serviço de intermediação. Modelo FIXO + dados
//                   do cliente (nome/CPF/e-mail do profile + valor do sinal,
//                   campo legado do modelo — ver SINAL-CLEANUP-01).
//                   NÃO cita administradora, taxa, fundo nem comissão.
//   2) 'cota'     — compra e venda da cota, gerado só após o Termo de Reserva
//                   assinado e a documentação do checklist completa (gate real
//                   na RPC gerar_contrato, migrations 0066/0067). Descreve o
//                   bem de forma factual (tipo, crédito, entrada). Também NÃO
//                   cita administradora/taxa/comissão ao cliente.
//
// COMPLIANCE (inviolável): nenhum texto promete contemplação/prazo/rendimento/
//   investimento. Cada parágrafo gerado passa por `violaCompliance` (lib/ia.ts,
//   função PURA, sem chamada externa) — parágrafo que violar é trocado por um
//   aviso neutro. administradora/taxa/fundo/comissão NUNCA entram no snapshot do
//   cliente nem no texto.
//
// QUALIFICAÇÃO COMPLETA (v4/FINAL): o CONTRATANTE precisa estar identificado
//   por inteiro (nome + CPF POR EXTENSO + e-mail) para o contrato ter validade
//   jurídica — quem vê esse texto é o próprio cliente, então exibir o próprio
//   CPF não é problema de privacidade. `mascararCpf` (lib/format.ts) segue
//   intocada e em uso nas telas administrativas (admin/perfis).
//   O CPF só é gravado em `profiles.cpf` depois de validado por dígito
//   verificador (`cpfValido`, lib/kyc.ts) — ver /api/perfil/qualificacao e o
//   gate em /api/processo/contrato.
//
// Este módulo é texto/dado puro (sem I/O, sem env): pode ser importado por
// rotas de servidor. A geração da linha em `contratos` é feita pela RPC
// gerar_contrato (migration 0014); aqui montamos o `dados` jsonb e o corpo.
// ============================================================================

import { violaCompliance } from "./ia";
import { brl } from "./status";
import { LABEL_TIPO_BEM } from "./status";
import { formatarCpf } from "./format";

// Parte CONTRATADA (dado factual público da empresa). Qualificação completa
// conforme cartão CNPJ (Receita Federal).
export const CONTRATADA = {
  razaoSocial: "EGS CAPITAL PARTICIPACOES LTDA",
  cnpj: "67.709.975/0001-64",
  endereco:
    "Av. Brigadeiro Faria Lima, nº 1.572, Sala 1022, Jardim Paulistano, São Paulo/SP, CEP 01.451-917",
  representante: "Emerson Gomes dos Santos",
  marca: "Bidcon",
} as const;

// Linha de qualificação da CONTRATADA, reusada nos dois modelos de contrato
// (serviço e cota) — mesma redação, mesma fonte de verdade (CONTRATADA acima).
function linhaContratada(): string {
  return (
    `CONTRATADA: ${CONTRATADA.razaoSocial}, inscrita no CNPJ ${CONTRATADA.cnpj}, ` +
    `com sede em ${CONTRATADA.endereco}, neste ato representada por seu ` +
    `administrador, ${CONTRATADA.representante}, na forma de seu contrato ` +
    `social, operadora da plataforma ${CONTRATADA.marca}.`
  );
}

export type TipoContrato = "servico" | "cota";

// Snapshot factual gravado em contratos.dados (jsonb). Sem administradora/taxa/
// comissão — só o que o cliente pode e precisa ver.
export type DadosContratoServico = {
  tipo: "servico";
  cliente_nome: string;
  cliente_cpf: string;
  cliente_email: string;
  valor_sinal: number | null;
  contratada_razao_social: string;
  gerado_em: string; // ISO
};

export type DadosContratoCota = {
  tipo: "cota";
  cliente_nome: string;
  cliente_cpf: string;
  cliente_email: string;
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
  clienteEmail: string | null | undefined;
  valorSinal: number | null;
}): DadosContratoServico {
  return {
    tipo: "servico",
    cliente_nome: input.clienteNome,
    cliente_cpf: formatarCpf(input.clienteCpf),
    cliente_email: input.clienteEmail ?? "",
    valor_sinal: input.valorSinal,
    contratada_razao_social: CONTRATADA.razaoSocial,
    gerado_em: new Date().toISOString(),
  };
}

export function dadosContratoCota(input: {
  clienteNome: string;
  clienteCpf: string | null | undefined;
  clienteEmail: string | null | undefined;
  bemTipo: string;
  valorCredito: number | null;
  valorEntrada: number | null;
  valorSinal: number | null;
}): DadosContratoCota {
  return {
    tipo: "cota",
    cliente_nome: input.clienteNome,
    cliente_cpf: formatarCpf(input.clienteCpf),
    cliente_email: input.clienteEmail ?? "",
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
  const paragrafos = [
    `CONTRATANTE: ${d.cliente_nome}, CPF ${d.cliente_cpf}, e-mail ${d.cliente_email}.`,
    linhaContratada(),
    `OBJETO: a CONTRATADA prestará serviço de intermediação para a aquisição de ` +
      `uma cota de consórcio já contemplada, organizando a documentação e a ` +
      `transferência de titularidade junto à administradora responsável.`,
    `A ${CONTRATADA.marca} não é instituição financeira e não aprova crédito. A ` +
      `transferência da cota é sempre formalizada e validada pela administradora ` +
      `do consórcio.`,
    `ENTRADA E FECHAMENTO PROTEGIDO: o valor principal da entrada é depositado ` +
      `em conta vinculada da operação, administrada pelo 5º Tabelionato de Notas ` +
      `de Campinas (conta notarial), em instituição financeira conveniada, e sua ` +
      `liberação é comandada pelo tabelião somente após a formalização da ` +
      `transferência junto à administradora.`,
    `Os valores exibidos na plataforma (crédito, entrada, parcela, prazo) são ` +
      `estimativas e ficam sujeitos à análise e à transferência pela administradora ` +
      `do consórcio.`,
    `Este contrato de prestação de serviço é a etapa anterior à assinatura do ` +
      `contrato de compra e venda da cota, que só é gerado após a assinatura do ` +
      `Termo de Reserva e a conferência da documentação.`,
  ].map(linhaSegura);

  return { titulo: "Contrato de prestação de serviço de intermediação", paragrafos };
}

export function corpoContratoCota(d: DadosContratoCota): CorpoContrato {
  const bem = LABEL_TIPO_BEM[d.bem_tipo] ?? d.bem_tipo;
  const credito = d.valor_credito != null ? brl(d.valor_credito) : "a definir";
  const entrada = d.valor_entrada != null ? brl(d.valor_entrada) : "a definir";

  const paragrafos = [
    `COMPRADOR: ${d.cliente_nome}, CPF ${d.cliente_cpf}, e-mail ${d.cliente_email}.`,
    linhaContratada(),
    `OBJETO: aquisição de uma cota de consórcio já contemplada, destinada a ${bem}, ` +
      `com crédito de ${credito}.`,
    `ENTRADA: ${entrada}.`,
    `A transferência de titularidade da cota é formalizada e validada pela ` +
      `administradora do consórcio. A ${CONTRATADA.marca} organiza a documentação e ` +
      `acompanha o processo; não é instituição financeira e não aprova crédito.`,
    `Os valores aqui descritos são factuais desta operação e podem ser ajustados ` +
      `pela administradora na análise da transferência.`,
  ].map(linhaSegura);

  return { titulo: "Contrato de compra e venda de cota de consórcio", paragrafos };
}
