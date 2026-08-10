// ============================================================================
// POST /api/admin/farol/disparar — PAINEL-FAROL-01 item 3 (disparos manuais)
// AUTORIZADO: Emerson Gomes dos Santos — OS "PAINEL-FAROL-01", 08/08/2026:
// "botões para render agora, publicar agora (...) chamada server-side que
//  valida a sessão admin e injeta o segredo do lado do servidor — o segredo
//  NUNCA vai ao browser, e registro de quem disparou e quando".
// ----------------------------------------------------------------------------
// O SEGREDO NUNCA ATRAVESSA A REDE, NEM SEQUER PARA NÓS MESMOS. As rotas do
// FAROL exigem `Authorization: Bearer <FAROL_SECRET|CRON_SECRET>`
// (`autorizadoFarol`). O caminho óbvio seria esta rota fazer um fetch HTTP para
// a própria origem com esse header. Recusei, por quatro medições:
//
//   1. exigiria descobrir a base URL. `VERCEL_URL` muda a cada preview — as
//      libs do YouTube e do TikTok já documentam que NÃO a usam, pelo mesmo
//      motivo. Chutar domínio é como programar um 404 para daqui a um mês.
//   2. a proteção de deploy da Vercel intercepta requisição para preview e
//      devolve 307 — o disparo "funcionaria" em produção e falharia calado no
//      preview, que é exatamente onde se testa.
//   3. o segredo passaria a existir num header numa conexão de rede, ainda que
//      para nós mesmos. Em processo, ele não sai do heap.
//   4. um hop de rede a mais é uma cold start a mais dentro do orçamento de
//      invocação de uma rota que já é a mais cara da casa.
//
// Então a chamada é DIRETA: importo o handler `GET` do módulo da rota do FAROL
// e o executo com um `Request` sintético que carrega o Bearer. É o MESMO código
// que o cron executa — não um primo dele —, e é essa identidade que garante que
// o botão do painel e o cron das 11h30 não divirjam no primeiro ajuste.
//
// `maxDuration` = 180, o teto da rota mais cara que este arquivo pode invocar
// (reel-publicar: orçamento 45s + download 45s + upload ~20s + polling 40s).
// Chamar um handler de 180s de dentro de um de 60s garantiria timeout no meio
// de um upload — e upload cortado ao meio é a única forma de gravar uma URL que
// não toca.
//
// CONFIRMAÇÃO NOMINAL (item 3 da OS). O corpo tem de trazer a palavra exata, e
// ela é a MESMA que o botão manda: sem isso o disparo é 400. Não é enfeite de
// UI — a checagem que vale é esta, no servidor, porque `fetch` na consola do
// navegador não passa por botão nenhum. O item 4 da OS ("não publica sem
// confirmação nominal") só é verdade se ela for verificada aqui.
//
// REGISTRO DE AUTORIA. Todo disparo vira linha em `farol_posts` com
// acao='disparo_manual' — quem (e-mail da sessão), o quê, e o desfecho. É o
// diário do FAROL, o mesmo lugar onde o post e o reel se registram, então "o
// que o FAROL fez ontem?" continua sendo UMA consulta. O registro sai DEPOIS do
// disparo, com o resultado dentro: registrar antes narraria um disparo que
// pode não ter acontecido.
// ============================================================================
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { registrar } from "@/lib/farol/selecao";
// A palavra mora em lib/ e não aqui. Ela JÁ FOI exportada deste arquivo, o que
// é ilegal num route handler do Next — e passava no build só porque o import
// cruzado do /destravar tirava esta rota da geração de tipos. O header de
// `lib/farol/confirmacao.ts` traz a medição inteira.
import { PALAVRA_PUBLICAR as PALAVRA_CONFIRMACAO } from "@/lib/farol/confirmacao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

type Alvo = "render" | "publicar" | "pauta";

/**
 * O cardápio de disparos. Fechado de propósito: um `alvo` fora desta lista é
 * 400, e não uma tentativa de importar caminho arbitrário. Nenhuma destas rotas
 * arma, desarma ou apaga nada — são as três que o cron já executa sozinho.
 */
const ALVOS: Record<Alvo, { caminho: string; rotulo: string }> = {
  pauta: { caminho: "/api/farol/pauta", rotulo: "escrever pauta do dia" },
  render: { caminho: "/api/farol/reel-render", rotulo: "disparar render do reel" },
  publicar: { caminho: "/api/farol/reel-publicar", rotulo: "publicar o que estiver pronto" },
};

/**
 * Carrega o handler do alvo. `import()` dinâmico com caminho de um literal do
 * mapa acima — nunca de string do usuário.
 */
async function handlerDe(alvo: Alvo): Promise<(req: Request) => Promise<Response>> {
  if (alvo === "pauta") return (await import("@/app/api/farol/pauta/route")).GET;
  if (alvo === "render") return (await import("@/app/api/farol/reel-render/route")).GET;
  return (await import("@/app/api/farol/reel-publicar/route")).GET;
}

export async function POST(req: Request) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const corpo = (await req.json().catch(() => ({}))) as {
    alvo?: string;
    confirmacao?: string;
  };

  const alvo = corpo.alvo as Alvo | undefined;
  if (!alvo || !(alvo in ALVOS)) {
    return NextResponse.json({ erro: "alvo inválido." }, { status: 400 });
  }

  // A trava do item 4. Comparação exata, sem trim tolerante e sem
  // case-insensitive: "confirmação nominal" que aceita "publicar " ou "Publicar"
  // é confirmação que se digita por reflexo.
  if (corpo.confirmacao !== PALAVRA_CONFIRMACAO) {
    return NextResponse.json(
      { erro: `confirmação nominal ausente — digite ${PALAVRA_CONFIRMACAO}.` },
      { status: 400 }
    );
  }

  const secret = process.env.FAROL_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    // Sem segredo no ambiente, `autorizadoFarol` recusaria com 401 e o operador
    // veria "nao_autorizado" sem entender por quê. Diz o que falta.
    return NextResponse.json(
      { erro: "env ausente: FAROL_SECRET (ou CRON_SECRET) não está configurada." },
      { status: 503 }
    );
  }

  const { caminho, rotulo } = ALVOS[alvo];
  const db = createXtvClient();
  const inicio = Date.now();

  let status = 0;
  let resposta: unknown = null;
  let erro: string | null = null;

  try {
    const handler = await handlerDe(alvo);
    // Request sintético, com o Bearer injetado AQUI, no servidor. A URL é
    // derivada da requisição real só para o handler ter uma origem coerente;
    // nenhuma das três rotas lê query string.
    const url = new URL(caminho, new URL(req.url).origin);
    const r = await handler(
      new Request(url, {
        method: "GET",
        headers: { authorization: `Bearer ${secret}` },
      })
    );
    status = r.status;
    resposta = await r.json().catch(() => ({}));
  } catch (e) {
    erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[painel-farol] disparo estourou:", { alvo, erro });
  }

  const duracaoMs = Date.now() - inicio;

  // Diário: quem, o quê, quando, e o que voltou. `carta_id`/`post_id` nulos de
  // propósito — este evento é sobre o DISPARO, não sobre uma carta; amarrá-lo a
  // uma carta faria a memória antirrepetição (que lê por carta_id) enxergar um
  // clique como publicação.
  await registrar(db, "disparo_manual", null, null, {
    alvo,
    rotulo,
    por: acesso.email,
    user_id: acesso.userId ?? null,
    em: new Date().toISOString(),
    duracao_ms: duracaoMs,
    http: status,
    resposta,
    ...(erro ? { erro } : {}),
  });

  console.log("[painel-farol] disparo manual:", {
    alvo,
    por: acesso.email,
    http: status,
    duracao_ms: duracaoMs,
  });

  if (erro) return NextResponse.json({ ok: false, erro }, { status: 500 });

  // O veredito do alvo é repassado LITERAL, inclusive quando ele diz
  // "desarmado" ou "nada_pendente". Traduzir aqui criaria uma segunda verdade
  // sobre o mesmo fato.
  return NextResponse.json({ ok: status < 400, alvo, http: status, resposta });
}
