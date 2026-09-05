// ============================================================================
// FUNIL-01 · F3.2 — o teste da ponte
// ----------------------------------------------------------------------------
// Este teste tem DOIS trabalhos, e o segundo é o que importa mais.
//
// O primeiro é o óbvio: provar que cada braço da régua faz o que diz.
//
// O segundo é provar que a ORDEM dos braços é a ordem certa, porque é ali que
// mora a política e não a lógica. "Compliance vence palavra" não é uma frase
// bonita no cabeçalho: é o teste que põe `opt_out` e uma decisão nominal de
// `inserir` na MESMA conversa e cobra que o motivo devolvido seja o do
// opt-out. Se alguém trocar dois `if` de lugar por elegância, é este teste
// que grita.
//
// FIXTURES COM NOME. Cada caso abaixo é uma conversa REAL da lista aprovada
// pelo Emerson em 03/09 (`ident01/RELATORIOS/FUNIL-01_F3_candidatas.md` @
// 706ef122). Os dados são sintéticos — telefone e uuid inventados — mas a
// SITUAÇÃO é a medida. Quando a F3.4 rodar o ensaio e uma linha sair da
// classe esperada, o nome aqui diz de quem é a linha.
//
// A ISCA (Regra 9, controle negativo): três testes existem só para provar que
// esta suíte é CAPAZ DE FALHAR — um telefone a um dígito do telefone da casa
// que NÃO pode ser excluído, uma confiança de 0.69 que NÃO pode contar como
// extrato, e a mesma conversa com e sem `opt_out` dando classes diferentes.
// Suíte que só confirma o esperado não é suíte, é decoração.
// ============================================================================

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MARCADOR_BASTAO } from "@/app/api/atende/_prompt";

import {
  AGENTE_DE_CAPTACAO,
  AGENTES_CONHECIDOS,
  AGENTES_DE_COMPRA,
  AGENTES_QUE_TORNAM_CANDIDATA,
  COLUNAS_DA_LINHA,
  COLUNAS_PROIBIDAS,
  CONFIANCA_MINIMA_EXTRATO,
  decidir,
  ehAgenteConhecido,
  ehCandidata,
  inteiroDoExtrato,
  numeroDoExtrato,
  reaisDoExtrato,
  TAG_CEDENTE,
  TAG_COTA_CANCELADA,
  telefoneParaCaptacoes,
  type CaptacaoExistente,
  type ConversaMedida,
  type Decisao,
} from "./ponte";

// ----------------------------------------------------------------------------
// Fábrica de fixture. O padrão é a conversa mais inerte possível: sem agente,
// sem tag, sem extrato, sem palavra de ninguém. Cada teste liga UM fato.
// ----------------------------------------------------------------------------

const ID_CONVERSA = "7cfa67f6-0000-4000-8000-000000000001";
const ID_OUTRA_CONVERSA = "16deb7a1-0000-4000-8000-000000000002";

/** Telefone de 11 dígitos que não é da casa. Chave: 1198887766 -> "1198887766". */
const TEL_11 = "5511998887766";
/** Telefone de 10 dígitos (número antigo, sem o nono). */
const TEL_10 = "8281131987";
/** O número do Emerson, que a lista `TELEFONES_DA_CASA` conhece. */
const TEL_CASA = "5519997561909";

function conversa(over: Partial<ConversaMedida> = {}): ConversaMedida {
  return {
    id: ID_CONVERSA,
    nome: null,
    telefone: TEL_11,
    tags: [],
    agente_ativo: null,
    opt_out: false,
    n_intencao: 0,
    extrato: null,
    captacao: null,
    posto_na_chave: 1,
    nominal: null,
    ...over,
  };
}

/** O extrato como a ponte passou a lê-lo em 03/09: as COLUNAS TIPADAS de
 *  `extratos_cotas`, não o `dados` jsonb. Medido: as duas cópias concordam em
 *  34/34, e a coluna é melhor porque o banco já garantiu o tipo na escrita. */
function extrato(over: Partial<{
  confianca: number;
  contemplada: boolean | null;
  administradora: string | null;
  valor_credito: number | null;
  saldo_devedor: number | null;
  parcelas_pagas: number | null;
}> = {}) {
  return {
    confianca: 0.9,
    contemplada: true as boolean | null,
    administradora: null as string | null,
    valor_credito: null as number | null,
    saldo_devedor: null as number | null,
    parcelas_pagas: null as number | null,
    ...over,
  };
}

/** A captação que JÁ EXISTE na chave. O padrão é `novo` porque é o status das
 *  duas captações reais medidas em 03/09/2026 (Tamires `6d4f46ea`, Leandro
 *  `fa8f1ffd`) — as duas VIVAS, nenhuma encerrada.
 *
 *  `atualizado_em` nasceu aqui em 03/09 junto com o braço 8b: quando a captação
 *  está ENCERRADA, essa data entra no motivo devolvido, porque é ela que diz
 *  desde quando a mesa decidiu. O padrão é `null` de propósito — quem testa o
 *  braço encerrado tem de dizer a data, e quem não testa não finge ter uma. */
function captacao(over: Partial<CaptacaoExistente> = {}): CaptacaoExistente {
  return {
    id: "fa8f1ffd-0000-4000-8000-00000000000a",
    status: "novo",
    atualizado_em: null,
    wa_conversa_id: null,
    nome: null,
    administradora: null,
    credito: null,
    saldo_devedor: null,
    parcelas_pagas: null,
    ...over,
  };
}

/** O FORMATO MEDIDO, não o imaginado. Estes valores são de linhas reais do
 *  banco (Porto Seguro, conf 0.7). Os tipos das colunas foram medidos em
 *  `information_schema` (numeric, numeric, integer, text) e a travessia JSON
 *  em `to_jsonb` (number, number, number, string — com a isca do `text`
 *  discordando, que é o que prova a régua).
 *
 *  Se você trocar por string aqui, está testando um mundo que não existe —
 *  foi o que eu fiz, e custou dois vermelhos que revelaram um risco de erro
 *  de cem vezes. O nome ficou `DADOS_CHEIOS` por continuidade, mas isto já
 *  não é o `dados` jsonb: são as quatro colunas. */
const DADOS_CHEIOS = {
  valor_credito: 131163.29,
  saldo_devedor: 80000,
  parcelas_pagas: 42,
  administradora: "Unifisa",
};

/** Estreita a decisão para o braço `inserir`, falhando com mensagem útil. */
function comoInserir(d: Decisao) {
  assert.equal(d.classe, "inserir", `esperava inserir, veio ${d.classe}: ${d.motivo}`);
  assert.ok("linha" in d);
  return d.linha;
}

function comoLigar(d: Decisao) {
  assert.equal(d.classe, "ligar", `esperava ligar, veio ${d.classe}: ${d.motivo}`);
  assert.ok("escrever" in d);
  return d;
}

// ============================================================================
describe("FUNIL-01 ponte — as fixtures com nome", () => {
  // --------------------------------------------------------------------------
  test('7cfa67f6 (a do emoji 🤞): tag de cedente, sem extrato -> inserir sem dados', () => {
    const d = decidir(conversa({ tags: [TAG_CEDENTE], nome: "🤞" }));
    const linha = comoInserir(d);

    assert.equal(linha.nome, "🤞");
    assert.equal(linha.telefone, "11998887766");
    assert.equal(linha.origem, "whatsapp");
    assert.equal(linha.status, "novo");
    assert.equal(linha.wa_conversa_id, ID_CONVERSA);

    // Sem extrato, os quatro campos medidos nascem nulos — e isso NÃO é
    // defeito: é uma captação que existe para alguém ligar e perguntar.
    assert.equal(linha.administradora, null);
    assert.equal(linha.credito, null);
    assert.equal(linha.saldo_devedor, null);
    assert.equal(linha.parcelas_pagas, null);
  });

  // --------------------------------------------------------------------------
  test("confiança EXATAMENTE 0.7 conta como extrato e desce os dados", () => {
    const d = decidir(
      conversa({
        tags: [TAG_CEDENTE],
        extrato: extrato({ confianca: CONFIANCA_MINIMA_EXTRATO, ...DADOS_CHEIOS }),
      })
    );
    const linha = comoInserir(d);

    assert.equal(linha.credito, 131163.29);
    assert.equal(linha.saldo_devedor, 80000);
    assert.equal(linha.parcelas_pagas, 42);
    assert.equal(linha.administradora, "Unifisa");
  });

  // --------------------------------------------------------------------------
  test("ISCA: confiança 0.69 NÃO conta como extrato (prova que o limiar morde)", () => {
    // Só o extrato tornaria esta conversa candidata; com 0.69 ela nem é
    // candidata, então cai em "(mesma chave)". Se o `>=` virasse `>` no
    // limiar, o teste de cima quebraria; se o limiar sumisse, este quebraria.
    const d = decidir(
      conversa({ extrato: extrato({ confianca: 0.69, ...DADOS_CHEIOS }) })
    );
    assert.equal(d.classe, "(mesma chave)");
    assert.equal(ehCandidata(conversa({ extrato: extrato({ confianca: 0.69 }) })), false);
    assert.equal(ehCandidata(conversa({ extrato: extrato({ confianca: 0.7 }) })), true);
  });

  // --------------------------------------------------------------------------
  test("b506938f (Leandro): captação do site já existe -> ligar, sem sobrescrever", () => {
    const d = decidir(
      conversa({
        telefone: TEL_10,
        tags: [TAG_CEDENTE],
        extrato: extrato({ ...DADOS_CHEIOS }),
        captacao: captacao({
          nome: "Leandro Bittencourt Miranda",
          // O site já gravou 131.000; o extrato lê 131.163,29. O humano
          // escreveu primeiro, e o OCR não passa por cima dele.
          credito: 131000,
        }),
      })
    );
    const lig = comoLigar(d);

    assert.equal(lig.captacao_id, "fa8f1ffd-0000-4000-8000-00000000000a");
    assert.equal(lig.escrever.wa_conversa_id, ID_CONVERSA);

    // O CORAÇÃO DESTE TESTE: `credito` não pode aparecer no que se escreve.
    assert.equal(
      "credito" in lig.escrever,
      false,
      "credito ja estava preenchido: a ponte NAO pode sobrescrever"
    );

    // Os que estavam nulos, esses sim descem.
    assert.equal(lig.escrever.saldo_devedor, 80000);
    assert.equal(lig.escrever.parcelas_pagas, 42);
    assert.equal(lig.escrever.administradora, "Unifisa");
  });

  // --------------------------------------------------------------------------
  test("042a6def (Unifisa): opt_out -> excluir, e vence até a palavra nominal", () => {
    const so_opt_out = decidir(conversa({ tags: [TAG_CEDENTE], opt_out: true }));
    assert.equal(so_opt_out.classe, "excluir");
    assert.match(so_opt_out.motivo, /PEDIU PARA NAO RECEBER/);

    // A ORDEM sendo cobrada: uma decisão nominal mandando inserir, na mesma
    // conversa, NÃO tira o opt-out da frente.
    const com_palavra = decidir(
      conversa({
        tags: [TAG_CEDENTE],
        opt_out: true,
        nominal: { classe: "inserir", motivo: "alguem mandou inserir", quem: "teste" },
      })
    );
    assert.equal(com_palavra.classe, "excluir");
    assert.match(
      com_palavra.motivo,
      /PEDIU PARA NAO RECEBER/,
      "compliance vence palavra: o motivo tem de ser o do opt-out"
    );
  });

  // --------------------------------------------------------------------------
  test("9eb5f278 (Emerson): telefone da casa -> excluir", () => {
    const d = decidir(conversa({ telefone: TEL_CASA, tags: [TAG_CEDENTE] }));
    assert.equal(d.classe, "excluir");
    assert.match(d.motivo, /telefone da casa/);
  });

  test("ISCA: um dígito diferente do telefone da casa NÃO é da casa", () => {
    // 5519997561909 -> 5519997561900. Se este teste passar a excluir, a régua
    // da casa virou "parecido com" e engoliria cedente de verdade.
    const d = decidir(conversa({ telefone: "5519997561900", tags: [TAG_CEDENTE] }));
    assert.equal(d.classe, "inserir", `veio ${d.classe}: ${d.motivo}`);
  });

  // ---- 4b. COTA CANCELADA ---------------------------------------------------
  test("fc14bc83: etiqueta de cota cancelada -> excluir, por RÉGUA", () => {
    // `agente_ativo: "caetano"` não é enfeite — é a forma MEDIDA da `fc14bc83`
    // em 05/09/2026 (`tags: []`, extrato com confiança 0,6, agente caetano).
    //
    // E foi o teste que me corrigiu: escrito sem o agente, ele deu
    // `(mesma chave)`, porque `cota_cancelada` SOZINHA não torna ninguém
    // candidata. Isso está certo e vale dito: a etiqueta é freio, nunca
    // acelerador. Ela não puxa conversa nenhuma para dentro da régua — só
    // decide o destino de quem já entrou por outro motivo.
    const d = decidir(conversa({ tags: [TAG_COTA_CANCELADA], agente_ativo: "caetano" }));
    assert.equal(d.classe, "excluir", `veio ${d.classe}: ${d.motivo}`);
    assert.match(d.motivo, /cota cancelada/);
  });

  test("A etiqueta é FREIO, não acelerador: sozinha não torna candidata", () => {
    // O par do teste acima. Sem agente, sem tag `cedente` e sem extrato, a
    // conversa não é candidata — e continua não sendo depois do 4b. Se um dia
    // alguém puser `cota_cancelada` em `ehCandidata`, esta linha acende.
    const d = decidir(conversa({ tags: [TAG_COTA_CANCELADA] }));
    assert.equal(d.classe, "(mesma chave)", `veio ${d.classe}: ${d.motivo}`);
  });

  test("A ORDEM: com as DUAS etiquetas, cancelada vence cedente", () => {
    // Este é o teste que a coordenação pediu, e é o único que prova a POSIÇÃO
    // do braço. `cedente` sozinho manda para `inserir` (braço 9). Se o 4b
    // estivesse embaixo do 9, esta conversa viraria captação — alguém ligaria
    // para oferecer um negócio que a casa não faz.
    const so_cedente = decidir(conversa({ tags: [TAG_CEDENTE] }));
    assert.equal(so_cedente.classe, "inserir", "controle: cedente sozinho INSERE");

    const as_duas = decidir(conversa({ tags: [TAG_CEDENTE, TAG_COTA_CANCELADA] }));
    assert.equal(as_duas.classe, "excluir", `veio ${as_duas.classe}: ${as_duas.motivo}`);
    assert.match(as_duas.motivo, /cota cancelada/);

    // E a ordem das etiquetas no array não pode importar: `tags` é conjunto,
    // não sequência. Se importasse, a decisão dependeria de quem etiquetou
    // primeiro — que é o tipo de defeito que só aparece meses depois.
    const invertida = decidir(conversa({ tags: [TAG_COTA_CANCELADA, TAG_CEDENTE] }));
    assert.deepEqual(invertida, as_duas, "a ordem das etiquetas nao pode decidir nada");
  });

  test("A ORDEM: extrato cheio e contemplada NÃO salvam a cota cancelada", () => {
    // O caso que vai acontecer de verdade: a cliente manda o extrato, ele sai
    // com confiança alta e contemplada `true`. Sem o 4b em cima, isso é
    // `inserir` na hora. A etiqueta é o que segura.
    const d = decidir(
      conversa({
        tags: [TAG_CEDENTE, TAG_COTA_CANCELADA],
        extrato: extrato({ ...DADOS_CHEIOS, confianca: 0.98, contemplada: true }),
      })
    );
    assert.equal(d.classe, "excluir", `veio ${d.classe}: ${d.motivo}`);
    assert.match(d.motivo, /cota cancelada/);
  });

  test("A ORDEM: compliance e palavra de gente continuam acima do 4b", () => {
    // O 4b entrou DEPOIS do 2 e do 3, e isso tem de continuar verdade: quem
    // pediu para não receber não vira card por outro motivo, e a palavra de
    // gente continua vencendo a régua.
    const optout = decidir(
      conversa({ tags: [TAG_CEDENTE, TAG_COTA_CANCELADA], opt_out: true })
    );
    assert.match(optout.motivo, /opt_out/, `veio: ${optout.motivo}`);

    const motivo = "palavra de teste: esta segue mesmo cancelada";
    const nominal = decidir(
      conversa({
        tags: [TAG_COTA_CANCELADA],
        nominal: { classe: "revisar", motivo, quem: "coordenacao" },
      })
    );
    assert.equal(nominal.classe, "revisar", `veio ${nominal.classe}: ${nominal.motivo}`);
    assert.equal(nominal.motivo, motivo, "o motivo tem de ser o DELE, nao o da regua");
  });

  test("ISCA: a etiqueta é a constante, não a palavra solta", () => {
    // Se alguém trocar a comparação por `includes("cancelada")` ou por qualquer
    // casamento parcial, estas três passam a excluir — e conversa nenhuma
    // deveria sair do funil por causa de uma etiqueta que não existe.
    for (const t of ["cancelada", "cota-cancelada", "COTA_CANCELADA"]) {
      const d = decidir(conversa({ tags: [TAG_CEDENTE, t] }));
      assert.equal(d.classe, "inserir", `"${t}" nao pode valer por cota_cancelada`);
    }
  });

  // --------------------------------------------------------------------------
  test("ee6271c4 (Tamires): palavra do Emerson -> excluir, com o motivo dele", () => {
    const motivo =
      "palavra do Emerson 02/09/2026: nao seguir com esta, mesmo com minuta pedida";
    const d = decidir(
      conversa({
        tags: [TAG_CEDENTE],
        extrato: extrato({ ...DADOS_CHEIOS }),
        nominal: { classe: "excluir", motivo, quem: "Emerson" },
      })
    );
    assert.equal(d.classe, "excluir");
    assert.equal(d.motivo, motivo, "o motivo tem de ser o DELE, nao o da regua");
  });

  test("cda21b11 (Bruce): decisão nominal de parceria -> excluir", () => {
    const motivo =
      "quer ser parceiro Bidcon, nao vender cota: funil de parceria, nao captacao";
    const d = decidir(
      conversa({
        tags: [TAG_CEDENTE],
        nominal: { classe: "excluir", motivo, quem: "coordenacao" },
      })
    );
    assert.equal(d.classe, "excluir");
    assert.equal(d.motivo, motivo);
  });

  test("a palavra nominal vence a régua da casa (ordem 3 antes de 4)", () => {
    const motivo = "palavra nominal: revisar mesmo sendo numero conhecido";
    const d = decidir(
      conversa({
        telefone: TEL_CASA,
        tags: [TAG_CEDENTE],
        nominal: { classe: "revisar", motivo, quem: "coordenacao" },
      })
    );
    assert.equal(d.classe, "revisar");
    assert.equal(d.motivo, motivo, "se vier o motivo da casa, a ordem 3/4 inverteu");
  });

  test("palavra nominal que manda ESCREVER vira revisar, não escrita", () => {
    // Parede declarada: a ponte grava por régua, nunca por palavra. Hoje
    // nenhuma decisão nominal pede escrita; se um dia pedir, para em revisar.
    const d = decidir(
      conversa({
        tags: [TAG_CEDENTE],
        nominal: { classe: "inserir", motivo: "manda inserir", quem: "fulano" },
      })
    );
    assert.equal(d.classe, "revisar");
    assert.match(d.motivo, /a ponte nao escreve por palavra/);
  });

  // --------------------------------------------------------------------------
  test("b3372777: extrato diz contemplada=false -> excluir", () => {
    const d = decidir(
      conversa({ tags: [TAG_CEDENTE], extrato: extrato({ contemplada: false }) })
    );
    assert.equal(d.classe, "excluir");
    assert.match(d.motivo, /NAO esta contemplada/);
  });

  test("contemplada=null NÃO exclui — não saber não é saber que não", () => {
    const d = decidir(
      conversa({ tags: [TAG_CEDENTE], extrato: extrato({ contemplada: null }) })
    );
    assert.equal(d.classe, "inserir", `veio ${d.classe}: ${d.motivo}`);
  });

  // --------------------------------------------------------------------------
  test("b9365734 (~DH~): agente de compra, sem tag e sem extrato -> excluir", () => {
    const d = decidir(conversa({ agente_ativo: "valentina", n_intencao: 2 }));
    assert.equal(d.classe, "excluir");
    assert.match(d.motivo, /agente de compra/);
  });

  test("agente de compra COM tag de cedente não é excluído por isso", () => {
    const d = decidir(conversa({ agente_ativo: "valentina", tags: [TAG_CEDENTE] }));
    assert.equal(d.classe, "inserir", `veio ${d.classe}: ${d.motivo}`);
  });

  // --------------------------------------------------------------------------
  test("sem telefone brasileiro utilizável -> revisar", () => {
    const d = decidir(conversa({ telefone: "17841400000000000", n_intencao: 3 }));
    assert.equal(d.classe, "revisar");
    assert.match(d.motivo, /telefone brasileiro utilizavel/);
  });

  test("tobias (atende os dois lados), sem tag e sem extrato -> revisar", () => {
    const d = decidir(conversa({ agente_ativo: "tobias" }));
    assert.equal(d.classe, "revisar");
    assert.match(d.motivo, /a regua nao decide/);
  });

  test("caetano sozinho já basta para inserir", () => {
    const d = decidir(conversa({ agente_ativo: AGENTE_DE_CAPTACAO }));
    const linha = comoInserir(d);
    assert.equal(linha.wa_conversa_id, ID_CONVERSA);
  });

  test("ISCA: a MESMA conversa, só ligando opt_out, muda de classe", () => {
    const limpa = decidir(conversa({ agente_ativo: AGENTE_DE_CAPTACAO }));
    const suja = decidir(conversa({ agente_ativo: AGENTE_DE_CAPTACAO, opt_out: true }));
    assert.equal(limpa.classe, "inserir");
    assert.equal(suja.classe, "excluir");
    assert.notEqual(limpa.classe, suja.classe, "se as duas derem igual, opt_out virou enfeite");
  });

  // --------------------------------------------------------------------------
  test("não candidata por régua nenhuma -> (mesma chave), não desce", () => {
    const d = decidir(conversa({}));
    assert.equal(d.classe, "(mesma chave)");
    assert.match(d.motivo, /Nao desce para captacoes/);
  });
});

// ============================================================================
describe("FUNIL-01 ponte — N conversas para 1 captação", () => {
  test("segunda CANDIDATA na mesma chave -> nada (não insere segunda)", () => {
    const d = decidir(conversa({ tags: [TAG_CEDENTE], posto_na_chave: 2 }));
    assert.equal(d.classe, "nada");
    assert.match(d.motivo, /uma pessoa, uma captacao/);
  });

  test("captação já ligada a ESTA conversa -> nada (idempotente)", () => {
    const c = conversa({
      tags: [TAG_CEDENTE],
      captacao: captacao({ wa_conversa_id: ID_CONVERSA }),
    });
    const primeira = decidir(c);
    const segunda = decidir(c);
    assert.equal(primeira.classe, "nada");
    assert.match(primeira.motivo, /ja esta ligada a esta conversa/);
    assert.deepEqual(primeira, segunda, "rodar de novo tem de dar exatamente o mesmo");
  });

  test("captação já ligada a OUTRA conversa -> nada, sem confiar no índice", () => {
    const d = decidir(
      conversa({
        tags: [TAG_CEDENTE],
        captacao: captacao({ wa_conversa_id: ID_OUTRA_CONVERSA }),
      })
    );
    assert.equal(d.classe, "nada");
    assert.match(d.motivo, /captacoes_wa_conversa_viva_key/);
    assert.match(d.motivo, /Recuso antes do banco recusar/);
  });

  // --------------------------------------------------------------------------
  // O MUNDO DEPOIS DO BACKFILL
  //
  // As três fixtures abaixo não descrevem o banco de hoje: descrevem o banco de
  // DEPOIS que a F3.4 rodar. Elas existem porque o gatilho ao vivo vai reencontrar
  // as mesmas conversas todo dia, e a pergunta que importa é se ele REFAZ a conta
  // ou se ele RESPEITA o que já foi decidido.
  //
  // `inserir` deixa linha, `ligar` deixa `wa_conversa_id`, e `excluir` NÃO DEIXA
  // NADA. Por isso a memória da exclusão é a própria captação encerrada, e não uma
  // lista de pessoas — decisão da coordenação em 03/09/2026: estado, não pessoa.
  // Uma lista de excluídos erraria exatamente no dia em que a pessoa voltasse
  // querendo vender de verdade.
  // --------------------------------------------------------------------------

  test("DEPOIS DO BACKFILL — Tamires: captação PERDIDA na chave -> nada, e o motivo manda reabrir na mesa", () => {
    const d = decidir(
      conversa({
        tags: [TAG_CEDENTE],
        extrato: extrato({ ...DADOS_CHEIOS }),
        captacao: captacao({
          id: "6d4f46ea-0000-4000-8000-00000000000b",
          status: "perdida",
          atualizado_em: "2026-09-03T12:00:00Z",
          wa_conversa_id: null,
        }),
      })
    );

    assert.equal(d.classe, "nada", "captacao encerrada NAO se reabre sozinha");
    assert.match(d.motivo, /ENCERRADA/);
    assert.match(d.motivo, /perdida/);
    assert.match(d.motivo, /2026-09-03T12:00:00Z/, "a data entra no motivo: desde quando");
    assert.match(d.motivo, /decisao da mesa/, "reabrir e ato humano, na F4");

    // CONTROLE NEGATIVO — a mesma conversa, a mesma captação, mudando SÓ o status.
    // Sem isto, o teste acima passaria com um `decidir()` que devolve `nada` por
    // qualquer outro motivo, e eu não saberia que foi o braço 8b que recusou.
    const viva = decidir(
      conversa({
        tags: [TAG_CEDENTE],
        extrato: extrato({ ...DADOS_CHEIOS }),
        captacao: captacao({
          id: "6d4f46ea-0000-4000-8000-00000000000b",
          status: "novo",
          atualizado_em: "2026-09-03T12:00:00Z",
          wa_conversa_id: null,
        }),
      })
    );
    assert.equal(viva.classe, "ligar", "ISCA: viva, a MESMA conversa liga");
  });

  test("DEPOIS DO BACKFILL — Leandro: captação VIVA já ligada a esta conversa -> nada (segunda rodada é inerte)", () => {
    // Este é o par exato que a F3.4 vai escrever: a captação `fa8f1ffd` passa a
    // apontar para a conversa `b506938f`. Quando o script rodar a SEGUNDA vez —
    // e ele vai, logo depois de FUNIL=on, para varrer a fresta — tem de encontrar
    // este estado e não fazer nada. É o mesmo braço que o teste genérico de
    // idempotência exercita; o valor desta fixture é ser a âncora NOMINAL disso.
    const c = conversa({
      id: ID_CONVERSA,
      telefone: TEL_10,
      tags: [TAG_CEDENTE],
      extrato: extrato({ ...DADOS_CHEIOS }),
      captacao: captacao({
        status: "novo",
        wa_conversa_id: ID_CONVERSA,
        nome: "Leandro Bittencourt Miranda",
        credito: 131000,
      }),
    });

    assert.equal(decidir(c).classe, "nada");
    assert.match(decidir(c).motivo, /ja esta ligada a esta conversa/);
    assert.deepEqual(decidir(c), decidir(c), "rodar de novo da exatamente o mesmo");
  });

  test("DEPOIS DO BACKFILL — chave SEM captação nenhuma + extrato na borda (0,7) -> inserir", () => {
    const d = decidir(
      conversa({
        captacao: null,
        extrato: extrato({ ...DADOS_CHEIOS, confianca: 0.7 }),
      })
    );
    const linha = comoInserir(d);
    assert.equal(linha.credito, 131163.29);

    // A BORDA É INCLUSIVA e isso é `>=`, não `>`. O controle negativo mora um
    // centésimo abaixo: se alguém trocar o operador, este par acusa.
    //
    // E a resposta abaixo da borda foi MEDIDA, não suposta — eu tinha escrito
    // `revisar` aqui e o teste me reprovou. Com 0,69 e mais nada, a conversa não
    // é sequer CANDIDATA: cai no braço 1, `(mesma chave)`. Isso é mais afiado do
    // que eu esperava e diz o que a régua realmente faz: a confiança do extrato
    // não decide entre inserir e revisar, ela decide se a conversa ENTRA.
    const abaixo = decidir(
      conversa({
        captacao: null,
        extrato: extrato({ ...DADOS_CHEIOS, confianca: 0.69 }),
      })
    );
    assert.equal(
      abaixo.classe,
      "(mesma chave)",
      "ISCA: 0,69 sozinho nao torna a conversa candidata"
    );
  });
});

// ============================================================================
describe("FUNIL-01 ponte — as três decisões de negócio de 03/09", () => {
  test("consentimento_em é SEMPRE null, em toda linha que a ponte monta", () => {
    const casos = [
      conversa({ tags: [TAG_CEDENTE] }),
      conversa({ agente_ativo: AGENTE_DE_CAPTACAO }),
      conversa({ tags: [TAG_CEDENTE], extrato: extrato({ ...DADOS_CHEIOS }) }),
      conversa({ telefone: TEL_10, tags: [TAG_CEDENTE] }),
    ];
    for (const c of casos) {
      const linha = comoInserir(decidir(c));
      assert.equal(
        linha.consentimento_em,
        null,
        "CONSENTIMENTO-ZAP-01: no WhatsApp houve procura, nao aceite"
      );
    }
  });

  test("tipo_bem é SEMPRE null nesta fatia, mesmo com extrato cheio", () => {
    // A GARANTIA FICOU MAIS FORTE EM 03/09, e vale registrar por quê.
    //
    // Antes, a ponte lia o `dados` jsonb, e este teste passava um
    // `tipo_bem: "imovel"` LÁ DENTRO para provar em runtime que a fatia
    // ignorava o campo. Agora a ponte lê as colunas tipadas de
    // `extratos_cotas` — e `tipo_bem` NÃO É UMA COLUNA dessa tabela. Medido:
    // 0 de 34 extratos tinham a chave no jsonb, e a tabela nunca teve a
    // coluna.
    //
    // Resultado: não existe mais como escrever o caso ruim. Se você
    // acrescentar `tipo_bem` ao objeto abaixo, o TypeScript recusa antes de
    // o teste rodar. Saímos de "provado em runtime" para "impossível de
    // representar", que é a trava mais barata que existe.
    const linha = comoInserir(
      decidir(
        conversa({
          tags: [TAG_CEDENTE],
          extrato: extrato({ ...DADOS_CHEIOS }),
        })
      )
    );
    assert.equal(
      linha.tipo_bem,
      null,
      "TIPO-BEM-MENSAGEM-01: extrato cheio e ainda assim tipo_bem nulo"
    );
  });

  test("origem_chave é whatsapp:<CHAVE>, e a assimetria com o site é visível", () => {
    // Número de 11 dígitos: telefone e chave DIVERGEM, e é aqui que a
    // decisão aprovada aparece a olho nu.
    const onze = comoInserir(decidir(conversa({ telefone: TEL_11, tags: [TAG_CEDENTE] })));
    assert.equal(onze.telefone, "11998887766", "a coluna guarda o numero como veio");
    assert.equal(onze.origem_chave, "whatsapp:1198887766", "a chave e DDD + ultimos 8");
    assert.notEqual(
      `whatsapp:${onze.telefone}`,
      onze.origem_chave,
      "se estes dois forem iguais, alguem 'corrigiu' a chave para o telefone"
    );

    // Número de 10 dígitos: coincidem, porque DDD + 8 = o número inteiro.
    const dez = comoInserir(decidir(conversa({ telefone: TEL_10, tags: [TAG_CEDENTE] })));
    assert.equal(dez.telefone, "8281131987");
    assert.equal(dez.origem_chave, "whatsapp:8281131987");
  });

  test("telefone sai sem o 55 e NÃO ganha o nono dígito", () => {
    assert.equal(telefoneParaCaptacoes("5511998887766"), "11998887766");
    assert.equal(telefoneParaCaptacoes("+55 (11) 99888-7766"), "11998887766");
    assert.equal(
      telefoneParaCaptacoes("8281131987"),
      "8281131987",
      "dez digitos entram e dez digitos saem: a ponte nao inventa o 9"
    );
    assert.equal(telefoneParaCaptacoes(null), null);
    assert.equal(telefoneParaCaptacoes("123"), null);
  });
});

// ============================================================================
describe("FUNIL-01 ponte — o que ela NUNCA escreve", () => {
  test("a linha tem exatamente doze colunas, e são estas", () => {
    const linha = comoInserir(
      decidir(conversa({ tags: [TAG_CEDENTE], extrato: extrato({ ...DADOS_CHEIOS }) }))
    );
    assert.deepEqual(Object.keys(linha).sort(), [...COLUNAS_DA_LINHA].sort());
  });

  test("nenhuma coluna proibida aparece em linha nova nem em escrita existente", () => {
    const nova = comoInserir(
      decidir(conversa({ tags: [TAG_CEDENTE], extrato: extrato({ ...DADOS_CHEIOS }) }))
    );
    const lig = comoLigar(
      decidir(
        conversa({
          tags: [TAG_CEDENTE],
          extrato: extrato({ ...DADOS_CHEIOS }),
          captacao: captacao(),
        })
      )
    );

    for (const proibida of COLUNAS_PROIBIDAS) {
      assert.equal(proibida in nova, false, `${proibida} nao pode nascer da ponte`);
      assert.equal(proibida in lig.escrever, false, `${proibida} nao pode ser tocada`);
    }
    // Em voz alta, porque estes dois são os que doem: preço é palavra do
    // Emerson e observação é texto de gente.
    assert.equal("proposta_valor" in nova, false);
    assert.equal("observacao" in nova, false);
  });

  test("crédito zero do OCR vira null, não zero (captacoes_credito_positivo)", () => {
    const linha = comoInserir(
      decidir(
        conversa({
          tags: [TAG_CEDENTE],
          extrato: extrato({ ...DADOS_CHEIOS, valor_credito: 0 }),
        })
      )
    );
    assert.equal(linha.credito, null, "zero de OCR e leitura falha, nao credito de zero");
  });

  test("saldo devedor ZERO é legítimo e desce como zero (cota quitada)", () => {
    // Medido: existe extrato com `saldo_devedor: 0` no banco. Crédito zero é
    // leitura falha; saldo zero é cota quitada. Os dois zeros são diferentes.
    const linha = comoInserir(
      decidir(
        conversa({
          tags: [TAG_CEDENTE],
          extrato: extrato({ ...DADOS_CHEIOS, saldo_devedor: 0 }),
        })
      )
    );
    assert.equal(linha.saldo_devedor, 0);
  });

  test("A ARMADILHA DAS CEM VEZES: string é RECUSADA, nunca convertida", () => {
    // Hoje a coluna é `numeric` e atravessa o JSON como `number` (medido:
    // 22/22, com a isca do `text` devolvendo "string" para provar que a régua
    // sabe discordar). Se um dia entregar string, o leitor errado
    // ("131163.29" -> tira o ponto -> 13116329) faria cento e trinta e um mil
    // virar treze milhões, calado. O leitor estrito devolve null, o campo fica
    // vazio, e um humano vê que falta dado.
    assert.equal(numeroDoExtrato("131163.29"), null, "string tem de ser RECUSADA");
    assert.equal(numeroDoExtrato("131163,29"), null);
    assert.equal(numeroDoExtrato(131163.29), 131163.29, "numero passa inteiro");
    assert.equal(numeroDoExtrato(0), 0);
    assert.equal(numeroDoExtrato(-1), null);
    assert.equal(numeroDoExtrato(null), null);
    assert.equal(inteiroDoExtrato(42), 42);
    assert.equal(inteiroDoExtrato("42"), null, "ate inteiro em string e recusado");
    assert.equal(inteiroDoExtrato(42.5), null);

    // E o efeito na linha inteira: extrato com tudo em string vira captação
    // sem números, e não captação com números errados.
    //
    // O CAST É DELIBERADO E É O PONTO DO TESTE. Desde 03/09 o tipo diz
    // `number | null`, então escrever string aqui é ilegal para o
    // TypeScript — e é justamente por isso que o cast precisa existir: o que
    // se está simulando é o dia em que o RUNTIME entrega o que o TIPO
    // proíbe (driver novo, view intermediária, migração que troca a coluna
    // por text). Sem o cast, essa traição fica impossível de testar e a
    // defesa em runtime vira fé. Com ele, fica provada.
    const extratoTraidor = {
      valor_credito: "131163.29",
      saldo_devedor: "80000",
      parcelas_pagas: "42",
      administradora: "Unifisa",
    } as unknown as {
      valor_credito: number;
      saldo_devedor: number;
      parcelas_pagas: number;
      administradora: string;
    };

    const linha = comoInserir(
      decidir(
        conversa({
          tags: [TAG_CEDENTE],
          extrato: extrato(extratoTraidor),
        })
      )
    );
    assert.equal(linha.credito, null);
    assert.equal(linha.saldo_devedor, null);
    assert.equal(linha.parcelas_pagas, null);
    assert.equal(linha.administradora, "Unifisa", "texto continua sendo texto");
  });

  test("DUAS CASAS: valor de dois decimais atravessa IGUAL, e a terceira casa é cortada aqui, não no banco", () => {
    // O destino é `captacoes.credito numeric(14,2)` (medido no xtv). A fonte
    // é `numeric` SEM precisão: aceita qualquer escala. Quem atravessa é o
    // float64, que não guarda 0,29 exato.
    //
    // A FIXTURE que a coordenação pediu: um valor de dois decimais sai igual.
    assert.equal(reaisDoExtrato(131163.29), 131163.29, "duas casas saem intactas");
    assert.equal(reaisDoExtrato(0.1), 0.1);
    assert.equal(reaisDoExtrato(1061000), 1061000, "o maior credito medido no banco");
    assert.equal(reaisDoExtrato(80000), 80000);

    // CONTROLE NEGATIVO — sem ele este teste passaria com uma função que não
    // faz nada. A terceira casa TEM de ser cortada, e cortada AQUI, para o
    // banco nunca arredondar calado. Se algum dia `reaisDoExtrato` virar
    // identidade, esta linha cai.
    assert.equal(reaisDoExtrato(131163.294), 131163.29, "a terceira casa cai");
    assert.equal(reaisDoExtrato(131163.296), 131163.3, "e arredonda, nao trunca");
    assert.notEqual(reaisDoExtrato(131163.294), 131163.294, "ISCA: nao e identidade");

    // A severidade de `numeroDoExtrato` continua valendo: arredondar não
    // amoleceu a recusa de string.
    assert.equal(reaisDoExtrato("131163.29"), null, "string continua RECUSADA");
    assert.equal(reaisDoExtrato(-1), null);
    assert.equal(reaisDoExtrato(null), null);

    // E a contagem NÃO passa por aqui de propósito: arredondar antes faria
    // `42.001` virar `42` e passar por inteiro. Leitura suja tem de virar nulo.
    assert.equal(inteiroDoExtrato(42.001), null, "arredondar nao pode salvar inteiro sujo");
    assert.equal(reaisDoExtrato(42.001), 42, "mas em reais, 42.001 vira 42");

    // A linha inteira, ponta a ponta: o que entra com duas casas sai com duas.
    const linha = comoInserir(
      decidir(
        conversa({
          tags: [TAG_CEDENTE],
          extrato: extrato({ ...DADOS_CHEIOS, valor_credito: 131163.29 }),
        })
      )
    );
    assert.equal(linha.credito, 131163.29, "duas casas ate o fim da travessia");
  });

  test("o status da conversa não é fato medido: não existe no tipo de entrada", () => {
    // No SQL, `c.status` aparece só na coluna `sinais` (visor), nunca no
    // `case`. Uma conversa cancelada classifica igual a uma aberta — e isso é
    // deliberado: fechar a janela do atendimento não desfaz o que a pessoa
    // disse. Se alguém quiser mudar isso, muda nos dois lugares.
    assert.equal(
      Object.prototype.hasOwnProperty.call(conversa(), "status"),
      false,
      "se `status` entrar aqui, o SQL e a TS deixaram de ser gemeos"
    );
  });
});

// ============================================================================
// AGENTE-DESCONHECIDO-01 — A TRAVA, E A ÚNICA CÓPIA SOLTA DOS OITO NOMES
// ----------------------------------------------------------------------------
// POR QUE ESTE BLOCO EXISTE, EM UMA FRASE: os mesmos oito nomes de agente vivem
// em TRÊS lugares, e só DOIS têm quem os cobre.
//
//   1. `AgenteId` (`_prompt.ts:104`)  — a fonte.
//   2. `REGISTRO_AGENTES` (`ponte.ts`) — `Record<AgenteId, true>`: o compilador
//      amarra. Nome novo no tipo e a build fica vermelha AQUI até alguém
//      decidir em que lista ele entra. Não precisa de teste; precisa de build.
//   3. `MARCADOR_BASTAO` (`_prompt.ts:665`) — uma REGEX com os oito nomes
//      escritos à mão. NINGUÉM a cobre. É a cópia solta.
//
// O ESTRAGO QUE A TERCEIRA CAUSA, e é o pior dos três porque não acende luz:
// acrescente um agente ao tipo, escreva a persona, esqueça a regex — e o
// `##AGENTE:<novo>##` que o modelo emitir não casa. `cerebro.ts:717` devolve
// `proximoAgente = null`, `processar-background.ts:772` não escreve
// `agente_ativo`, e o bastão simplesmente não passa. O cliente fica com o
// agente errado, calado. O vigia 9 do Radar (handoff mudo) pegaria o SINTOMA
// dias depois, sem a causa.
//
// Este bloco NÃO conserta isso — a cura é uma linha dentro do próprio
// `_prompt.ts` (construir a regex de `Object.keys(AGENTES)`), que toca o módulo
// do atendimento e é o escopo da candidata `AGENTES-UMA-LISTA-01`. O que este
// bloco faz é garantir que, no dia em que a cópia solta desencontrar da fonte,
// a suíte reprove COM O NOME em vez de o handoff falhar em silêncio.
// ============================================================================

describe("AGENTE-DESCONHECIDO-01 — registro de agentes e a trava do bastão", () => {
  test("A CÓPIA SOLTA: MARCADOR_BASTAO aceita TODO nome de AGENTES_CONHECIDOS", () => {
    // O teste que justifica o bloco. Se reprovar, o nome que aparecer na
    // mensagem é um agente que a casa conhece e cujo bastão NÃO passa.
    for (const agente of AGENTES_CONHECIDOS) {
      assert.ok(
        MARCADOR_BASTAO.test(`Já te passo pra ela. ##AGENTE:${agente}##`),
        `MARCADOR_BASTAO nao reconhece "${agente}": o bastao dele nao passa e o handoff falha CALADO (cerebro.ts:717 devolve proximoAgente=null). Acrescente "${agente}" a regex em app/api/atende/_prompt.ts`
      );
    }
  });

  test("ISCA da cópia solta: um nome que não existe é RECUSADO", () => {
    // Sem esta linha, um `MARCADOR_BASTAO = /.*/` passaria no teste de cima e
    // a trava seria decoração. Regra 9: capaz de falhar.
    assert.equal(
      MARCADOR_BASTAO.test("texto ##AGENTE:agente_fantasma_xyz##"),
      false,
      "a regex aceitou um agente inexistente - ela nao esta travando nada"
    );
  });

  test("ISCA da âncora: o marcador só vale no FIM do texto", () => {
    // `\s*$` é parte da régua, não enfeite: um "##AGENTE:x##" no meio da frase
    // seria o modelo falando SOBRE o marcador, não emitindo-o.
    assert.equal(
      MARCADOR_BASTAO.test("##AGENTE:valentina## e ai eu continuo falando"),
      false,
      "a ancora \\s*$ sumiu: marcador no meio do texto passou a contar como bastao"
    );
    assert.ok(
      MARCADOR_BASTAO.test("fim da frase. ##AGENTE:valentina##\n  "),
      "CONTROLE POSITIVO: com espaco em branco depois AINDA tem de casar"
    );
  });

  test("o registro tem os OITO, e nenhum a mais", () => {
    assert.equal(AGENTES_CONHECIDOS.length, 8);
    assert.deepEqual(
      [...AGENTES_CONHECIDOS].sort(),
      ["aurora", "bento", "caetano", "prosperito", "serena", "tobias", "valentina", "vendanova"],
      "o registro desencontrou de AgenteId - se isto reprovar, a build ja deveria ter reprovado antes"
    );
  });

  test("DECISÃO REGISTRADA: prosperito e vendanova são CONHECIDOS e ficam FORA das três listas", () => {
    /* Não é omissão — é a decisão de 05/09/2026, medida antes de tomada, e este
     * teste existe para que mudá-la seja um ato deliberado e não um descuido.
     *
     * `prosperito` é 49 das 115 conversas do xtv (o maior bloco) e nenhuma delas
     * tem tag de cedente ou extrato: pô-lo em AGENTES_QUE_TORNAM_CANDIDATA faria
     * 44 conversas virarem `revisar` sem nada por que decidir. `tobias` está na
     * lista porque a presença dele PROVA que se tratou de uma cota; `prosperito`
     * é onde a conversa está antes de ser alguma coisa. `vendanova` é plano
     * novo, que não é contemplada. */
    for (const porta of ["prosperito", "vendanova"]) {
      assert.ok(
        AGENTES_CONHECIDOS.includes(porta),
        `${porta} tem de ser CONHECIDO - senao a trava apita nele todo dia`
      );
      assert.equal(
        AGENTES_QUE_TORNAM_CANDIDATA.includes(porta),
        false,
        `${porta} entrou em AGENTES_QUE_TORNAM_CANDIDATA: mede o custo antes (em 05/09 eram 44 conversas novas em revisar)`
      );
      assert.equal(AGENTES_DE_COMPRA.includes(porta), false);
      assert.notEqual(AGENTE_DE_CAPTACAO, porta);
    }
  });

  test("ehAgenteConhecido — null é ausência, não desconhecimento", () => {
    assert.equal(ehAgenteConhecido(null), true, "null ja tem tratamento nos bracos de cima");
    assert.equal(ehAgenteConhecido("caetano"), true, "CONTROLE POSITIVO");
    assert.equal(ehAgenteConhecido("prosperito"), true);
    assert.equal(
      ehAgenteConhecido("agente_fantasma_xyz"),
      false,
      "ISCA: se isto der true a trava nunca apita"
    );
  });

  test("O BRAÇO 10 DEIXOU DE SER MUDO: o motivo diz o NOME do agente desconhecido", () => {
    // `n_intencao: 2` é o que levanta a conversa (a régua de texto); o agente
    // fantasma não levanta nada sozinho, e é esse o ponto.
    const d = decidir(conversa({ agente_ativo: "agente_fantasma_xyz", n_intencao: 2 }));
    assert.equal(d.classe, "revisar");
    assert.match(
      d.motivo,
      /agente_fantasma_xyz/,
      "o motivo nao nomeia o agente: 'a regua nao sabe decidir' e 'a regua nao conhece este agente' voltaram a sair iguais"
    );
    assert.match(d.motivo, /regua vencida/);
  });

  test("PAR DA ISCA: agente CONHECIDO que cai no braço 10 NÃO é acusado de desconhecido", () => {
    // Sem este par, um motivo que gritasse "AGENTE DESCONHECIDO" sempre passaria
    // no teste de cima. É a linha que prova que o braço distingue os dois casos.
    const d = decidir(conversa({ agente_ativo: "prosperito", n_intencao: 2 }));
    assert.equal(d.classe, "revisar");
    assert.equal(
      /AGENTE DESCONHECIDO/.test(d.motivo),
      false,
      "prosperito e conhecido: acusa-lo de desconhecido faria a trava gritar em 49 conversas"
    );
  });
});
