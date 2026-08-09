// ============================================================================
// lib/farol/responde.test.ts — prova das travas de privacidade da série
// "Responde, Porta-voz".
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE. A OS mandou que a privacidade da série fosse
// regra dura de CÓDIGO, e não instrução de prompt. `podePublicar()` cumpre a
// letra disso — mas uma função determinística que ninguém executa é só um
// prompt escrito em TypeScript. O que separa "está no código" de "está
// garantido" é este arquivo rodando no `npm test`.
//
// O que se testa aqui NÃO é se a função devolve string ou null. É se cada uma
// das quatro travas recusa aquilo que ela foi escrita para recusar, uma por
// uma, com a pergunta que passaria por todas as outras. Testar as quatro
// juntas com um texto que viola tudo passaria mesmo se três estivessem
// mortas.
//
// E se testa a relação entre os dois limiares — gravar no acervo e publicar no
// Instagram. Ela é a única regra deste sistema que mora em dois arquivos.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  podePublicar,
  montarRoteiroResposta,
  montarLegendaResposta,
  MIN_OCORRENCIAS_PUBLICO,
  type PerguntaFaq,
  type TextoResposta,
} from "./responde";
import { MIN_OCORRENCIAS_ACERVO, anonimizar } from "./saber";

/**
 * A pergunta-controle: passa nas quatro travas. Cada teste abaixo altera UM
 * campo dela. Assim, quando um teste falha, a causa é o campo que ele mexeu —
 * não sobra dúvida sobre qual trava reagiu.
 */
function base(over: Partial<PerguntaFaq> = {}): PerguntaFaq {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    titulo: "Somar duas cartas",
    conteudo: "da pra juntar duas cartas de credito para comprar um imovel maior",
    ocorrencias: 5,
    ...over,
  };
}

test("a pergunta-controle passa — senão os testes de recusa não provam nada", () => {
  // Este teste é a fundação dos outros. Se a controle já estivesse sendo
  // recusada por algum motivo lateral, todos os testes de recusa abaixo
  // passariam por engano, e a suíte inteira viraria enfeite.
  assert.equal(podePublicar(base()), null);
});

// ---------------------------------------------------------------------------
// TRAVA 1 — ocorrências. A mais forte e a menos óbvia.
// ---------------------------------------------------------------------------

test("trava 1 · pergunta de uma pessoa só não vira reel", () => {
  const motivo = podePublicar(base({ ocorrencias: 1 }));
  assert.ok(motivo, "uma pergunta feita por uma pessoa é a pergunta DAQUELA pessoa");
  assert.match(motivo!, /poucas_ocorrencias/);
});

test("trava 1 · o limiar é fechado por baixo e aberto a partir do valor", () => {
  // O off-by-one aqui não daria erro visível: recusaria calado uma pergunta
  // legítima (barato) ou publicaria uma pergunta de duas pessoas (caro). Só um
  // teste nos dois lados da borda distingue os dois casos.
  assert.ok(podePublicar(base({ ocorrencias: MIN_OCORRENCIAS_PUBLICO - 1 })));
  assert.equal(podePublicar(base({ ocorrencias: MIN_OCORRENCIAS_PUBLICO })), null);
});

test("trava 1 · ocorrencias ausente é tratado como zero, não como aprovação", () => {
  // Uma linha vinda do banco com a coluna nula não pode virar publicação por
  // `undefined < 3` ser `false`. O `?? 0` do código é justamente isto.
  const suja = { ...base(), ocorrencias: undefined as unknown as number };
  assert.match(podePublicar(suja)!, /poucas_ocorrencias/);
});

test("PUBLICAR exige mais gente do que GRAVAR", () => {
  // A regra que mora em dois arquivos. Gravar serve ao cérebro do WhatsApp ler;
  // publicar joga a mesma frase no Instagram inteiro. São dois atos com riscos
  // diferentes, e por isso dois números — mas a ORDEM entre eles não é
  // negociável, e é só isto que este teste segura.
  assert.ok(
    MIN_OCORRENCIAS_PUBLICO > MIN_OCORRENCIAS_ACERVO,
    `publicar (${MIN_OCORRENCIAS_PUBLICO}) tem que ser mais exigente que gravar (${MIN_OCORRENCIAS_ACERVO})`
  );
});

// ---------------------------------------------------------------------------
// TRAVA 2 — marcador de redação. O texto foi anonimizado, logo tinha dado.
// ---------------------------------------------------------------------------

test("trava 2 · qualquer marcador de redação barra a publicação", () => {
  // Um a um, e não numa frase com todos: com todos juntos, três marcadores
  // podendo ter caído da regex passariam despercebidos.
  const marcadores = ["[telefone]", "[email]", "[numero]", "[cpf]", "[cnpj]", "[perfil]", "[link]"];
  for (const m of marcadores) {
    const p = base({ conteudo: `da pra falar com voces pelo ${m} para carta de imovel` });
    const motivo = podePublicar(p);
    assert.equal(
      motivo,
      "contem_marcador_de_redacao",
      `marcador ${m} passou — a anonimização trabalhou e a publicação ignorou`
    );
  }
});

// ---------------------------------------------------------------------------
// TRAVA 3 — anonimizar() de novo, contra a versão de HOJE da função.
// ---------------------------------------------------------------------------

test("trava 3 · dado pessoal cru recusa mesmo sem marcador nenhum", () => {
  // Este é o caso que a trava 2 NÃO pega: a linha foi gravada quando
  // `anonimizar()` ainda não reconhecia esta forma, então não há marcador
  // algum no texto — só o dado, inteiro. A trava roda a função de hoje contra
  // o dado de ontem.
  const casos = [
    "da pra falar no meu email joao.silva@gmail.com sobre carta de imovel",
    "quanto fica a carta se eu ligar no (11) 98765-4321 hoje",
    "voces atendem quem tem cnpj 12.345.678/0001-95 para carta de veiculo",
    "da pra ver a carta pelo link https://exemplo.com/anuncio/123 que mandei",
  ];
  for (const conteudo of casos) {
    // Garantia de que o caso é o que eu digo que é: sem marcador (senão a
    // trava 2 responderia antes e este teste não provaria a trava 3).
    assert.ok(!/\[(telefone|email|numero|cpf|cnpj|perfil|link)\]/.test(conteudo));
    assert.notEqual(anonimizar(conteudo), conteudo, "caso mal escolhido: não tem dado cru");

    assert.equal(
      podePublicar(base({ conteudo })),
      "anonimizacao_ainda_mudaria_o_texto",
      `passou com dado cru: ${conteudo}`
    );
  }
});

test("trava 3 · nada que passa sobreviveria a uma segunda anonimização", () => {
  // A forma geral da trava 3, dita como invariante em vez de por exemplo: se
  // `podePublicar` liberou, então o texto é ponto fixo de `anonimizar`. É esta
  // a propriedade que o header do módulo promete.
  const p = base();
  assert.equal(podePublicar(p), null);
  assert.equal(anonimizar(p.conteudo), p.conteudo);
});

// ---------------------------------------------------------------------------
// TRAVA 4 — tamanho.
// ---------------------------------------------------------------------------

test("trava 4 · texto curto demais não é pergunta e texto longo demais é desabafo", () => {
  assert.match(podePublicar(base({ conteudo: "e ai" }))!, /curta_demais/);
  assert.match(podePublicar(base({ conteudo: "oi ".repeat(200) }))!, /longa_demais/);
});

test("trava 4 · o desabafo longo é barrado ANTES de qualquer coisa cara", () => {
  // Um desabafo carrega contexto pessoal que regex nenhuma pega ("meu pai
  // faleceu e a cota ficou..."). Não há trava semântica para isso — o
  // comprimento é a única defesa, e por isso ela não pode ser cosmética.
  const desabafo =
    "gente eu queria muito entender uma coisa porque ja faz tempo que eu venho ".repeat(3) +
    "tentando resolver isso e ninguem me explica direito o que acontece com a cota";
  assert.ok(desabafo.length > 200);
  assert.match(podePublicar(base({ conteudo: desabafo }))!, /longa_demais/);
});

// ---------------------------------------------------------------------------
// Contrato de saída e ordem das travas.
// ---------------------------------------------------------------------------

test("o motivo da recusa nunca devolve o texto da pergunta junto", () => {
  // O motivo vai para o log e para o corpo da resposta HTTP da rota. Se ele
  // carregasse o texto recusado, a trava viraria o vazamento: a pergunta que
  // NÃO podia sair estaria no log justamente por não poder sair.
  const sensivel = "da pra falar no meu email joao.silva@gmail.com sobre a carta";
  const motivo = podePublicar(base({ conteudo: sensivel }))!;
  assert.ok(motivo);
  assert.ok(!motivo.includes("joao"), "o motivo vazou o dado que ele recusou");
  assert.ok(!motivo.includes("@"), "o motivo vazou o dado que ele recusou");
});

test("a trava mais barata responde primeiro", () => {
  // Uma pergunta que viola tudo devolve `poucas_ocorrencias`, não o motivo mais
  // dramático. Importa porque a ordem é o que impede a função de rodar regex e
  // `anonimizar()` em texto que já estava descartado na primeira linha.
  const tudo = base({ ocorrencias: 0, conteudo: "email joao@x.com [telefone] " + "x".repeat(400) });
  assert.match(podePublicar(tudo)!, /poucas_ocorrencias/);
});

// ---------------------------------------------------------------------------
// A costura do roteiro. É código porque é a série — ver header do módulo.
// ---------------------------------------------------------------------------

const TEXTO: TextoResposta = {
  pergunta: "Da pra somar duas cartas?",
  resposta: "Da sim, quando as duas sao do mesmo tipo de bem.",
  cta: "Chama no WhatsApp que o time confere com voce.",
  legenda: "Duvida que chega toda semana no nosso WhatsApp.",
  hashtags: ["#consorcio", "#cartadecredito", "#planejamento"],
};

test("o roteiro sai sempre na ordem pergunta, resposta, CTA", () => {
  // A ordem é a série. Deixar o modelo montá-la produziria, algum dia, um
  // roteiro com duas perguntas ou sem CTA — e ninguém veria antes do vídeo no
  // ar.
  const r = montarRoteiroResposta(TEXTO);
  assert.ok(r.indexOf(TEXTO.pergunta) < r.indexOf(TEXTO.resposta));
  assert.ok(r.indexOf(TEXTO.resposta) < r.indexOf(TEXTO.cta));
});

test("o roteiro falado não leva hashtag nem legenda junto", () => {
  // O roteiro vira ÁUDIO. Uma hashtag que vaze para cá é o avatar lendo
  // "jogo da velha consórcio" em voz alta.
  const r = montarRoteiroResposta(TEXTO);
  assert.ok(!r.includes("#"));
  assert.ok(!r.includes(TEXTO.legenda));
});

test("a legenda leva as hashtags, e sem elas não sobra separador solto", () => {
  assert.ok(montarLegendaResposta(TEXTO).endsWith("#planejamento"));
  const semTags = montarLegendaResposta({ ...TEXTO, hashtags: [] });
  assert.equal(semTags, TEXTO.legenda);
  assert.ok(!semTags.endsWith("\n"));
});
