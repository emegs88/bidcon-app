// POST /api/processo/agente — agente de ajuda do cliente sobre o próprio processo.
// Plugável: sem IA_PROVIDER, responde com FAQ factual estático (respostas fixas,
// já dentro de compliance). Com provedor, a saída do LLM passa OBRIGATORIAMENTE
// por sanitizarCompliance antes de voltar ao client.
//
// A mensagem do cliente é DADO, nunca instrução: este handler não executa o que
// vier no texto; só faz correspondência de tópico para escolher uma resposta.
//
// COMPLIANCE: nada de prazo/contemplação/rendimento/investimento; nenhuma
// administradora/taxa/comissão. Toda resposta é factual sobre as etapas.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sanitizarCompliance } from "@/lib/ia";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// remove acentos e baixa caixa para casar palavras-chave de forma robusta.
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// FAQ factual: pares (gatilhos, resposta). Respostas fixas, sem promessa.
const FAQ: Array<{ chaves: string[]; resposta: string }> = [
  {
    chaves: ["documento", "documentos", "checklist", "check-list", "enviar doc"],
    resposta:
      "Na etapa de documentação, envie os itens do check-list na sua tela. A equipe confere cada documento e marca como aprovado ou pede reenvio, com o motivo.",
  },
  {
    chaves: ["sinal", "pix", "reserva", "2%", "comprovante"],
    resposta:
      "O sinal é 2% do crédito da carta e serve para reservar a cota. O pagamento é por PIX; depois anexe o comprovante para a equipe confirmar. O valor do sinal é abatido da entrada.",
  },
  {
    chaves: ["contrato", "assinar", "assinatura", "aceite"],
    resposta:
      "Primeiro você aceita o contrato de prestação de serviço (intermediação). Depois do sinal confirmado, é gerado o contrato de compra e venda da cota, também para você aceitar.",
  },
  {
    chaves: ["entrada", "residual", "pagar entrada"],
    resposta:
      "A entrada é paga após a assinatura do contrato da cota. O sinal já pago é descontado, então você paga apenas o residual da entrada.",
  },
  {
    chaves: ["transferencia", "transferência", "formulario", "formulário", "link"],
    resposta:
      "Na fase de transferência você preenche a ficha cadastral e recebe um link de assinatura por e-mail. A efetivação é feita pela administradora do consórcio.",
  },
  {
    chaves: ["prazo", "contemplacao", "contemplação", "quando", "demora"],
    resposta:
      "Não informamos prazo de contemplação — isso depende da administradora do consórcio e não é algo que esta tela promete. Acompanhe o andamento pelas etapas.",
  },
  {
    chaves: ["contato", "falar", "atendimento", "whatsapp", "email", "e-mail", "ajuda"],
    resposta:
      "Você pode falar com a equipe pelos contatos no rodapé da sua tela: WhatsApp, e-mail e Instagram @bidcon.br.",
  },
];

const PADRAO =
  "Posso ajudar com documentos, sinal, contratos, entrada e transferência do seu processo. Sobre prazos de contemplação, não damos previsão — depende da administradora. Se preferir, fale com a equipe pelos contatos no rodapé.";

function respostaEstatica(mensagem: string): string {
  const base = normalizar(mensagem);
  for (const item of FAQ) {
    if (item.chaves.some((k) => base.includes(normalizar(k)))) {
      return item.resposta;
    }
  }
  return PADRAO;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    processo_id?: unknown;
    mensagem?: unknown;
  };
  const processoId = String(body.processo_id ?? "").trim();
  const mensagem = String(body.mensagem ?? "").trim().slice(0, 2000);

  if (!UUID_RE.test(processoId)) {
    return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
  }
  if (!mensagem) {
    return NextResponse.json({ erro: "Mensagem vazia." }, { status: 422 });
  }

  // confirma que o processo é do próprio cliente (não vaza contexto alheio).
  const { data: processo } = await supabase
    .from("processos")
    .select("id")
    .eq("id", processoId)
    .eq("cliente_id", user.id)
    .maybeSingle();
  if (!processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  // Sem provedor de IA => FAQ factual estático (já dentro de compliance).
  if (!process.env.IA_PROVIDER) {
    return NextResponse.json({ resposta: respostaEstatica(mensagem) });
  }

  // Com provedor: ponto de integração do LLM. A saída passa SEMPRE por
  // sanitizarCompliance antes de voltar ao client; se violar, cai no fallback
  // factual. (A chamada ao LLM entra quando o provedor for definido e autorizado.)
  const rascunho = respostaEstatica(mensagem); // placeholder até plugar o LLM
  const resposta = sanitizarCompliance(rascunho, PADRAO);
  return NextResponse.json({ resposta });
}
