// ============================================================================
// FIDC-OFERTAS-01 · Entrega 2 — A GUARDA DO FUNDO.
// ----------------------------------------------------------------------------
// Quem entra em /fundo, e como o "não" é dito.
//
// A ordem manda: "magic link restrito aos e-mails do fundo; role própria —
// jamais enxerga /admin". Esta é a role própria. Ela não é um papel novo em
// `profiles.tipo` (isso mexeria no nnv e no trigger de cadastro); é uma segunda
// pergunta feita DEPOIS da sessão: "este e-mail está na lista de algum fundo?"
//
// A LISTA MORA NO BANCO, NÃO NUMA ENV VAR — e isso é decisão, não gosto.
// `lib/admin-console.ts` lê `BIDCON_ADMIN_EMAILS` do ambiente, e para o console
// da casa está certo: a lista muda uma vez por ano. Aqui não. A Entrega 4 promete
// um botão "suspender fundo", e um botão que só faz efeito depois de um REDEPLOY
// é um botão que mente. `fidc_fundos.emails_autorizados` e `fidc_fundos.status`
// já existem na 0078 exatamente para isto: suspender passa a valer na próxima
// leitura de página.
//
// ----------------------------------------------------------------------------
// TRÊS DECISÕES QUE SE PAGAM, cada uma com o seu porquê medido.
//
// (1) A CONSULTA NÃO FILTRA POR `status`, DE PROPÓSITO.
//     O índice `fidc_fundos_status_idx` é parcial (`where status='ativo'`) e
//     estava ali para ser usado. Não uso. Se a consulta filtrasse, um fundo
//     suspenso voltaria ZERO linhas — indistinguível de um e-mail que nunca foi
//     cadastrado —, e a pessoa leria "não autorizado" quando a verdade é "seu
//     fundo está suspenso". São duas frases diferentes porque são dois problemas
//     diferentes: um vira ligação para o suporte, o outro vira conversa com a
//     coordenação. O `fidc_fundos_emails_idx` (GIN sobre o array) é quem faz o
//     trabalho seletivo de verdade; o filtro de status pouparia uma linha numa
//     tabela de dezenas. Troquei um índice por uma frase honesta.
//
// (2) COMPARAÇÃO EM MINÚSCULAS — E O MODO DE FALHAR É NEGAR.
//     A 0078 registra que a aplicação grava em minúsculas (desvio (d)). Se um dia
//     alguém inserir "Fundo@X.com" pelo console SQL, o `.contains()` com o e-mail
//     minúsculo NÃO vai casar e a pessoa fica de fora. É falso-negativo: um
//     chamado de suporte. O inverso — casar demais — seria falso-positivo: um
//     estranho dentro do painel. Entre os dois modos de errar, esta guarda erra
//     para o lado de negar, sempre.
//
// (3) E-MAIL EM DOIS FUNDOS RECUSA, EM VEZ DE ESCOLHER.
//     Nada no banco impede o mesmo e-mail em duas listas. Ninguém opera como dois
//     fundos ao mesmo tempo, então "pegar o primeiro" seria inventar uma resposta
//     para uma pergunta ambígua — e a oferta sairia assinada pelo fundo errado,
//     calada. Recusa, nomeando o defeito de cadastro para que ele seja corrigido.
//
// ----------------------------------------------------------------------------
// /admin CONTINUA HERMÉTICO SEM UMA LINHA A MAIS, e isto foi MEDIDO:
// toda página sob /admin chama `exigirPapel("admin")` (lê `profiles.tipo` no nnv,
// sob RLS) ou `exigirAdminConsolePagina()` (allowlist de env). O usuário de um
// fundo nasce `tipo='cliente'` pelo trigger de cadastro e não está em
// BIDCON_ADMIN_EMAILS — as duas guardas o mandam para "/". Não há bloqueio novo a
// escrever aqui; há a ausência de qualquer atalho. Esta guarda NÃO concede nada
// fora de /fundo, e nenhuma rota de /admin consulta este arquivo.
//
// O KILL-SWITCH DESARMADO RESPONDE 404, NÃO 403. Desligado, o painel não existe:
// 403 contaria a quem perguntasse que existe um /fundo esperando ser ligado.
// ============================================================================
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { ofertasLigado } from "@/lib/fidc-ofertas";

/**
 * O recorte de `fidc_fundos` que a guarda precisa — e SÓ ele.
 *
 * Sem cnpj, sem contato, sem observação: coluna que não é selecionada não vaza
 * por descuido de quem for montar um payload depois.
 */
export type FundoLinha = {
  id: string;
  nome: string;
  status: string | null;
  emails_autorizados: string[] | null;
};

/** O que o painel recebe quando o acesso é concedido. */
export type FundoSessao = { id: string; nome: string };

/**
 * `email` vem junto no veredito de propósito.
 *
 * `fidc_ofertas.criado_por_email` é NOT NULL: toda oferta nasce assinada. Se o
 * e-mail não viesse aqui, quem cria a oferta teria de perguntar a sessão outra
 * vez — e duas leituras da mesma identidade é a chance de gravar autoria de uma
 * sessão diferente da que passou pela guarda. O e-mail que autorizou é o e-mail
 * que assina, e é o mesmo objeto.
 *
 * Vem NORMALIZADO (minúsculas, sem espaço), que é a forma com que foi comparado
 * contra a allowlist: assinar com uma grafia e autorizar por outra tornaria o
 * histórico difícil de casar consigo mesmo.
 */
export type AcessoFundo =
  | { ok: true; fundo: FundoSessao; email: string }
  | { ok: false; status: 401 | 403 | 404; motivo: string };

/** Minúsculas e sem espaço nas pontas. Vazio vira string vazia, não `null`. */
export function normalizarEmail(email: string | null | undefined): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * A DECISÃO, pura: dadas as linhas que o banco devolveu e o e-mail da sessão,
 * quem entra e — quando não entra — por quê.
 *
 * Pura de propósito: uma regra de acesso que só pode ser exercitada com rede,
 * sessão e banco de pé é uma regra que ninguém testa nas bordas. As bordas aqui
 * são justamente as que importam (suspenso, lista vazia, dois fundos).
 *
 * Reconfere a pertinência do e-mail em vez de confiar no `.contains()` que a
 * trouxe. Não é desconfiança do Postgres: é que a consulta e a decisão podem se
 * separar amanhã — alguém passa uma lista vinda de cache, de teste ou de um
 * `select *` mais largo — e a decisão precisa continuar correta sozinha.
 */
export function decidirAcesso(
  candidatos: FundoLinha[],
  email: string | null | undefined
): AcessoFundo {
  const alvo = normalizarEmail(email);
  if (!alvo) {
    return { ok: false, status: 403, motivo: "sessão sem e-mail" };
  }

  const pertinentes = candidatos.filter((f) =>
    (f.emails_autorizados ?? []).some((e) => normalizarEmail(e) === alvo)
  );

  if (pertinentes.length === 0) {
    // Uma única frase para "nunca foi cadastrado" e para "foi removido da
    // lista": do lado de fora, os dois casos são o mesmo fato — este e-mail não
    // responde por fundo nenhum. Detalhar aqui só ensinaria quem sonda.
    return {
      ok: false,
      status: 403,
      motivo: "e-mail não autorizado em nenhum fundo",
    };
  }

  if (pertinentes.length > 1) {
    return {
      ok: false,
      status: 403,
      motivo:
        "e-mail autorizado em mais de um fundo — o cadastro precisa ser " +
        "corrigido antes da entrada",
    };
  }

  const fundo = pertinentes[0];
  if (fundo.status !== "ativo") {
    return { ok: false, status: 403, motivo: "fundo suspenso" };
  }

  return { ok: true, fundo: { id: fundo.id, nome: fundo.nome }, email: alvo };
}

/**
 * A CONSULTA, impura: quais fundos trazem este e-mail na lista.
 *
 * `.contains()` vira o operador de array-contém (`@>`) e usa o
 * `fidc_fundos_emails_idx` (GIN), medido no banco. Sem filtro de status — ver
 * decisão (1) no cabeçalho.
 *
 * Erro de banco NÃO vira lista vazia: lista vazia significa "este e-mail não é
 * de fundo nenhum", e essa é uma afirmação que a guarda só pode fazer se de fato
 * perguntou. Falha de leitura propaga.
 */
export async function buscarFundosDoEmail(email: string): Promise<FundoLinha[]> {
  const alvo = normalizarEmail(email);
  if (!alvo) return [];

  const supabase = createXtvClient();
  const { data, error } = await supabase
    .from("fidc_fundos")
    .select("id,nome,status,emails_autorizados")
    .contains("emails_autorizados", [alvo]);

  if (error) throw error;
  return (data ?? []) as unknown as FundoLinha[];
}

/**
 * Versão Route Handler: sem redirect, devolve o union para a rota decidir o HTTP.
 * Mesmo formato de `checarAdminConsoleApi()`, com um estado a mais — 404 quando
 * o kill-switch está desarmado.
 */
export async function checarFundoApi(): Promise<AcessoFundo> {
  if (!ofertasLigado()) {
    return { ok: false, status: 404, motivo: "não encontrado" };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, motivo: "não autenticado" };

  const fundos = await buscarFundosDoEmail(user.email ?? "");
  return decidirAcesso(fundos, user.email);
}

/**
 * Versão Server Component: exige sessão + e-mail de fundo ativo, senão sai daqui.
 *
 * Desarmado -> `notFound()`. Sem sessão -> /login (igual ao console admin, sem
 * `next`: a página de login da casa não trata esse parâmetro). Recusado -> "/".
 *
 * Devolve também o e-mail e o nome do perfil porque o AppShell os pede, e uma
 * segunda consulta ao nnv só para isso seria latência paga duas vezes.
 */
export async function exigirFundoPagina(): Promise<{
  fundo: FundoSessao;
  email: string;
  nome: string | null;
}> {
  if (!ofertasLigado()) notFound();

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fundos = await buscarFundosDoEmail(user.email ?? "");
  const veredito = decidirAcesso(fundos, user.email);
  if (!veredito.ok) redirect("/");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nome")
    .eq("id", user.id)
    .maybeSingle();

  return {
    fundo: veredito.fundo,
    email: user.email as string,
    nome: perfil?.nome ?? user.email ?? null,
  };
}
