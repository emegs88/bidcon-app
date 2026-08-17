#!/usr/bin/env node
// ============================================================================
// guarda-ramo.mjs — recusa commit em ramo que já foi mesclado na main
// ----------------------------------------------------------------------------
// AUTORIZADO: Emerson Gomes dos Santos — OS "GUARDA-RAMO-01", 17/08/2026.
//
// POR QUE ESTE ARQUIVO EXISTE, e a resposta é humilhante: a regra já estava
// escrita e falhou assim mesmo, duas vezes.
//
//   14/08  aaa05f4  commitei FIDC-PENEIRA-01 em `fidc-ofertas-02`, cujo PR #35
//                   tinha fechado 74 minutos antes. O commit nasceu órfão.
//   16/08  4bc2307  commitei RADAR-03 em `sentinela-radar-01`, cujo PR #39 já
//                   tinha fechado. UM DIA depois de a regra entrar no
//                   CLAUDE.md pelo PR #37.
//
// Regra escrita que falha duas vezes não é regra: é um comentário que promete.
// O padrão desta casa — o teste que morde vale mais que o comentário que
// promete — passa a valer para o processo da casa também, e não só para o
// código dela. Daí este script.
//
// O QUE ELE MEDE, EM UMA LINHA
//     git merge-base --is-ancestor HEAD origin/main
// Se HEAD é ancestral da main, tudo que este ramo tinha para dizer a main já
// ouviu. O ramo acabou. Commit novo aqui fica pendurado 1 à frente de um ramo
// morto, sem PR, e NADA AVISA: `tsc`, testes e build passam os três, porque o
// defeito não é de código. É a classe de erro mais cara desta casa — a que
// passa no próprio exame (mesma família do "sync saudável que não move nada").
//
// O SEGUNDO PORTÃO: A DISTÂNCIA
// Portão rodado em ramo atrasado não é portão. No incidente de 14/08 os três
// portões passaram numa árvore 26 commits atrás e eu reportei 745/745; refeitos
// em ramo nascido da main, 892/892 — 147 testes que eu simplesmente não tinha
// rodado. Verde contra o passado não diz nada sobre o presente.
//
// Mas contagem pura é instrumento cego: a main recebe `chore(vitrine): snapshot
// automático` o dia inteiro, e estar 3 atrás por causa deles não atrasa portão
// nenhum. Por isso a distância é medida DUAS vezes: quantos commits, e quantos
// deles tocam `platform/` — que é a única árvore que os portões enxergam. O
// aviso que importa é o segundo.
//
// FETCH É OBRIGATÓRIO, E FALHA DE FETCH RECUSA
// `origin/main` é CACHE, não medição: só muda quando alguém roda `fetch`, e
// entre um fetch e outro aponta para o passado sem avisar. Foi assim o erro do
// PR #9 ("9 commits à frente" lido de um retrato velho; o número certo era 4 à
// frente e 2 atrás). Então este script roda `fetch` ele mesmo, e se o fetch
// falhar ele RECUSA em vez de medir o cache — porque medir o cache e passar é
// exatamente o verde que não grita.
//
// Por cima do fetch, confere contra `git ls-remote`, que lê o servidor e não
// tem cache nenhum. É o padrão-ouro que o CLAUDE.md manda usar.
//
// O QUE ELE NÃO FAZ
// Não instala a si mesmo. Ligar o hook exige `git config core.hooksPath`, e
// esta casa proíbe o agente de escrever em `git config` — quem liga é o
// Emerson, com a linha que o `--como-ligar` imprime. Também não abre PR, não
// cria ramo e não mexe em commit nenhum: ele mede, fala e sai.
// ============================================================================

import { spawnSync } from "node:child_process";

const BASE = process.env.GUARDA_RAMO_BASE ?? "main";
const REMOTO = process.env.GUARDA_RAMO_REMOTO ?? "origin";
/** Acima disto, a distância vira aviso. Só conta commit que toca `platform/`. */
const N_ATRASO = Number(process.env.GUARDA_RAMO_N ?? 1);

const args = new Set(process.argv.slice(2));
const ESTRITO = args.has("--estrito");
const SEM_FETCH = args.has("--sem-fetch");

const REF_BASE = `${REMOTO}/${BASE}`;

function git(...argv) {
  const r = spawnSync("git", argv, { encoding: "utf8" });
  return {
    ok: r.status === 0,
    status: r.status,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
  };
}

function recusar(titulo, linhas) {
  console.error(`\n[guarda-ramo] RECUSADO — ${titulo}\n`);
  for (const l of linhas) console.error(`  ${l}`);
  console.error("");
  process.exit(1);
}

if (args.has("--como-ligar")) {
  console.log(`
[guarda-ramo] para ligar como hook de pre-commit, UMA linha:

    git config core.hooksPath .githooks

Ela precisa da mão do Emerson: o agente nao escreve em git config.
Para conferir depois:  git config --get core.hooksPath
Para desligar:         git config --unset core.hooksPath

Para pular a guarda em um commit especifico (e o pulo fica no reflog):
    git commit --no-verify
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. ONDE EU ESTOU
// ---------------------------------------------------------------------------

if (!git("rev-parse", "--git-dir").ok) {
  recusar("isto nao e um repositorio git", ["`git rev-parse --git-dir` falhou."]);
}

const ramo = git("rev-parse", "--abbrev-ref", "HEAD").out;

// HEAD solto e ramo orfao por definicao: o commit nasce sem nome e some do
// alcance de qualquer PR assim que alguem trocar de ramo.
if (ramo === "HEAD") {
  recusar("HEAD solto (detached)", [
    "Commit em HEAD solto nao pertence a ramo nenhum e some no proximo checkout.",
    "",
    "RECEITA:  git switch -c <nome-do-ramo>",
  ]);
}

const cabeca = git("rev-parse", "HEAD").out;

// ---------------------------------------------------------------------------
// 2. MEDIR O REMOTO — nunca o cache
// ---------------------------------------------------------------------------

if (!SEM_FETCH) {
  const f = git("fetch", REMOTO, "--quiet");
  if (!f.ok) {
    // Sem rede, a unica medida disponivel e o cache — e cache que passa e o
    // verde que nao grita. Recusar e a resposta honesta.
    recusar(`nao consegui medir ${REF_BASE} (fetch falhou)`, [
      f.err || `git fetch ${REMOTO} saiu com ${f.status}`,
      "",
      `Sem fetch, ${REF_BASE} e um retrato velho — foi assim o erro do PR #9.`,
      "Passar aqui seria comprar confianca sem entregar medicao.",
      "",
      "Se a recusa for so falta de rede e voce ACEITA medir o cache:",
      "    node scripts/guarda-ramo.mjs --sem-fetch",
    ]);
  }
}

const baseLocal = git("rev-parse", REF_BASE);
if (!baseLocal.ok) {
  recusar(`${REF_BASE} nao existe neste clone`, [
    `Confira o nome do remoto e da base (GUARDA_RAMO_BASE, GUARDA_RAMO_REMOTO).`,
  ]);
}

// PADRAO-OURO: `ls-remote` le o servidor e nao tem cache nenhum. Se ele
// divergir do que o fetch trouxe, quem esta velho e a nossa ref — e o resto da
// medicao valeria nada.
if (!SEM_FETCH) {
  const ls = git("ls-remote", REMOTO, `refs/heads/${BASE}`);
  const noServidor = ls.ok ? ls.out.split(/\s+/)[0] : null;
  if (noServidor && noServidor !== baseLocal.out) {
    recusar(`${REF_BASE} diverge do servidor mesmo depois do fetch`, [
      `no servidor:  ${noServidor}`,
      `aqui:         ${baseLocal.out}`,
      "",
      "Qualquer contagem contra esta ref seria contra um retrato velho.",
    ]);
  }
}

// ---------------------------------------------------------------------------
// 3. O PORTAO — o ramo ainda esta vivo?
// ---------------------------------------------------------------------------

// A DISTINCAO QUE ME PEGOU NO PRIMEIRO TESTE DESTE ARQUIVO, e ela quase passou.
//
// `merge-base --is-ancestor HEAD origin/main` responde SIM em dois estados que
// nao sao a mesma coisa:
//
//   HEAD == origin/main   ramo recem-criado, no topo da main. E o estado NORMAL
//                         de quem esta fazendo tudo certo — e o proprio estado
//                         que a receita deste script manda produzir.
//   HEAD  < origin/main   tudo que o ramo tinha, a main ja tem. Ramo morto.
//
// A primeira versao recusava os dois, e eu so descobri porque rodei. Um portao
// que recusa ate o caminho certo e desligado na primeira semana, e ai a casa
// fica sem portao nenhum achando que tem — a mesma familia do vigia que toca
// toda noite. Portao que recusa tudo nao e rigor, e ruido.
const noTopo = cabeca === baseLocal.out;
const jaMesclado = !noTopo && git("merge-base", "--is-ancestor", "HEAD", REF_BASE).ok;

if (jaMesclado) {
  const url = git("remote", "get-url", REMOTO).out || REMOTO;
  const compara = url
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@ssh\.github\.com:443\//, "https://github.com/")
    .replace(/\.git$/, "");

  recusar(`o ramo '${ramo}' ja foi mesclado em ${REF_BASE}`, [
    "FATIA NOVA NASCE DE RAMO NOVO.",
    "",
    `HEAD          ${cabeca.slice(0, 7)}`,
    `${REF_BASE.padEnd(13)} ${baseLocal.out.slice(0, 7)}`,
    "",
    "Este ramo nao tem UMA LINHA que a main ja nao tenha — seja porque o PR",
    "dele fechou, seja porque ele nasceu de um retrato velho da main. Nos dois",
    "casos a receita e a mesma, e commit aqui nasce orfao: fica 1 a frente de",
    "um ramo morto, sem PR, e nada avisa — tsc, testes e build passam os tres,",
    "porque o defeito nao e de codigo.",
    "",
    "RECEITA (a mesma do conserto de 14/08):",
    `    git switch -c <fatia-nova> ${REF_BASE}`,
    "    git cherry-pick <sha>        # so se ja houver commit orfao a resgatar",
    "    # refazer os tres portoes AQUI, na arvore nova",
    `    git push ${url} <fatia-nova>`,
    "",
    "NUNCA `push --force` em ramo ja mesclado — o ramo antigo fica intacto.",
    compara !== REMOTO ? `PR: ${compara}/compare/${BASE}...<fatia-nova>` : "",
  ].filter(Boolean));
}

// ---------------------------------------------------------------------------
// 4. O SEGUNDO PORTAO — a arvore que os portoes vao medir
// ---------------------------------------------------------------------------

const contagem = git("rev-list", "--left-right", "--count", `${REF_BASE}...HEAD`).out;
const [atrasStr, frenteStr] = contagem.split(/\s+/);
const atras = Number(atrasStr ?? 0);
const frente = Number(frenteStr ?? 0);

// Contagem pura e cega: `chore(vitrine): snapshot automatico` cai na main o dia
// inteiro e nao atrasa portao nenhum. O numero que importa e quantos commits
// atrasados tocam `platform/`, que e a unica arvore que tsc, testes e build
// enxergam.
const tocamPlatform = atras > 0
  ? git("rev-list", "--count", `HEAD..${REF_BASE}`, "--", "platform/").out
  : "0";
const nPlatform = Number(tocamPlatform) || 0;

console.error(
  `[guarda-ramo] ${ramo} @ ${cabeca.slice(0, 7)} — ` +
  `${frente} a frente, ${atras} atras de ${REF_BASE} ` +
  `(${nPlatform} tocam platform/)`
);

if (nPlatform >= N_ATRASO) {
  const linhas = [
    `${nPlatform} commit(s) atras deste ramo mexem em platform/.`,
    "",
    "Os tres portoes vao medir uma ARVORE VELHA. Em 14/08 isso deu 745/745",
    "num ramo 26 commits atras; refeitos em ramo nascido da main, 892/892 —",
    "147 testes que eu simplesmente nao tinha rodado. Verde contra o passado",
    "nao diz nada sobre o presente.",
    "",
    "RECEITA:",
    `    git merge ${REF_BASE}     # merge, NUNCA rebase: os commits sao publicos`,
    "    # e so entao rodar os tres portoes",
  ];

  if (ESTRITO) {
    recusar("ramo atrasado, e --estrito esta ligado", linhas);
  }

  console.error(`\n[guarda-ramo] AVISO — portao vai medir arvore velha\n`);
  for (const l of linhas) console.error(`  ${l}`);
  console.error("");
}

console.error(`[guarda-ramo] ok — ramo vivo, pode commitar`);
process.exit(0);
