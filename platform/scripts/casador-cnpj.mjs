#!/usr/bin/env node
// ============================================================================
// CNPJ-CASADOR-01 — candidatos ranqueados de CNPJ raiz para as administradoras
// da casa, contra o cadastro oficial do Banco Central.
//
// NAO ESCREVE EM LUGAR NENHUM. Le, compara e imprime. O preenchimento de
// `administradoras.cnpj_raiz` e ato separado, revisado linha a linha.
//
// POR QUE ELE EXISTE
// O problema nao sao 4 administradoras orfas: e que MARCA COMERCIAL nao e
// RAZAO SOCIAL, e isso se repete a cada fornecedor novo. "Racon" e "Recon
// Administradora de Consorcios"; "Caoa" mora dentro de uma razao social longa;
// "Volkswagen" e "Gazin" aparecem sob outra denominacao. Busca literal acha
// so o caso facil e chama o resto de ausencia — que e falso negativo, nao
// resposta.
//
// POR QUE TRIGRAMA AQUI E NAO NO BANCO
// A ordem pede pg_trgm/similarity() >= 0.4. Medido em 16/08/2026 no xtv:
// pg_trgm tem installed_version = null — NAO esta instalado (instalados:
// pgcrypto, unaccent, uuid-ossp, vector, pg_stat_statements, supabase_vault,
// plpgsql). Instalar extensao em producao para ferramenta de uso unico e
// custo permanente por beneficio temporario. O algoritmo do pg_trgm esta
// reimplementado aqui, FIEL a definicao dele, para que o limiar 0.4 signifique
// a mesma coisa que significaria no banco:
//   · minusculas; nao-alfanumerico e separador de palavra;
//   · cada palavra vira "  palavra " (2 espacos antes, 1 depois);
//   · trigramas = todas as janelas de 3 caracteres (N+1 por palavra);
//   · similarity = |interseccao| / |uniao| dos conjuntos DISTINTOS.
// Se um dia pg_trgm entrar no banco, `--provar-trgm` imprime os trigramas
// para conferir contra show_trgm() antes de confiar no numero.
//
// TRES CORRECOES DE 16/08/2026, todas por defeito medido e nao por gosto
//   1. NOMEAR O SILENCIO. Alias que nao casa deixa de virar nada e passa a
//      virar linha: "ALIAS SEM CORRESPONDENCIA (possivel marca incorporada)",
//      com as palavras ausentes escritas. Zero anonimo nao e informacao.
//   2. COMPARADOR DE DOMINIO. Nome nao e a unica ponte: a Caoa mora numa razao
//      social que nao a nomeia ("CONVEF ...") e so o site a entrega
//      (CAOACONSORCIOS.COM.BR); a Ademicon se confirma por ADEMICON.COM.BR.
//      Vale 0.90 e NUNCA e auto-confirmavel — indicio forte nao e prova.
//   3. REGUA S/A CORRIGIDA. `S` e `A` saem de RUIDO como letras avulsas e
//      passam a ser tratados como o PAR "S A" que a pontuacao de "S.A." cria.
//      A versao anterior comia S e A legitimos em qualquer posicao, o que
//      aproximava nomes diferentes e fabricava empate.
//
// COMO RODAR
//   node platform/scripts/casador-cnpj.mjs --casa <casa.json> [--cadastro <bacen.json>]
// `casa.json`  = [{ id, nome, aliases, cartas }, ...] exportado do xtv.
// `--cadastro` = opcional; sem ele o script busca o cadastro publico do Bacen.
// Nenhum segredo entra aqui: a fonte do Bacen e aberta e a lista da casa
// chega por arquivo, nunca por chave de servico dentro do script.
// ============================================================================

const URL_BACEN =
  'https://olinda.bcb.gov.br/olinda/servico/Instituicoes_em_funcionamento/versao/v1/odata/SedesConsorcios?$format=json';

// Sufixos societarios e palavras de ramo. Sao ruido de comparacao: aparecem em
// quase toda razao social e por isso nao distinguem ninguem.
// A lista veio da ordem. Todo nucleo e impresso no relatorio justamente para
// que esta regua possa ser inspecionada — regua que transforma antes de
// comparar pode FABRICAR resultado (CLAUDE.md Regra 9, item 3).
const RUIDO = new Set([
  'LTDA', 'SA', 'EIRELI', 'ADMINISTRADORA', 'ADMINISTRADORAS', 'ADM',
  'DE', 'CONSORCIO', 'CONSORCIOS', 'NACIONAL', 'GRUPO',
]);

// CORRIGIDO em 16/08/2026 — DEFEITO DA REGUA, achado por medicao propria.
// A versao anterior punha `S` e `A` SOLTOS dentro de RUIDO para desmontar o
// "S.A." que a pontuacao transforma em "S A". A justificativa era boa e o
// efeito colateral era grave: a regua passava a comer QUALQUER letra S ou A
// isolada, em qualquer posicao, de qualquer nome — inclusive quando ela era
// parte legitima da marca. Regua que apaga o que nao devia apagar aproxima
// nomes que nao sao o mesmo, e foi assim que apareceu empate onde nao havia.
// A correcao trata o "S A" pelo que ele e: um PAR ADJACENTE, nao duas letras
// avulsas. Fora do par, S e A sobrevivem.
function tirarSociedadeAnonima(t) {
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'S' && t[i + 1] === 'A') { i++; continue; }
    out.push(t[i]);
  }
  return out;
}

const LIMIAR_TRIGRAMA = 0.4;   // o da ordem
const LIMIAR_SEGUNDO  = 0.5;   // acima disto, o segundo colocado tira o auto
const TOP = 3;

// ---------------------------------------------------------------------------
// Normalizacao
// ---------------------------------------------------------------------------
function semAcento(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokens(s) {
  return semAcento(String(s || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Nucleo da marca: tokens sem o ruido societario/de ramo. */
function nucleo(s) {
  const t = tirarSociedadeAnonima(tokens(s)).filter((w) => !RUIDO.has(w));
  // Se a regua comeu tudo (ex.: "Consorcio Nacional Ltda"), devolve os tokens
  // crus. Nucleo vazio compararia com qualquer coisa — isso seria a regua
  // fabricando casamento.
  return (t.length ? t : tokens(s)).join(' ');
}

// ---------------------------------------------------------------------------
// Trigramas, na definicao do pg_trgm
// ---------------------------------------------------------------------------
function trigramas(s) {
  const set = new Set();
  for (const w of tokens(s)) {
    const p = '  ' + w.toLowerCase() + ' ';
    for (let i = 0; i + 3 <= p.length; i++) set.add(p.slice(i, i + 3));
  }
  return set;
}

function similaridade(a, b) {
  const A = trigramas(a);
  const B = trigramas(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const uniao = A.size + B.size - inter;
  return uniao === 0 ? 0 : inter / uniao;
}

// ---------------------------------------------------------------------------
// COMPARADOR DE DOMINIO — a ponte quando o NOME nao e ponte nenhuma
//
// Medido em 16/08/2026, e sao estes os dois casos que o justificam:
//   · CAOA      -> razao social "CONVEF ...", nome que nao contem "CAOA" em
//                  lugar nenhum; o site e CAOACONSORCIOS.COM.BR.
//   · ADEMICON  -> confirmada pelo dominio ADEMICON.COM.BR.
// Sem isto, as duas sao "sem candidato" — um zero que nao e ausencia, e sim
// cegueira do instrumento.
//
// LIMITE DECLARADO, e ele importa: o dominio acha uma MARCA, mas NAO
// DISCRIMINA DENTRO DELA. Os dois CNPJs vivos do Itau (00000776 e 42421776)
// compartilham WWW.ITAU.COM.BR e o mesmo e-mail institucional; para o dominio
// eles sao um so. Onde a marca tem mais de um CNPJ vivo, este criterio nao
// resolve nada e a escolha continua sendo humana.
//
// PISO DE 4 LETRAS: dominio e texto curto e denso, onde nucleo de 2 ou 3
// letras casa por acidente ("CNP" acha "cnpseguradora", "BB" acha qualquer
// coisa). Abaixo de 4 o criterio nao e aplicado — silencio honesto e melhor
// que casamento fabricado.
const PISO_DOMINIO = 4;

// SUBSTRING CRUA EM DOMINIO E DEFEITO, e este e o registro de como se soube.
// A primeira versao achatava o dominio num blob e procurava o nucleo dentro
// dele. Medido na primeira rodada, com o resultado impresso:
//   RACON  casou 0.900 com ANCORA  (anco-RACON-sorcios.com.br)   trg=0.000
//   RACON  casou 0.900 com EMBRACON (emb-RACON.com.br)           trg=0.364
//   RACON  casou 0.900 com APICE   (administ-RACON-sorcio.com.br)
// Isto e EXATAMENTE o defeito do metodo antigo — "RACON dentro de EMBRACON" —
// ressuscitado pela porta do dominio em vez da porta do nome. Score 0.900 com
// trigrama 0.000 e o instrumento gritando que se contradiz.
//
// A regra passa a ser de ROTULO, nao de substring: o nucleo tem de SER um
// rotulo do dominio, ou o rotulo tem de ser o nucleo + uma palavra de ramo
// declarada. A lista de sufixos e curta de proposito e contem apenas o que a
// medicao mostrou existir; inventar sufixo "provavel" seria fabricar alcance.
const SUFIXOS_RAMO = ['consorcios', 'consorcio'];

/** Rotulos de um site/e-mail: host separado por ponto, hifen etc. */
function rotulosDominio(s) {
  const bruto = semAcento(String(s || '')).toLowerCase();
  const host = bruto.includes('@')
    ? bruto.split('@').pop()
    : bruto.replace(/^[a-z]+:\/\//, '').split('/')[0];
  return host.split(/[^a-z0-9]+/).filter(Boolean);
}

/** O nucleo da casa E um rotulo do dominio da instituicao?
 *  A agulha vem MINUSCULA de proposito: `nucleo()` devolve maiuscula e os
 *  rotulos vem minusculos. A primeira versao comparou os dois como estavam e
 *  nunca casou nada — o controle positivo de CAOA/ADEMICON e o que denunciou,
 *  e e a razao de ele existir.
 *
 *  So o SITE conta. `E_MAIL` foi testado e REPROVADO: o unico efeito medido
 *  dele foi casar "EMBRACON" com RCI BRASIL, porque o cadastro do Bacen lista
 *  um contato pessoal @embracon.com.br na linha da RCI. E-mail de pessoa nao
 *  e identidade de empresa. */
function casaPorDominio(nc, inst) {
  const agulha = nc.replace(/\s+/g, '').toLowerCase();
  if (agulha.length < PISO_DOMINIO) return null;
  for (const r of rotulosDominio(inst.SITIO_NA_INTERNET)) {
    if (r === agulha) {
      return { campo: 'SITIO_NA_INTERNET', valor: String(inst.SITIO_NA_INTERNET), rotulo: r };
    }
    for (const sfx of SUFIXOS_RAMO) {
      if (r === agulha + sfx) {
        return { campo: 'SITIO_NA_INTERNET', valor: String(inst.SITIO_NA_INTERNET), rotulo: r };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Comparacao de uma grafia da casa contra uma instituicao do Bacen
// ---------------------------------------------------------------------------
function comparar(grafia, oficial, inst) {
  const nc = nucleo(grafia);
  const no = nucleo(oficial);
  const trg = similaridade(nc, no);

  // (a) igualdade de nucleo
  if (nc && nc === no) return { score: 1, via: 'nucleo-igual', trg };

  // (b) nucleo da casa contido no nome oficial, em qualquer posicao.
  //     Fronteira de palavra: "CAOA" nao deve casar dentro de "CAOAXYZ".
  //     Nucleo de 1 ou 2 letras nao vale por contencao — casaria com meio
  //     mundo (controle negativo: "SA" dentro de "SANTANDER").
  if (nc.length >= 3) {
    const alvo = ' ' + tokens(oficial).join(' ') + ' ';
    if (alvo.includes(' ' + nc + ' ')) {
      return { score: 0.95, via: 'nucleo-contido', trg };
    }
  }

  // (c) dominio: o nucleo da casa E um rotulo do site oficial.
  //     Vale 0.90 — acima do trigrama, ABAIXO da contencao por nome, e
  //     deliberadamente FORA do auto-confirmavel (so `nucleo-igual` e auto).
  //     Achar por dominio e forte indicio, nao prova de identidade juridica.
  if (inst) {
    const d = casaPorDominio(nc, inst);
    if (d) return { score: 0.9, via: 'dominio', trg, dominio: d };
  }

  // (d) trigrama
  if (trg >= LIMIAR_TRIGRAMA) return { score: trg, via: 'trigrama', trg };

  return { score: trg, via: null, trg };
}

/** Melhor comparacao entre TODAS as grafias da casa (nome + aliases). */
function melhorPara(casa, inst) {
  const grafias = [casa.nome, ...(casa.aliases || [])].filter(Boolean);
  let best = null;
  for (const g of grafias) {
    const r = comparar(g, inst.NOME_INSTITUICAO || '', inst);
    if (!best || r.score > best.score) best = { ...r, grafia: g };
  }
  return best;
}

/** O metodo ANTIGO, de proposito. Fica aqui para ser o segundo caminho
 *  independente de medicao (CLAUDE.md Regra 9, item 6).
 *
 *  CORRIGIDO em 16/08/2026. A primeira versao usava IGUALDADE do nome inteiro
 *  normalizado e devolvia ZERO para as 37 — um controle que nunca dispara nao
 *  pode divergir, logo o "DIVERGENCIAS = 0" que ele produziu nao media nada.
 *  Medido: igualdade => 0/37; contencao de substring => 34/37. O metodo antigo
 *  era CONTENCAO CRUA, sem fronteira de palavra — e e por isso que ele casa
 *  "RACON" dentro de "EMBRACON". O defeito faz parte do controle: e justamente
 *  ele que o metodo novo tem de contradizer. */
function casamentoAntigo(casa, cadastro) {
  const grafias = [casa.nome, ...(casa.aliases || [])]
    .filter(Boolean)
    .map((g) => tokens(g).join(' '))
    .filter((g) => g.length >= 3);
  return cadastro.filter((i) => {
    const alvo = tokens(i.NOME_INSTITUICAO).join(' ');
    return grafias.some((g) => alvo.includes(g));
  });
}

// ---------------------------------------------------------------------------
// NOMEAR O SILENCIO — alias sem correspondencia no cadastro
//
// Um alias que nao casa com nada pode ser duas coisas MUITO diferentes, e a
// primeira versao deste script chamava as duas de nada:
//   (a) variacao de escrita de uma marca que JA casou por outra grafia
//       ("CONSORCIO MAGALU" ao lado de "MAGAZINE LUIZA") — nao e noticia;
//   (b) nucleo que nao aparece em NENHUM lugar do cadastro — nem em nome, nem
//       em e-mail, nem em site. Esse e o candidato a MARCA INCORPORADA, e e
//       exatamente ele que a ordem manda nomear.
// Zero anonimo nao informa; zero nomeado informa. A diferenca entre "nao achei"
// e "nao achei ISTO, e ISTO nao existe em parte nenhuma do cadastro" e a
// diferenca entre ruido e medicao.
//
// O corpo varrido e nome + e-mail + site DE PROPOSITO: foi o dominio que achou
// a Caoa e e ele que confirma a Ademicon. Varrer so o nome devolveria orfaos
// falsos.
//
// PISO DE 4 LETRAS e o mesmo do dominio, pela mesma razao: palavra de 2 ou 3
// letras acha qualquer coisa por acidente. Medido: sem o piso a lista sai com
// 11 linhas de ruido; com o piso sai com 3, das quais so uma e real.
const RUIDO_ALIAS = new Set([...RUIDO, 'DO', 'DA', 'S', 'A']);
const PISO_ALIAS = 4;

/** Corpo inteiro do cadastro, achatado para busca de substring. */
function corpoCadastro(cadastro) {
  return cadastro.map((i) => semAcento(
    `${i.NOME_INSTITUICAO || ''} ${i.E_MAIL || ''} ${i.SITIO_NA_INTERNET || ''}`,
  ).toUpperCase());
}

/** Palavras significativas de uma grafia, para busca no corpo. */
function palavrasDeAlias(s) {
  const t = tirarSociedadeAnonima(tokens(s)).filter((w) => !RUIDO_ALIAS.has(w));
  return (t.length ? t : tokens(s)).filter((w) => w.length >= PISO_ALIAS);
}

/** Aliases cujo nucleo esta AUSENTE do cadastro inteiro. */
function aliasesOrfaos(casa, corpo) {
  const achou = (w) => corpo.some((c) => c.includes(w));
  const fora = [];
  for (const al of casa.aliases || []) {
    const palavras = palavrasDeAlias(al);
    if (!palavras.length) continue;             // sem palavra medivel: nao opina
    const ausentes = palavras.filter((w) => !achou(w));
    if (ausentes.length === palavras.length) fora.push({ alias: al, ausentes });
  }
  return fora;
}

// ---------------------------------------------------------------------------
// Relatorio
// ---------------------------------------------------------------------------
function brl(n) { return String(n ?? 0).padStart(6, ' '); }

function linhaCandidato(c, i) {
  const via = c.via ? c.via : 'abaixo-do-limiar';
  // Quando o criterio foi o dominio, o dominio VAI IMPRESSO. Criterio que nao
  // mostra a evidencia que usou pede fe, e fe nao se audita.
  const prova = c.dominio ? `\n         prova=${c.dominio.campo}: ${c.dominio.valor}` : '';
  return `      ${i + 1}. ${c.score.toFixed(3)}  ${String(c.inst.CNPJ).padEnd(9)} ` +
         `${c.inst.NOME_INSTITUICAO}  [${c.inst.MUNICIPIO}/${c.inst.UF}]\n` +
         `         via=${via}  trg=${c.trg.toFixed(3)}  grafia-da-casa="${c.grafia}"${prova}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const caminhoCasa = arg('--casa');
  const caminhoCad = arg('--cadastro');
  const provarTrgm = argv.includes('--provar-trgm');

  if (!caminhoCasa) {
    console.error('uso: node casador-cnpj.mjs --casa <casa.json> [--cadastro <bacen.json>] [--provar-trgm]');
    process.exit(2);
  }

  const { readFileSync } = await import('node:fs');
  const casa = JSON.parse(readFileSync(caminhoCasa, 'utf8'));

  let cadastro;
  if (caminhoCad) {
    cadastro = JSON.parse(readFileSync(caminhoCad, 'utf8')).value ?? JSON.parse(readFileSync(caminhoCad, 'utf8'));
  } else {
    const r = await fetch(URL_BACEN);
    if (!r.ok) { console.error(`Bacen respondeu HTTP ${r.status}`); process.exit(1); }
    cadastro = (await r.json()).value;
  }

  // -- ASSERCAO DE SANIDADE (CLAUDE.md Regra 8): provar que o corpo foi lido.
  //    Zero em corpo vazio e falso negativo, nao aprovacao.
  if (!Array.isArray(cadastro) || cadastro.length < 50) {
    console.error(`cadastro suspeito: ${Array.isArray(cadastro) ? cadastro.length : 'nao-array'} linhas. Abortado.`);
    process.exit(1);
  }
  if (!cadastro[0].CNPJ || !cadastro[0].NOME_INSTITUICAO) {
    console.error('cadastro sem as chaves CNPJ/NOME_INSTITUICAO. Abortado.');
    process.exit(1);
  }

  console.log('='.repeat(78));
  console.log('CNPJ-CASADOR-01 — candidatos ranqueados, nunca escolha automatica');
  console.log('='.repeat(78));
  console.log(`cadastro Bacen ...... ${cadastro.length} instituicoes`);
  console.log(`administradoras casa  ${casa.length}`);
  console.log(`limiar trigrama ..... ${LIMIAR_TRIGRAMA}   (segundo colocado que tira o auto: ${LIMIAR_SEGUNDO})`);
  console.log(`ruido removido ...... ${[...RUIDO].join(', ')}  (+ par adjacente "S A")`);
  console.log(`piso de dominio ..... ${PISO_DOMINIO} letras   piso de alias orfao: ${PISO_ALIAS} letras`);

  const corpo = corpoCadastro(cadastro);

  // -- CONTROLE NEGATIVO (Regra 9, item 4): um nome que NAO pode casar.
  //    Se o instrumento devolver sucesso para o verdadeiro E para o falso,
  //    ele nao mede nada.
  const isca = { nome: 'Zorblax Administradora de Consorcios', aliases: [] };
  const iscaTop = cadastro
    .map((i) => ({ ...melhorPara(isca, i), inst: i }))
    .sort((a, b) => b.score - a.score)[0];
  console.log(`\nCONTROLE NEGATIVO "Zorblax": melhor score = ${iscaTop.score.toFixed(3)} ` +
              `(${iscaTop.via ?? 'abaixo-do-limiar'}) -> ${iscaTop.score >= LIMIAR_TRIGRAMA ? 'FALHOU, instrumento cego' : 'OK, instrumento discrimina'}`);

  // -- CONTROLES DOS DOIS CRITERIOS NOVOS. Criterio novo sem controle e so
  //    codigo novo: nao se sabe se ele enxerga nem se ele erra.
  const caoa = cadastro.find((i) => casaPorDominio('CAOA', i));
  console.log(`CONTROLE POSITIVO dominio "CAOA": ` +
    (caoa ? `OK -> ${caoa.CNPJ} | ${caoa.NOME_INSTITUICAO} | ${caoa.SITIO_NA_INTERNET}` : 'FALHOU, dominio cego'));
  const ademi = cadastro.find((i) => casaPorDominio('ADEMICON', i));
  console.log(`CONTROLE POSITIVO dominio "ADEMICON": ` +
    (ademi ? `OK -> ${ademi.CNPJ} | ${ademi.NOME_INSTITUICAO}` : 'FALHOU, dominio cego'));
  const iscaDom = cadastro.find((i) => casaPorDominio('ZORBLAX', i));
  console.log(`CONTROLE NEGATIVO dominio "ZORBLAX": ` +
    (iscaDom ? `FALHOU, casou com ${iscaDom.CNPJ}` : 'OK, ausente'));

  // -- CONTROLE DO DEFEITO JA COMETIDO. A primeira versao deste comparador
  //    casou RACON com ANCORA e EMBRACON por substring crua. O controle fica
  //    permanente: defeito corrigido sem controle volta na proxima mexida.
  const racon = cadastro.filter((i) => casaPorDominio('RACON', i));
  console.log(`CONTROLE DE REGRESSAO dominio "RACON" (nao pode achar ANCORA/EMBRACON/APICE): ` +
    (racon.length === 0 ? 'OK, nenhum' : `FALHOU -> ${racon.map((i) => i.CNPJ + ' ' + i.NOME_INSTITUICAO).join(' ; ')}`));
  const orfaoFalso = aliasesOrfaos({ aliases: ['Porto Seguro'] }, corpo);
  const orfaoReal  = aliasesOrfaos({ aliases: ['Zorblax'] }, corpo);
  console.log(`CONTROLE do detector de orfao: "Porto Seguro" -> ` +
    (orfaoFalso.length ? 'FALHOU, marca existente acusada de orfa' : 'OK, nao acusa') +
    `  |  "Zorblax" -> ` + (orfaoReal.length ? 'OK, acusa o inexistente' : 'FALHOU, detector cego'));

  if (provarTrgm) {
    console.log(`\nPROVA DE TRIGRAMA (conferir contra show_trgm no banco):`);
    console.log(`  show_trgm('caoa') = {${[...trigramas('caoa')].map((t) => `"${t}"`).sort().join(',')}}`);
    console.log(`  similarity('racon','recon') = ${similaridade('racon', 'recon').toFixed(6)}`);
  }

  const auto = [];
  const revisar = [];
  const divergentes = [];
  const semCandidato = [];
  const orfaos = [];

  for (const a of casa) {
    const ranking = cadastro
      .map((i) => ({ ...melhorPara(a, i), inst: i }))
      .filter((c) => c.score > 0)
      .sort((a2, b2) => b2.score - a2.score)
      .slice(0, TOP);

    const antigo = casamentoAntigo(a, cadastro);
    const cnpjAntigo = antigo.length === 1 ? antigo[0].CNPJ : null;
    const primeiro = ranking[0] ?? null;
    const segundo = ranking[1] ?? null;

    // AUTO-CONFIRMAVEL: nucleo igual E nenhum segundo acima de 0.5.
    const ehAuto =
      primeiro && primeiro.via === 'nucleo-igual' &&
      (!segundo || segundo.score < LIMIAR_SEGUNDO);

    const util = primeiro && primeiro.via;   // passou por algum criterio

    console.log('\n' + '-'.repeat(78));
    console.log(`${a.nome}   (cartas: ${brl(a.cartas)})`);
    console.log(`  nucleo="${nucleo(a.nome)}"   aliases=${(a.aliases || []).length}`);
    console.log(`  casamento pelo metodo ANTIGO (nome inteiro identico): ` +
                (cnpjAntigo ? cnpjAntigo : antigo.length > 1 ? `AMBIGUO (${antigo.length})` : 'nenhum'));

    // Nomeia o silencio ANTES de falar de candidato: o alias orfao e um achado
    // proprio, independente de a administradora ter casado ou nao.
    const fora = aliasesOrfaos(a, corpo);
    if (fora.length) {
      for (const f of fora) {
        console.log(`  ?? ALIAS SEM CORRESPONDENCIA (possivel marca incorporada): ` +
                    `"${f.alias}"  — ausente do cadastro inteiro: ${f.ausentes.join(', ')}`);
        orfaos.push({ nome: a.nome, alias: f.alias, ausentes: f.ausentes });
      }
    }

    if (!ranking.length) {
      console.log('  sem candidato nenhum.');
      semCandidato.push({ nome: a.nome, motivo: 'nenhuma instituicao pontuou acima de zero' });
      continue;
    }
    console.log('  candidatos:');
    ranking.forEach((c, i) => console.log(linhaCandidato(c, i)));

    if (!util) {
      console.log('  >> NENHUM candidato atingiu criterio. REVISAO.');
      semCandidato.push({
        nome: a.nome,
        motivo: `melhor score ${primeiro.score.toFixed(3)} < limiar ${LIMIAR_TRIGRAMA}` +
                ` (topo: ${primeiro.inst.CNPJ} ${primeiro.inst.NOME_INSTITUICAO})`,
      });
      // SILENCIO DO NOVO CONTRA FALA DO ANTIGO tambem e divergencia, e e a mais
      // informativa que existe: uma rota afirma e a outra se recusa. A primeira
      // versao so comparava CNPJ contra CNPJ e por isso este caso — o da Racon,
      // onde o antigo aponta EMBRACON e o novo nao aponta nada — nao aparecia
      // em DIVERGENCIAS. Zero de divergencia por cegueira nao e concordancia.
      if (cnpjAntigo) {
        console.log(`  !! DIVERGENCIA: antigo=${cnpjAntigo}  novo=RECUSOU`);
        divergentes.push({ nome: a.nome, antigo: cnpjAntigo, novo: 'RECUSOU' });
      }
    } else if (ehAuto) {
      console.log(`  >> AUTO-CONFIRMAVEL: ${primeiro.inst.CNPJ}`);
      auto.push({ nome: a.nome, cnpj: primeiro.inst.CNPJ, oficial: primeiro.inst.NOME_INSTITUICAO });
    } else {
      console.log('  >> REVISAO DO EMERSON.');
      revisar.push({ nome: a.nome, cnpj: primeiro.inst.CNPJ, oficial: primeiro.inst.NOME_INSTITUICAO, via: primeiro.via, score: primeiro.score });
    }

    // O CONTROLE que a ordem pede: o metodo antigo achou algo diferente do
    // melhor candidato? Entao o casamento antigo estava errado, ou o novo esta.
    // Duas rotas discordando e a evidencia mais barata de que uma quebrou.
    if (cnpjAntigo && util && cnpjAntigo !== primeiro.inst.CNPJ) {
      console.log(`  !! DIVERGENCIA: antigo=${cnpjAntigo}  novo=${primeiro.inst.CNPJ}`);
      divergentes.push({ nome: a.nome, antigo: cnpjAntigo, novo: primeiro.inst.CNPJ });
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log('RESUMO');
  console.log('='.repeat(78));
  console.log(`auto-confirmaveis ... ${auto.length}`);
  console.log(`para revisao ........ ${revisar.length}`);
  console.log(`sem candidato ....... ${semCandidato.length}`);
  for (const s of semCandidato) console.log(`   ${s.nome}: ${s.motivo}`);
  console.log(`DIVERGENCIAS ........ ${divergentes.length}`);
  for (const d of divergentes) console.log(`   ${d.nome}: antigo=${d.antigo} novo=${d.novo}`);

  // O silencio nomeado, junto. Nao e defeito da medicao: e o resultado dela.
  console.log(`ALIAS ORFAO ......... ${orfaos.length}` +
    (orfaos.length ? '   (nucleo ausente de nome, e-mail e site de TODO o cadastro)' : ''));
  for (const o of orfaos) {
    console.log(`   ${o.nome}: "${o.alias}"  ausente: ${o.ausentes.join(', ')}`);
  }
  if (orfaos.length) {
    console.log('   Leitura: orfao NAO prova marca incorporada — prova que o');
    console.log('   cadastro do Bacen nao conhece esse nome. Pode ser marca');
    console.log('   comprada por outra instituicao, pode ser nome fantasia que');
    console.log('   nunca foi razao social. Cada linha e uma pergunta, nao um fato.');
  }

  // Unicidade: duas administradoras da casa apontando para o mesmo CNPJ raiz
  // violariam o indice unico da migration ANTES de ela existir. Melhor saber
  // agora do que no apply.
  const porCnpj = new Map();
  for (const x of [...auto, ...revisar]) {
    if (!porCnpj.has(x.cnpj)) porCnpj.set(x.cnpj, []);
    porCnpj.get(x.cnpj).push(x.nome);
  }
  const colisoes = [...porCnpj.entries()].filter(([, nomes]) => nomes.length > 1);
  console.log(`COLISOES DE CNPJ ..... ${colisoes.length}`);
  for (const [cnpj, nomes] of colisoes) {
    console.log(`   ${cnpj} <- ${nomes.join(' | ')}`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
