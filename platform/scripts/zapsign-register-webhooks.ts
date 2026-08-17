// ============================================================================
// BIDCON-ASSINATURA-01 — registro dos webhooks da ZapSign.
// ----------------------------------------------------------------------------
// NÃO é rota. Não sobe no build do Next, não tem endpoint, não roda sozinho.
// É ferramenta de operação, executada à mão com as envs carregadas:
//
//   vercel env pull .env.local           # traz token + segredo pro worktree
//   npx tsx --tsconfig tsconfig.test.json scripts/zapsign-register-webhooks.ts
//   npx tsx --tsconfig tsconfig.test.json scripts/zapsign-register-webhooks.ts --aplicar
//
// SEM --aplicar ele não escreve NADA: sonda, imprime o plano e sai. O padrão é
// o modo que não pode estragar nada.
//
// POR QUE ESTE SCRIPT EXISTE:
// os webhooks criados pelo painel da ZapSign vão SEM header. Um webhook sem
// header aponta para o nosso endpoint público e não carrega o segredo — ou
// seja, todo evento que ele entrega é recusado com 401 pela rota (que não tem
// modo tolerante, e não deve ter). Além de inútil, é ruído: a ZapSign fica
// reenviando para sempre. Este script troca os sem-header por webhooks com
// `x-webhook-signature`.
//
// ⚠️ LIMITE MEDIDO — LEIA ANTES DE CONFIAR NA IDEMPOTÊNCIA:
// a API pública da ZapSign documenta CRIAR e DELETAR webhook, e NÃO documenta
// listar. Conferido em três fontes independentes (13/08/2026):
//   1. índice oficial docs.zapsign.com.br/llms.txt — 77 entradas de webhook em
//      3 idiomas: "Criar webhook" e "Deletar webhook", nenhuma de listar;
//   2. página "Criar webhook", consultada diretamente: não menciona GET;
//   3. MCP oficial da própria ZapSign (github.com/ZapSign/api-mcp): expõe
//      create_webhook, delete_webhook, create_webhook_header,
//      delete_webhook_header — e nenhum list_webhooks.
// Endpoints medidos:
//   criar:   POST   {base}/user/company/webhook/        body {url, type, headers}
//   deletar: DELETE {base}/user/company/webhook/delete/ body {id}
//
// CONSEQUÊNCIA HONESTA: sem listagem não há como saber o que já existe, e o
// delete exige um `id` que só a listagem daria. Então o script SONDA o GET não
// documentado (mesmo path do POST — é o padrão de um router REST, pode existir
// sem estar na doc). Se responder, o ciclo é completo e idempotente de verdade.
// Se não responder, o script NÃO finge: ele para e manda remover os antigos
// pelo painel, que é onde eles foram criados. Idempotência que depende de um
// endpoint que talvez não exista não é idempotência, é torcida.
// ============================================================================

/** Eventos que a fatia realmente consome. Medidos na doc como válidos. */
const EVENTOS = ["doc_created", "doc_signed", "doc_refused"] as const;

const NOME_HEADER = "x-webhook-signature";

type WebhookZapSign = {
  id?: unknown;
  url?: unknown;
  type?: unknown;
  headers?: unknown;
};

// --- entrada -----------------------------------------------------------------

function env(nome: string): string {
  return (process.env[nome] ?? "").trim();
}

/** Barra final não pode decidir se duas URLs são "a mesma". */
function normalizarUrl(u: string): string {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

const token = env("ZAPSIGN_API_TOKEN");
const base = (env("ZAPSIGN_API_URL") || "https://api.zapsign.com.br/api/v1").replace(/\/+$/, "");
const segredo = env("ZAPSIGN_WEBHOOK_SECRET");
const nossaUrl = env("ASSINATURA_WEBHOOK_URL");

const aplicar = process.argv.includes("--aplicar");
const forcarCriar = process.argv.includes("--forcar-criar");

// Falta de env é erro de operação, não de código: falha na cara, antes de tocar
// na rede. O VALOR do segredo nunca é impresso — só se está presente ou não.
const faltando = [
  ["ZAPSIGN_API_TOKEN", token],
  ["ZAPSIGN_WEBHOOK_SECRET", segredo],
  ["ASSINATURA_WEBHOOK_URL", nossaUrl],
].filter(([, v]) => !v);

if (faltando.length > 0) {
  console.error("Envs ausentes:", faltando.map(([n]) => n).join(", "));
  console.error("Rode `vercel env pull .env.local` e exporte antes de executar.");
  process.exit(1);
}

// --- chamadas ao provedor ----------------------------------------------------

async function chamar(
  metodo: string,
  caminho: string,
  corpo?: unknown
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

/**
 * Tenta listar. Devolve null quando o endpoint não existe — que é diferente de
 * devolver [] (nenhum webhook cadastrado). Confundir os dois faria o script
 * criar duplicata achando que não havia nada.
 */
async function listar(): Promise<WebhookZapSign[] | null> {
  try {
    const r = await chamar("GET", "/user/company/webhook/");
    if (!r.ok) return null;
    if (Array.isArray(r.json)) return r.json as WebhookZapSign[];
    // Alguns routers devolvem { results: [...] } com paginação.
    const o = r.json as Record<string, unknown> | null;
    if (o && Array.isArray(o.results)) return o.results as WebhookZapSign[];
    return null;
  } catch {
    return null;
  }
}

/** true se o webhook já carrega o nosso header com o valor corrente. */
function temNossoHeader(w: WebhookZapSign): boolean {
  const hs = Array.isArray(w.headers) ? w.headers : [];
  return hs.some((h) => {
    const o = (h ?? {}) as Record<string, unknown>;
    return (
      String(o.name ?? "").toLowerCase() === NOME_HEADER &&
      String(o.value ?? "") === segredo
    );
  });
}

async function criar(tipo: string): Promise<void> {
  const r = await chamar("POST", "/user/company/webhook/", {
    url: nossaUrl,
    type: tipo,
    headers: [{ name: NOME_HEADER, value: segredo }],
  });
  if (!r.ok) {
    // O corpo do erro pode ecoar o header que acabamos de mandar — ou seja, o
    // segredo. Só o status sai no log.
    console.error(`  ✗ criar ${tipo}: HTTP ${r.status}`);
    return;
  }
  const id = (r.json as Record<string, unknown> | null)?.id;
  console.log(`  ✓ criado ${tipo}${id === undefined ? "" : ` (id ${String(id)})`}`);
}

async function deletar(id: unknown, tipo: string): Promise<void> {
  const r = await chamar("DELETE", "/user/company/webhook/delete/", { id });
  console.log(
    r.ok
      ? `  ✓ removido sem-header ${tipo} (id ${String(id)})`
      : `  ✗ remover id ${String(id)}: HTTP ${r.status}`
  );
}

// --- fluxo -------------------------------------------------------------------

async function principal(): Promise<void> {
  console.log(`base .......... ${base}`);
  console.log(`webhook url ... ${nossaUrl}`);
  // Nem o valor NEM o comprimento: seguranca.ts passa os dois lados por sha256
  // justamente para o tamanho do segredo não escapar. Imprimir `.length` aqui
  // desfaria isso num terminal que vira screenshot ou paste.
  console.log(`segredo ....... presente`);
  console.log(`modo .......... ${aplicar ? "APLICAR (escreve)" : "sondagem (não escreve)"}`);
  console.log("");

  const lista = await listar();

  // --- caminho B: sem listagem ---------------------------------------------
  if (lista === null) {
    console.log("Listagem de webhooks: INDISPONÍVEL nesta API.");
    console.log("(esperado — a ZapSign não documenta esse endpoint; ver cabeçalho)");
    console.log("");

    if (!forcarCriar) {
      console.log("O script PARA aqui de propósito. Sem listar, ele não sabe o que");
      console.log("já existe, e criar às cegas duplicaria os webhooks a cada rodada.");
      console.log("");
      console.log("Faça nesta ordem:");
      console.log("  1. no painel da ZapSign, remova os webhooks desta URL que estão");
      console.log("     SEM header (os criados pelo painel hoje);");
      console.log("  2. rode de novo com --aplicar --forcar-criar para criar os 3");
      console.log("     com header;");
      console.log("  3. confira no painel: 3 com header, zero sem.");
      process.exit(2);
    }

    if (!aplicar) {
      console.log("Plano (--forcar-criar sem --aplicar, nada será escrito):");
      for (const t of EVENTOS) console.log(`  + criaria ${t} com ${NOME_HEADER}`);
      return;
    }

    console.log("Criando (confiando que você já limpou os antigos no painel):");
    for (const t of EVENTOS) await criar(t);
    return;
  }

  // --- caminho A: com listagem, idempotente de verdade ----------------------
  const nossos = lista.filter(
    (w) => normalizarUrl(String(w.url ?? "")) === normalizarUrl(nossaUrl)
  );
  const semHeader = nossos.filter((w) => !temNossoHeader(w));
  const comHeader = nossos.filter((w) => temNossoHeader(w));
  const jaCobertos = new Set(comHeader.map((w) => String(w.type ?? "")));
  const aCriar = EVENTOS.filter((t) => !jaCobertos.has(t));

  console.log(`webhooks nesta URL .......... ${nossos.length}`);
  console.log(`  com ${NOME_HEADER} ... ${comHeader.length}`);
  console.log(`  sem header ................ ${semHeader.length}`);
  console.log("");

  if (semHeader.length === 0 && aCriar.length === 0) {
    console.log("Nada a fazer: os 3 eventos já estão cobertos com header.");
    return;
  }

  if (!aplicar) {
    console.log("Plano (sondagem — nada será escrito):");
    for (const w of semHeader) {
      console.log(`  - removeria ${String(w.type ?? "?")} (id ${String(w.id ?? "?")}) — sem header`);
    }
    for (const t of aCriar) console.log(`  + criaria ${t} com ${NOME_HEADER}`);
    console.log("");
    console.log("Rode de novo com --aplicar para executar.");
    return;
  }

  // Remove ANTES de criar: se criasse primeiro e o delete falhasse, a URL
  // ficaria com os dois — e o sem-header continuaria batendo 401 na rota.
  for (const w of semHeader) await deletar(w.id, String(w.type ?? "?"));
  for (const t of aCriar) await criar(t);

  console.log("");
  console.log("Confira no painel antes de disparar o envelope de teste.");
}

principal().catch((e) => {
  console.error("Falhou:", e instanceof Error ? e.message : e);
  process.exit(1);
});
