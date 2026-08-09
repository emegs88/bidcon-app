// ============================================================================
// lib/farol/carrossel.ts — as duas partes PURAS do carrossel semanal
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-VISUAL-02", 09/08/2026:
// "as 6 melhores cartas da vitrine (menor custo ao mês, alternando
//  imóvel/veículo), uma por slide, no formato feed".
// ----------------------------------------------------------------------------
// POR QUE ISTO NÃO MORA NA ROTA: a intercalação e a legenda são as duas coisas
// desta fatia que dá para ERRAR EM SILÊNCIO — um carrossel com 5 imóveis e 1
// veículo continua publicando lindamente, e ninguém percebe até alguém olhar o
// grid. Aqui elas são funções sem banco e sem rede, e por isso têm teste. O
// resto da rota (Graph, idempotência) só é verificável em produção.
// ============================================================================
import {
  reais,
  pctAoMes,
  type CartaCarrossel,
} from "@/lib/carrossel-formato";

/** Slides de carta. 1 capa + 6 cartas + 1 CTA = 8 filhos, teto da Meta é 10. */
export const CARTAS_POR_CARROSSEL = 6;

/**
 * Intercala os dois tipos, um de cada vez, sempre pegando o mais barato ainda
 * disponível de cada lado. As listas ENTRAM já ordenadas por custo canônico
 * (é o que `candidatos()` devolve).
 *
 * QUANDO UM LADO ACABA, o outro completa. A alternância é um objetivo estético
 * — grid variado —, não uma regra de negócio: com 926 veículos e 1.656 imóveis
 * medidos hoje, nenhum dos dois lados chega perto de acabar, mas um filtro
 * futuro pode secar um deles, e aí é melhor um carrossel de 6 imóveis do que um
 * carrossel de 3 slides.
 *
 * COMEÇA PELO MAIS BARATO DOS DOIS, não por um tipo fixo: o slide 2 (primeiro
 * depois da capa) é o que mais gente vê, e ele tem que ser o melhor número que
 * a semana tem — não "o melhor imóvel porque imóvel vem primeiro no alfabeto".
 */
export function intercalar(
  imoveis: CartaCarrossel[],
  veiculos: CartaCarrossel[],
  quantidade: number = CARTAS_POR_CARROSSEL
): CartaCarrossel[] {
  const fila: CartaCarrossel[] = [];
  let i = 0;
  let v = 0;

  // `custoAm` já vem não-nulo de `candidatos()`, que filtra os nulos. O `?? Infinity`
  // é cinto de segurança para quem chamar esta função com outra lista.
  const custo = (c: CartaCarrossel) => c.custoAm ?? Infinity;
  let vezDoImovel =
    (imoveis[0] ? custo(imoveis[0]) : Infinity) <=
    (veiculos[0] ? custo(veiculos[0]) : Infinity);

  while (fila.length < quantidade && (i < imoveis.length || v < veiculos.length)) {
    if (vezDoImovel && i < imoveis.length) {
      fila.push(imoveis[i++]);
    } else if (!vezDoImovel && v < veiculos.length) {
      fila.push(veiculos[v++]);
    } else if (i < imoveis.length) {
      // O lado da vez acabou; o outro completa sem alternar mais.
      fila.push(imoveis[i++]);
    } else {
      fila.push(veiculos[v++]);
    }
    vezDoImovel = !vezDoImovel;
  }
  return fila;
}

/**
 * Legenda do carrossel: chamada + números resumidos + Conta Notarial + CTA.
 * Passa por `revisarLegenda()` na rota, como toda legenda desta casa.
 *
 * OS NÚMEROS APARECEM RESUMIDOS, uma linha por carta, na MESMA ordem dos
 * slides — quem lê a legenda consegue acompanhar arrastando. O custo sai por
 * `pctAoMes`, que é o único formato que passa na trava do "% a.m.".
 */
export function montarLegendaCarrossel(cartas: CartaCarrossel[]): string {
  const linhas: string[] = [];

  linhas.push("A tabela da semana");
  linhas.push("");
  linhas.push(
    "As cartas contempladas com o menor custo ao mês do nosso estoque agora. Arraste para ver todas."
  );
  linhas.push("");

  cartas.forEach((c, idx) => {
    // Cada carta em UMA linha: tipo, crédito, parcela e custo. Sem "R$" solto
    // sem número e sem percentual que não seja ao mês.
    const partes = [
      `${idx + 1}. ${c.tipoLabel} · ${reais(c.credito)}`,
      c.parcelas > 0 && c.parcela > 0 ? `${c.parcelas}x de ${reais(c.parcela)}` : null,
      `custo ${pctAoMes(c.custoAm)}`,
    ].filter(Boolean);
    linhas.push(partes.join(" · "));
  });

  linhas.push("");
  linhas.push(
    "Todas já estão contempladas: o poder de compra está disponível agora, sem depender de sorteio nem de lance."
  );
  linhas.push("");

  linhas.push(
    "Pagamento por Conta Notarial: o valor vai para uma conta vinculada no Banco Safra, atrelada exclusivamente ao negócio, com patrimônio segregado. O 5º Tabelionato de Notas de Campinas administra com fé pública e sem acesso ao valor — libera ao vendedor só depois que a administradora aprova a transferência; se não aprovar, o valor volta para o comprador."
  );
  linhas.push("");

  linhas.push(
    "Salve este post para consultar depois. A carta completa está no link da bio — prefere conversar? Chama no direct."
  );
  linhas.push("");

  // Mesmo rótulo de IA do post de feed, na mesma posição (fim), pela mesma
  // razão: no topo empurraria os números para fora da primeira dobra.
  linhas.push(
    "🤖 Publicado pelo assistente IA da Bidcon — atendimento humano no direct quando você quiser."
  );
  linhas.push("");

  linhas.push(
    "#consorcio #cartacontemplada #consorciodeimovel #consorciodeveiculo #planejamento #patrimonio #bidcon"
  );

  return linhas.join("\n");
}
