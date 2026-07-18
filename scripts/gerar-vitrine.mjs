#!/usr/bin/env node
// ============================================================================
// FASE 02 — Vitrine Viva: gera um snapshot estático (SSR) do estoque de
// cartas contempladas disponíveis, injetado em public/index.html entre os
// marcadores BC:SSR-COTAS-*/BC:SSR-LD-*. Roda via GitHub Actions (cron +
// workflow_dispatch, .github/workflows/atualizar-vitrine.yml). Node 20, zero
// dependências além do runtime (fetch nativo).
//
// Objetivo: crawlers (Google, LLMs) veem cartas reais no HTML puro, sem
// precisar executar JS. O JS client-side (cotasAoVivo()/render()/
// jsonLdCotas(), em public/index.html) continua rodando por cima no browser
// real e substitui esse conteúdo pelo mais recente assim que carrega — este
// script só preenche o "primeiro paint" / cenário sem JS. jsonLdCotas() já
// procura <script id="ldCotas"> por id e reaproveita o nó se existir, então
// a substituição do client é idempotente em cima do que este script grava.
//
// Fonte: vw_cartas_publicas (view pública, projeto xtv — espelho somente
// leitura de vw_vitrine_viva, sem colunas sensíveis) via REST direto
// (PostgREST), autenticado com a publishable key (env BIDCON_PUBLISHABLE_KEY,
// escopo anon/somente-leitura). Este script roda em CI, fora da Vercel, e
// NUNCA deve ter acesso de escrita — não usa service_role.
//
// Fail-safe: menos de MIN_CARTAS linhas retornadas → aborta (exit 1) sem
// tocar o arquivo — protege contra publicar uma vitrine "vazia"/degenerada
// por falha transitória da API. Só grava public/index.html se o conteúdo
// final for byte-a-byte diferente do atual (evita commit vazio no CI).
//
// Léxico (CLAUDE.md): nunca "investimento/rendimento/retorno/lucro/CDI";
// custo é sempre TIR ao mês, sempre enquadrado como referência de custo do
// crédito para quem compra — nunca promessa de retorno.
// ============================================================================

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO_INDEX = path.join(__dirname, "..", "public", "index.html");

const XTV_URL =
  process.env.BIDCON_XTV_URL || "https://xtvjpnyadcdeadhmzyff.supabase.co";
const PUBLISHABLE_KEY = process.env.BIDCON_PUBLISHABLE_KEY;

const MIN_CARTAS = 50; // fail-safe: abaixo disso, algo está errado na fonte
const LIMITE_SSR = 60; // mesmo teto do jsonLdCotas() client-side
const POR_PAGINA = 1000;
const MAX_LINHAS_SEGURANCA = 20000; // trava de paginação, nunca deve bater

const MARCA_COTAS_INICIO = "<!-- BC:SSR-COTAS-INICIO -->";
const MARCA_COTAS_FIM = "<!-- BC:SSR-COTAS-FIM -->";
const MARCA_LD_INICIO = "<!-- BC:SSR-LD-INICIO -->";
const MARCA_LD_FIM = "<!-- BC:SSR-LD-FIM -->";

function falhar(msg) {
  console.error(`[gerar-vitrine] ERRO: ${msg}`);
  process.exit(1);
}

if (!PUBLISHABLE_KEY) {
  falhar("faltou a env var BIDCON_PUBLISHABLE_KEY.");
}

// ---------------------------------------------------------------------------
// Fetch paginado de vw_cartas_publicas via PostgREST (header Range, estilo
// idêntico ao .range() usado em platform/app/api/vitrine/route.ts).
// ---------------------------------------------------------------------------
async function buscarCartas() {
  const linhas = [];
  let offset = 0;
  const campos =
    "ref,tipo,credito,entrada,parcela,parcelas,custo_am,administradora";
  for (;;) {
    // order: espelha EXATAMENTE o "order by custo_am asc nulls last,
    // credito asc" da RPC buscar_cartas (migration 0043) — mesmo desempate
    // (credito.asc, não .desc), com .nullslast explícito por segurança
    // mesmo sem custo_am nulo hoje. Único order= na URL (PostgREST ignora
    // um segundo order= duplicado — testado e confirmado ao vivo).
    const url = `${XTV_URL}/rest/v1/vw_cartas_publicas?select=${campos}&order=custo_am.asc.nullslast,credito.asc`;
    const resp = await fetch(url, {
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${PUBLISHABLE_KEY}`,
        "Range-Unit": "items",
        Range: `${offset}-${offset + POR_PAGINA - 1}`,
      },
    });
    if (!resp.ok) {
      falhar(
        `REST retornou ${resp.status} ${resp.statusText} (offset ${offset}).`
      );
    }
    const pagina = await resp.json();
    if (!Array.isArray(pagina)) {
      falhar(`resposta inesperada da API no offset ${offset} (não é array).`);
    }
    linhas.push(...pagina);
    if (pagina.length < POR_PAGINA) break;
    offset += POR_PAGINA;
    if (offset > MAX_LINHAS_SEGURANCA) {
      falhar(`paginação passou de ${MAX_LINHAS_SEGURANCA} linhas — abortando.`);
    }
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Helpers de formatação — espelham exatamente as funções equivalentes no
// client-side (BRL/refCota/ic/jsonLdCotas em public/index.html) pra o SSR e
// o client produzirem o mesmíssimo formato quando o JS substitui por cima.
// ---------------------------------------------------------------------------
const BRL = (v) => "R$ " + Math.round(v).toLocaleString("pt-BR");

function refCota(n) {
  if (n == null) return "";
  const s = String(n);
  if (/^-?\d+$/.test(s)) {
    const num = Number(s);
    return num > 0 ? `nº ${s}` : `ref. ${("000" + Math.abs(num || 0)).slice(-3)}`;
  }
  return `nº ${s}`;
}

function escHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const ICONS = {
  casa: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9.5h14V10"/><path d="M9.5 19.5v-5h5v5"/>',
  carro:
    '<path d="M5 16.5h14M4 16.5v-3.2l1.8-4.3A2 2 0 0 1 7.6 7.7h8.8a2 2 0 0 1 1.8 1.3L20 13.3v3.2"/><circle cx="7.5" cy="16.5" r="1.6"/><circle cx="16.5" cy="16.5" r="1.6"/>',
};
function ic(nome) {
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[nome] || ""}</svg>`;
}

// ---------------------------------------------------------------------------
// Card estático — mesmas classes CSS do card client-side (renderMarket(),
// em public/index.html), só sem os elementos interativos (onclick/handlers
// que dependem de JS ainda não carregado nesse ponto do carregamento).
// Campos expostos: tipo, crédito, entrada, parcela×n, custo a.m.,
// administradora — sempre exposta (regra de negócio canônica, CLAUDE.md).
// ---------------------------------------------------------------------------
function cardHtml(c, i) {
  const tipoImovel = c.tipo === "imovel";
  const custoLinha =
    typeof c.custo_am === "number" && c.custo_am > 0
      ? `<div class="ccusto"><span class="l">Custo efetivo</span><span class="v">TIR ${c.custo_am
          .toFixed(2)
          .replace(".", ",")}% a.m. · custo efetivo (referência)</span></div>`
      : "";
  const admLinha = c.administradora
    ? `<div class="cadm"><span class="l">Administradora</span><span class="v">${escHtml(
        c.administradora
      )}</span></div>`
    : "";
  const parcelasLabel = c.parcelas
    ? ` <span style="font-size:9px;color:var(--cinza2)">(${c.parcelas}×)</span>`
    : "";
  const parcelasMes = c.parcelas
    ? '<span style="font-size:11px;color:var(--cinza)">/mês</span>'
    : "";
  return `<div class="ccard bc-card ${tipoImovel ? "imovel" : "veiculo"}" id="item-${i + 1}">
      <div class="ctop">
        <span class="ccat"><span class="emo">${ic(
          tipoImovel ? "casa" : "carro"
        )}</span>${tipoImovel ? "Imóvel" : "Automóvel"}</span>
        <span class="cnum">${refCota(c.ref)}</span>
      </div>
      <div class="ccredito"><div class="l">Crédito contemplado</div><div class="v bc-mono bc-credito-grad">${BRL(
        c.credito
      )}</div></div>
      ${admLinha}
      <div class="crows">
        <div class="crow2"><div class="l">Entrada</div><div class="v">${BRL(
          c.entrada
        )}</div></div>
        <div class="crow2"><div class="l">Parcela${parcelasLabel}</div><div class="v">${BRL(
          c.parcela
        )}${parcelasMes}</div></div>
      </div>
      ${custoLinha}
    </div>`;
}

// ---------------------------------------------------------------------------
// ItemList JSON-LD — mesmo formato de jsonLdCotas() (client-side), pro
// <script id="ldCotas"> ficar equivalente nos dois lados (o que o SSR grava
// e o que o JS regrava por cima assim que carrega).
// ---------------------------------------------------------------------------
// REGRA INEGOCIÁVEL DOS 7%: `price` é a entrada exatamente como vem de
// vw_cartas_publicas (c.entrada) — o valor gravado JÁ inclui a
// intermediação de 7% (entradas = pedido redondo do vendedor + 0,07×
// crédito). Proibido somar comissão de novo ou "descontar" aqui.
// price sai como STRING (.toFixed(2)), não Number: JSON.stringify de um
// Number não preserva zeros decimais (27000.00 vira "27000" no texto do
// JSON) — string é o formato que o Google Merchant aceita pra manter as
// 2 casas.
function itemListJsonLd(cartas) {
  const itens = cartas.map((c, i) => {
    const tipoLabel = c.tipo === "imovel" ? "Imóvel" : "Veículo";
    const url = `https://www.bidcon.com.br/#item-${i + 1}`;
    const produto = {
      "@type": "Product",
      name: `Carta de crédito contemplada — ${tipoLabel} ${BRL(c.credito)}`,
      category: tipoLabel,
      image: "https://www.bidcon.com.br/img/bidcon-og-banner.png",
      url,
      offers: {
        "@type": "Offer",
        priceCurrency: "BRL",
        price: Number(c.entrada).toFixed(2),
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
        url,
        seller: {
          "@type": "Organization",
          name: "Bidcon — Prospere Consórcios",
          url: "https://www.bidcon.com.br",
        },
        itemOffered: {
          "@type": "Service",
          name: "Assunção de cota de consórcio já contemplada",
        },
      },
      additionalProperty: [
        {
          "@type": "PropertyValue",
          name: "Poder de compra (carta de crédito)",
          value: BRL(c.credito),
        },
        {
          "@type": "PropertyValue",
          name: "Entrada para assumir",
          value: BRL(c.entrada),
        },
        { "@type": "PropertyValue", name: "Situação", value: "Contemplada" },
      ],
    };
    if (c.administradora) {
      produto.additionalProperty.push({
        "@type": "PropertyValue",
        name: "Administradora",
        value: c.administradora,
      });
    }
    return { "@type": "ListItem", position: i + 1, item: produto };
  });
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Cotas de consórcio contempladas disponíveis na Bidcon",
    numberOfItems: itens.length,
    itemListElement: itens,
  };
}

// ---------------------------------------------------------------------------
// Monta o bloco entre os marcadores de cotas: linha de stats (total +
// atualizado em) seguida dos cards estáticos.
// ---------------------------------------------------------------------------
function blocoCotas(totalCartas, cartasParaCard) {
  const agora = new Date();
  const dataHora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(agora);
  const statsLinha = `<div class="csrc" style="grid-column:1/-1">${totalCartas} cartas disponíveis · atualizado ${dataHora}</div>`;
  const cards = cartasParaCard.map((c, i) => cardHtml(c, i)).join("\n      ");
  return `${statsLinha}\n      ${cards}`;
}

function substituirEntreMarcas(conteudo, inicio, fim, novoTrecho) {
  const i = conteudo.indexOf(inicio);
  const f = conteudo.indexOf(fim);
  if (i === -1 || f === -1 || f < i) {
    falhar(
      `marcadores ${inicio} / ${fim} não encontrados (ou fora de ordem) em public/index.html.`
    );
  }
  const antes = conteudo.slice(0, i + inicio.length);
  const depois = conteudo.slice(f);
  return `${antes}\n${novoTrecho}\n${depois}`;
}

// ---------------------------------------------------------------------------
async function main() {
  console.log("[gerar-vitrine] buscando vw_cartas_publicas...");
  const todas = (await buscarCartas()).filter((c) => Number(c.credito) > 0);
  console.log(
    `[gerar-vitrine] ${todas.length} cartas disponíveis (filtro credito>0).`
  );

  if (todas.length < MIN_CARTAS) {
    falhar(
      `só ${todas.length} cartas retornadas (mínimo ${MIN_CARTAS}) — abortando sem tocar o arquivo.`
    );
  }

  // Sem re-sort local: `todas` já vem ordenada pelo fetch (custo_am.asc,
  // credito.asc, espelhando a RPC). Um resort JS aqui foi a causa raiz de
  // uma divergência real entre a ordem pedida na query e o que saía no
  // snapshot — fonte única de ordenação é a API/banco, não duas.
  const paraCards = todas.slice(0, LIMITE_SSR);

  const original = await readFile(ARQUIVO_INDEX, "utf8");

  let atualizado = substituirEntreMarcas(
    original,
    MARCA_COTAS_INICIO,
    MARCA_COTAS_FIM,
    blocoCotas(todas.length, paraCards)
  );

  const ld = itemListJsonLd(paraCards);
  const ldJson = JSON.stringify(ld).replace(/</g, "\\u003c");
  atualizado = substituirEntreMarcas(
    atualizado,
    MARCA_LD_INICIO,
    MARCA_LD_FIM,
    `<script type="application/ld+json" id="ldCotas">${ldJson}</script>`
  );

  if (atualizado === original) {
    console.log("[gerar-vitrine] sem diff — nada a gravar.");
    return;
  }

  await writeFile(ARQUIVO_INDEX, atualizado, "utf8");
  console.log(
    `[gerar-vitrine] public/index.html atualizado (${paraCards.length} cards estáticos de ${todas.length} cartas no total).`
  );
}

main().catch((err) => falhar(err?.stack || String(err)));
