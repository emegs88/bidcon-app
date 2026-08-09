// ============================================================================
// lib/farol/selecao.test.ts — prova das três camadas da NOVA REGRA DE SELEÇÃO
// AUTORIZADO: Emerson Gomes dos Santos — 09/08/2026.
// ----------------------------------------------------------------------------
// Rodar com o runner nativo do Node, igual aos vizinhos:
//   npx tsx --tsconfig tsconfig.test.json --test lib/farol/selecao.test.ts
//
// POR QUE ESTE ARQUIVO EXISTE. A regra nova é uma ORDEM de desempates, e ordem
// de desempate é a espécie de código que falha calada: se a camada 2 comer a
// camada 3, ou se o teto do imóvel for aplicado ao veículo, nada explode — sai
// uma vitrine ligeiramente errada todo dia, e ninguém descobre olhando o post.
//
// O jeito de testar isso NÃO é jogar cartas variadas e conferir a ordem final:
// um teste desses passa com duas das três camadas mortas. Cada teste abaixo
// prende UMA camada, montando um par que EMPATA em todas as camadas anteriores
// — assim a única coisa capaz de decidir aquele par é a camada sob teste.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alavancagem,
  compararPelaRegra,
  dentroDoTeto,
  TETO_CUSTO_AM,
  MARGEM_TETO_VIEW,
  LIMITE_CANDIDATOS,
} from "./selecao";
import type { CartaCarrossel } from "@/lib/carrossel-formato";

/** Carta mínima. Só os quatro campos que a regra olha têm valor de verdade. */
function carta(over: Partial<CartaCarrossel> = {}): CartaCarrossel {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    tipo: "imovel",
    tipoLabel: "Imóvel",
    administradora: "Teste",
    credito: 300_000,
    entrada: 90_000,
    parcela: 2_500,
    parcelas: 120,
    custoAm: 0.5,
    exclusiva: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A métrica em si.
// ---------------------------------------------------------------------------

test("alavancagem é crédito por real de parcela — nada mais", () => {
  // 300.000 / 2.500 = 120: cada real de parcela carrega R$ 120 de crédito.
  assert.equal(alavancagem(carta()), 120);
  assert.equal(alavancagem(carta({ credito: 500_000, parcela: 2_500 })), 200);
});

test("parcela zero devolve 0, não Infinity", () => {
  // Se devolvesse Infinity, uma carta com dado faltando lideraria a vitrine —
  // o defeito viraria destaque. Sem parcela conhecida, a carta perde de todas.
  assert.equal(alavancagem(carta({ parcela: 0 })), 0);
  const semParcela = carta({ parcela: 0 });
  const normal = carta();
  assert.ok(compararPelaRegra(normal, semParcela) < 0, "carta sem parcela não pode vencer");
});

// ---------------------------------------------------------------------------
// CAMADA 2 — o ranking. Vem primeiro no comparador.
// ---------------------------------------------------------------------------

test("camada 2 · maior alavancagem vence, mesmo custando mais caro", () => {
  // Este é o teste que mostra a MUDANÇA de regra na cara: a carta vencedora é
  // a MAIS CARA das duas. Sob a regra antiga (só menor custo) ela perderia.
  const alavancada = carta({ id: "a", credito: 400_000, parcela: 2_000, custoAm: 0.9 }); // 200
  const barata = carta({ id: "b", credito: 300_000, parcela: 2_500, custoAm: 0.3 }); //     120
  assert.ok(compararPelaRegra(alavancada, barata) < 0, "o ranking não é mais o custo");
  assert.deepEqual([barata, alavancada].sort(compararPelaRegra).map((c) => c.id), ["a", "b"]);
});

test("camada 2 · crédito maior sozinho NÃO vence se a parcela cresce junto", () => {
  // "Maior crédito" não é critério isolado — é o numerador. Uma carta com o
  // dobro do crédito e o dobro da parcela empata, e cai para o desempate.
  const dobro = carta({ id: "dobro", credito: 600_000, parcela: 5_000, custoAm: 0.6 });
  const simples = carta({ id: "simples", credito: 300_000, parcela: 2_500, custoAm: 0.4 });
  assert.equal(alavancagem(dobro), alavancagem(simples));
  assert.ok(compararPelaRegra(simples, dobro) < 0, "empatou na camada 2, quem decide é o custo");
});

// ---------------------------------------------------------------------------
// CAMADA 3 — desempate. Só roda quando a 2 empata.
// ---------------------------------------------------------------------------

test("BANDA · o caso real b8328a93 × 7f251b5a — R$ 10 não vencem 0,02 p.p.", () => {
  // O caso que criou a banda, com os números medidos na vitrine de 09/08/2026.
  // As duas são Bradesco, imóvel, mesma parcela (878) e créditos separados por
  // R$ 10 num total de R$ 361 mil. Sem banda, b8328a93 liderava a vitrine por
  // 0,0028% de alavancagem, apesar de custar 0,02 p.p. a mais ao mês.
  // Se alguém remover a banda, este teste cai — e é para cair.
  const b8328a93 = carta({ id: "b8328a93", credito: 361_500, parcela: 878, custoAm: 0.49 });
  const _7f251b5a = carta({ id: "7f251b5a", credito: 361_490, parcela: 878, custoAm: 0.47 });

  const delta = (alavancagem(b8328a93) - alavancagem(_7f251b5a)) / alavancagem(b8328a93);
  assert.ok(delta > 0, "b8328a93 tem MESMO a alavancagem maior — o caso é esse");
  assert.ok(delta < 0.0001, "a diferença é ruído: menos de 0,01% relativo");

  assert.ok(
    compararPelaRegra(_7f251b5a, b8328a93) < 0,
    "dentro da banda de 0,5% quem manda é o menor custo, não R$ 10 de crédito"
  );
  assert.deepEqual(
    [b8328a93, _7f251b5a].sort(compararPelaRegra).map((c) => c.id),
    ["7f251b5a", "b8328a93"]
  );
});

test("BANDA · diferença REAL de alavancagem continua vencendo o custo", () => {
  // A banda não pode virar "custo manda de novo". 5% de diferença de
  // alavancagem está muito fora da grade de 0,5% e tem que decidir sozinha,
  // mesmo contra uma carta bem mais barata.
  const alavancada = carta({ id: "alav", credito: 315_000, parcela: 2_500, custoAm: 0.95 }); // 126
  const barata = carta({ id: "barata", credito: 300_000, parcela: 2_500, custoAm: 0.30 }); //   120
  assert.ok(compararPelaRegra(alavancada, barata) < 0, "5% de alavancagem é sinal, não ruído");
});

test("BANDA · a ordem é transitiva — grade, não vizinhança", () => {
  // A razão de a banda ser uma grade logarítmica e não um "|a−b| < 0,5%".
  // Com vizinhança, três cartas escadinha (cada uma 0,4% acima da anterior)
  // produzem A~B, B~C, A≠C — comparador inconsistente, e o `sort` do V8
  // devolve ordem que depende do tamanho do array. Aqui a ordem tem que ser a
  // mesma independentemente de como o array chegou.
  const base = 120;
  const escada = [0, 0.004, 0.008, 0.012, 0.016].map((d, i) =>
    carta({ id: `e${i}`, credito: Math.round(300_000 * (1 + d)), parcela: 2_500, custoAm: 0.5 - i * 0.01 })
  );
  assert.ok(alavancagem(escada[0]) >= base);

  const ordem = (arr: typeof escada) => arr.sort(compararPelaRegra).map((c) => c.id).join(",");
  const direto = ordem([...escada]);
  const invertido = ordem([...escada].reverse());
  const embaralhado = ordem([escada[2], escada[0], escada[4], escada[1], escada[3]]);
  assert.equal(direto, invertido, "a ordem mudou com a entrada — comparador inconsistente");
  assert.equal(direto, embaralhado, "a ordem mudou com a entrada — comparador inconsistente");
});

test("camada 3a · empate na alavancagem, ganha o menor custo ao mês", () => {
  const cara = carta({ id: "cara", custoAm: 0.8 });
  const barata = carta({ id: "barata", custoAm: 0.4 });
  assert.equal(alavancagem(cara), alavancagem(barata), "o par tem que empatar na camada 2");
  assert.ok(compararPelaRegra(barata, cara) < 0);
});

test("camada 3b · empate na alavancagem E no custo, ganha o maior crédito", () => {
  // O par mais difícil de montar: mesma alavancagem exige que crédito e parcela
  // subam juntos, e o custo tem que ser idêntico. Sem esse teste, a camada 3b
  // poderia estar invertida (menor crédito ganhando) sem ninguém perceber.
  const grande = carta({ id: "grande", credito: 600_000, parcela: 5_000, custoAm: 0.5 });
  const pequena = carta({ id: "pequena", credito: 300_000, parcela: 2_500, custoAm: 0.5 });
  assert.equal(alavancagem(grande), alavancagem(pequena));
  assert.ok(compararPelaRegra(grande, pequena) < 0, "no empate total, o crédito maior é o destaque");
});

test("custo ausente perde o desempate em vez de ganhar", () => {
  // `custoAm ?? Infinity`. Se fosse `?? 0`, uma carta sem custo calculável
  // ganharia todos os desempates — o pior comportamento possível para um campo
  // que só é nulo quando o dado está quebrado.
  const semCusto = carta({ id: "sem", custoAm: null as unknown as number });
  const comCusto = carta({ id: "com", custoAm: 0.9 });
  assert.ok(compararPelaRegra(comCusto, semCusto) < 0);
});

test("a ordem das camadas é 2 → 3a → 3b, e não outra qualquer", () => {
  // Uma carta que perde na camada 2 e ganha nas duas seguintes tem que perder.
  // É a prova de que o comparador não soma pesos: ele CORTA na primeira
  // diferença. Sem isto, "alavancagem" viraria só mais um voto.
  const perdeNaDois = carta({ id: "perde", credito: 900_000, parcela: 9_000, custoAm: 0.1 }); // 100
  const ganhaNaDois = carta({ id: "ganha", credito: 300_000, parcela: 2_500, custoAm: 0.99 }); // 120
  assert.ok(alavancagem(ganhaNaDois) > alavancagem(perdeNaDois));
  assert.ok(perdeNaDois.custoAm! < ganhaNaDois.custoAm!, "o perdedor é mais barato");
  assert.ok(perdeNaDois.credito > ganhaNaDois.credito, "e tem mais crédito");
  assert.ok(compararPelaRegra(ganhaNaDois, perdeNaDois) < 0, "a camada 2 decide sozinha");
});

test("o comparador é uma ordem estável e consistente", () => {
  // Antissimetria e reflexividade. `Array.prototype.sort` com um comparador
  // inconsistente produz ordem dependente do motor — o carrossel de sábado
  // sairia diferente do post de segunda com o mesmo estoque.
  const a = carta({ id: "a", credito: 400_000, parcela: 2_000, custoAm: 0.7 });
  const b = carta({ id: "b", credito: 300_000, parcela: 2_500, custoAm: 0.3 });
  assert.equal(compararPelaRegra(a, a), 0);
  assert.equal(Math.sign(compararPelaRegra(a, b)), -Math.sign(compararPelaRegra(b, a)));
});

// ---------------------------------------------------------------------------
// CAMADA 1 — o filtro. Não ordena: elimina.
// ---------------------------------------------------------------------------

test("camada 1 · cada tipo é medido pelo teto DELE", () => {
  // O erro que este teste pega é o mais provável de todos: aplicar um teto só,
  // ou trocar os dois. 1,20% a.m. é reprovado no imóvel e aprovado no veículo.
  assert.equal(dentroDoTeto(carta({ tipo: "imovel", custoAm: 1.2 })), false);
  assert.equal(dentroDoTeto(carta({ tipo: "veiculo", custoAm: 1.2 })), true);
  assert.equal(dentroDoTeto(carta({ tipo: "veiculo", custoAm: 1.9 })), false);
  // 1,64% a.m. era o TOPO de veículo enquanto o teto foi 1,85 — foi essa carta
  // publicável ao lado de uma de 0,30% que motivou baixar o teto para 1,50.
  assert.equal(dentroDoTeto(carta({ tipo: "veiculo", custoAm: 1.64 })), false);
});

test("camada 1 · o teto é inclusivo — carta exatamente no limite disputa", () => {
  // Fechado por cima. Uma carta em 1,0000% a.m. não pode ser descartada por
  // um `<` distraído: ela cumpre o teto.
  assert.equal(dentroDoTeto(carta({ tipo: "imovel", custoAm: TETO_CUSTO_AM.imovel })), true);
  assert.equal(dentroDoTeto(carta({ tipo: "veiculo", custoAm: TETO_CUSTO_AM.veiculo })), true);
  assert.equal(dentroDoTeto(carta({ tipo: "imovel", custoAm: TETO_CUSTO_AM.imovel + 0.001 })), false);
});

test("camada 1 · carta sem custo calculável não disputa", () => {
  // Sem custo não dá para saber se ela cabe no teto. O default é fora.
  assert.equal(dentroDoTeto(carta({ custoAm: null as unknown as number })), false);
});

test("camada 1 · tipo sem teto cadastrado PASSA, de propósito", () => {
  // Decisão declarada no módulo: se amanhã nascer um `tipo` novo na vitrine, o
  // certo é ele aparecer e alguém decidir o teto — não sumir de todas as peças
  // do FAROL no dia do deploy, em silêncio.
  assert.equal(dentroDoTeto(carta({ tipo: "servico", custoAm: 9.9 })), true);
});

test("os tetos e a folga do banco são os números medidos", () => {
  // Estes três números vieram de medição, não de gosto. Se alguém mexer neles
  // sem refazer a medição, este teste é o lugar onde a conversa recomeça.
  assert.equal(TETO_CUSTO_AM.imovel, 1.0);
  // Veículo baixou de 1,85 para 1,50 em 09/08/2026 — decisão de marca sobre a
  // faixa publicável, com o ranking intacto. Ver o comentário de TETO_CUSTO_AM.
  assert.equal(TETO_CUSTO_AM.veiculo, 1.5);
  // Maior desvio medido entre a coluna `custo_am` da view (2 casas) e o cálculo
  // canônico: 0,005047 p.p. A folga tem que cobrir isso com sobra e ainda ser
  // pequena perto do teto — senão ela deixaria de ser folga e viraria um teto
  // segundo, mais frouxo, escondido na consulta.
  assert.ok(MARGEM_TETO_VIEW > 0.005047, "a folga não cobre o desvio medido da view");
  assert.ok(MARGEM_TETO_VIEW < TETO_CUSTO_AM.imovel / 10, "folga grande demais vira outro teto");
});

test("o limite de candidatos cobre a população elegível medida", () => {
  // MEDIDO em 09/08/2026: 278 imóveis e 42 veículos passam no teto. O limite
  // era 80 — e com 80 a "melhor carta da vitrine" seria só a melhor entre as 80
  // MAIS BARATAS, o que sob ranking por alavancagem não quer dizer nada.
  assert.ok(LIMITE_CANDIDATOS >= 320, "o limite voltou a cortar a população elegível");
});

// ---------------------------------------------------------------------------
// Camada 1 e camada 2 juntas — a parte que só se vê no conjunto.
// ---------------------------------------------------------------------------

test("carta cara com alavancagem altíssima é eliminada, não promovida", () => {
  // O caso que justifica a camada 1 existir ANTES do ranking. Sem o filtro,
  // esta carta lideraria a vitrine — 250 de alavancagem — a 1,70% a.m. num
  // imóvel. A camada 1 nem deixa ela chegar ao comparador.
  const predadora = carta({ id: "p", tipo: "imovel", credito: 500_000, parcela: 2_000, custoAm: 1.7 });
  const honesta = carta({ id: "h", tipo: "imovel", credito: 300_000, parcela: 2_500, custoAm: 0.6 });
  assert.ok(alavancagem(predadora) > alavancagem(honesta), "ela ganharia no ranking puro");
  const fila = [predadora, honesta].filter(dentroDoTeto).sort(compararPelaRegra);
  assert.deepEqual(fila.map((c) => c.id), ["h"], "a camada 1 tinha que ter eliminado a predadora");
});
