// POST /api/captacao — o lado do CEDENTE finalmente vira linha no banco.
//
// O QUE ESTA ROTA CONSERTA (medido em 29/08/2026). A tabela `captacoes` existe
// desde a migration 0088 e tinha ZERO linhas. O motivo não era falta de gente
// querendo vender: era que o formulário de /vender-consorcio-contemplado
// terminava em `window.open(zapLink(...))` e MAIS NADA. Quem não abrisse o
// WhatsApp, ou fechasse a aba, sumia sem deixar rastro — e o consentimento
// LGPD era coletado no checkbox e descartado no mesmo instante.
//
// BANCO: xtv, não nnv. Isso não se adivinha pelo assunto da tabela — foi
// medido nos dois projetos:
//     select to_regclass('public.captacoes')
//       xtv -> captacoes    nnv -> null
// Por isso `createXtvClient()` (service_role, server-only), igual ao
// /api/interesse. NÃO usar createAdminClient (é do projeto nnv).
//
// RLS: a 0088 liga RLS com ZERO policies e ainda faz
// `revoke all on table public.captacoes from anon, authenticated`. Ou seja:
// ninguém lê, ninguém escreve, exceto service_role (que passa por cima de
// RLS). Esta rota é a ÚNICA porta — e por isso ela carrega a guarda inteira.
//
// CORS: mesmo padrão do /api/interesse e do /api/atende. A página roda em
// bidcon.com.br e chama app.bidcon.com.br, cross-origin. `connect-src` do
// vercel.json já libera esse destino (medido).
//
// CONSENTIMENTO É REQUISITO, NÃO CAMPO OPCIONAL. Sem `consentimento: true` a
// rota devolve 400 e não grava. É o oposto do que a página fazia antes, e é
// deliberado: gravar telefone de quem não consentiu seria trocar um defeito
// (perder o lead) por outro bem pior (guardar dado sem base legal).
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  origemPermitida,
  rateLimitExcedido,
  ipDe,
  corsHeaders,
  handlePreflight,
} from "@/lib/api-guard";
import {
  normalizarTipoBem,
  digitosTelefone,
  telefoneValido,
  chaveOrigem,
  moedaParaNumero,
  inteiroNaoNegativo,
  textoCurto,
} from "@/lib/captacao";

export const dynamic = "force-dynamic";

/** Violação de índice único no Postgres. É assim que a idempotência aparece. */
const CONFLITO_UNIQUE = "23505";

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

export async function POST(req: Request) {
  // AUTH camada 1: só origem confiável (bidcon.com.br / app.bidcon.com.br).
  if (!origemPermitida(req)) {
    return NextResponse.json(
      { erro: "Origem não autorizada." },
      { status: 403, headers: corsHeaders(req) }
    );
  }

  // AUTH camada 2: rate-limit por IP (20 req/min). Estouro -> 429.
  if (rateLimitExcedido(ipDe(req))) {
    return NextResponse.json(
      { erro: "Muitas requisições. Tente novamente em instantes." },
      { status: 429, headers: corsHeaders(req) }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const nome = textoCurto(body.nome, 120);
  const telefone = digitosTelefone(body.telefone);
  const consentiu = body.consentimento === true;

  if (!nome || nome.length < 2) {
    return NextResponse.json(
      { erro: "Nome inválido." },
      { status: 400, headers: corsHeaders(req) }
    );
  }
  if (!telefoneValido(telefone)) {
    return NextResponse.json(
      { erro: "Telefone inválido." },
      { status: 400, headers: corsHeaders(req) }
    );
  }
  if (!consentiu) {
    return NextResponse.json(
      { erro: "É necessário autorizar o contato para continuar." },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  // `credito` tem check `> 0` na 0088 — zero viraria erro de constraint, então
  // vira null aqui. `saldo_devedor` aceita zero (cota quitada é caso real).
  const creditoBruto = moedaParaNumero(body.credito);
  const credito = creditoBruto !== null && creditoBruto > 0 ? creditoBruto : null;
  const saldoDevedor = moedaParaNumero(body.saldo_devedor);
  const parcelasPagas = inteiroNaoNegativo(body.parcelas_pagas);
  const administradora = textoCurto(body.administradora, 120);
  const tipoBem = normalizarTipoBem(body.tipo_bem);

  // O lance embutido não tem coluna na 0088. Em vez de inventar uma migration
  // no meio de uma fatia de front, ele entra em `observacao`, que é texto
  // livre e existe para isso. Coluna própria fica registrada como candidata.
  const lanceEmbutido = moedaParaNumero(body.lance_embutido);
  const observacao =
    lanceEmbutido !== null && lanceEmbutido > 0
      ? `lance embutido informado pelo cedente: ${lanceEmbutido}`
      : null;

  const chave = chaveOrigem("site", telefone);

  const supabase = createXtvClient();

  // Só manda o que veio. Campo ausente não pode virar `null` numa atualização
  // — quem preenche o formulário curto e depois o simulador tem de ENRIQUECER
  // a linha, nunca apagar o que já havia nela.
  const preenchidos: Record<string, unknown> = {};
  if (administradora !== null) preenchidos.administradora = administradora;
  if (credito !== null) preenchidos.credito = credito;
  if (saldoDevedor !== null) preenchidos.saldo_devedor = saldoDevedor;
  if (parcelasPagas !== null) preenchidos.parcelas_pagas = parcelasPagas;
  if (tipoBem !== null) preenchidos.tipo_bem = tipoBem;
  if (observacao !== null) preenchidos.observacao = observacao;

  const linha = {
    nome,
    telefone,
    origem: "site" as const,
    status: "novo" as const,
    origem_chave: chave,
    consentimento_em: new Date().toISOString(),
    ...preenchidos,
  };

  const { data, error } = await supabase
    .from("captacoes")
    .insert(linha)
    .select("id")
    .single();

  if (!error && data) {
    return NextResponse.json(
      { captacao_id: data.id, duplicado: false },
      { headers: corsHeaders(req) }
    );
  }

  // IDEMPOTÊNCIA. O índice único parcial da 0088 é o árbitro: se a mesma
  // pessoa já tem captação VIVA, o insert bate em 23505. Isso não é erro do
  // usuário — é o caminho normal de quem manda o formulário curto e depois o
  // simulador. Enriquecemos a linha existente e devolvemos o MESMO id.
  if (error?.code === CONFLITO_UNIQUE && chave) {
    const { data: existente, error: erroBusca } = await supabase
      .from("captacoes")
      .select("id")
      .eq("origem_chave", chave)
      .in("status", ["novo", "em_analise", "proposta_enviada", "aceita"])
      .maybeSingle();

    if (erroBusca || !existente) {
      console.error("[captacao] conflito sem linha correspondente:", erroBusca);
      return NextResponse.json(
        { erro: "Não foi possível registrar sua carta." },
        { status: 500, headers: corsHeaders(req) }
      );
    }

    if (Object.keys(preenchidos).length > 0) {
      const { error: erroUpdate } = await supabase
        .from("captacoes")
        .update(preenchidos)
        .eq("id", existente.id);
      if (erroUpdate) {
        // A linha existe e o contato está preservado; só o enriquecimento
        // falhou. Devolver 500 aqui faria a página dizer "não registramos"
        // sobre um lead que ESTÁ registrado — mentira pior que o defeito.
        console.error("[captacao] falha ao enriquecer captação:", erroUpdate);
      }
    }

    return NextResponse.json(
      { captacao_id: existente.id, duplicado: true },
      { headers: corsHeaders(req) }
    );
  }

  console.error("[captacao] erro ao criar captação:", error);
  return NextResponse.json(
    { erro: "Não foi possível registrar sua carta." },
    { status: 500, headers: corsHeaders(req) }
  );
}
