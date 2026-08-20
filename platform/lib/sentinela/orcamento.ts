// ============================================================================
// Orçamento de relógio da varredura do Sentinela — TENTATIVAS-01
// AUTORIZADO: Emerson, 19/08/2026 ("maxDuration=300: aprovado como cinto"),
// sobre a medição do 504 de hoje.
// ----------------------------------------------------------------------------
// POR QUE ESTA ARITMÉTICA MORA AQUI E NÃO NA ROTA
//
// Mesma razão de `fila-resumo.ts`: `scripts/testes.mjs` varre `lib/` e NÃO varre
// rotas. Um `if` de tempo escrito dentro do `for` da rota é um `if` sem teste, e
// o defeito que ele conserta só se manifesta em produção, sob carga, uma vez por
// ciclo. Não dá para conferir isso a olho no dia seguinte.
//
// ----------------------------------------------------------------------------
// O QUE FOI MEDIDO, E POR QUE O NÚMERO ANTIGO ERA FICÇÃO
//
// A rota declarava `MAX_ENVIOS_POR_EXECUCAO = 15; // 15 × 2s = 30s, folga no
// maxDuration`. O 2s é o THROTTLE — só a espera, nada do trabalho. O trabalho
// real por iteração, medido nos deltas entre linhas consecutivas de
// sentinela_log em 19/08/2026:
//
//   envio_ok ....... 4,13s a 4,61s   (média 4,25s)   ← n = 14, ciclo das 15h
//   envio_falha .... 2,82s a 3,87s   (média 3,42s)   ← n = 15, ciclo das 09h
//
// O throttle de 2s ESTÁ DENTRO desses números: eles são a distância entre um
// carimbo e o seguinte. Ou seja, o modelo antigo contava a espera e ignorava a
// ida à Meta, o upsert em wa_conversas, a consulta de opt-out e o update da
// fila. 15 × 4,25s = 63,8s. Nunca coube em 60s.
//
// A consequência foi medida: 504 às 18:01 UTC de 19/08, com o 14º envio_ok
// carimbado no MESMO instante do kill.
//
// E o detalhe que faz este arquivo existir em vez de só um maxDuration maior:
// a rota morre ENTRE `sendTemplate` (route.ts:463) e o `update` da fila
// (route.ts:480). Nessa janela a Meta JÁ ENTREGOU a mensagem e a linha continua
// como estava — a varredura seguinte manda de novo. Subir o teto de tempo
// afasta a janela; não a fecha. Fechar é não COMEÇAR uma iteração que não cabe.
//
// ----------------------------------------------------------------------------
// POR QUE FALHAR FECHADO
//
// Se o relógio devolver coisa que não é número, `cabeMaisUmaIteracao` diz NÃO.
// Parar é visível: a execução assina o heartbeat com `interrompido_por_tempo` e
// com quantas linhas ficaram — alguém lê e sabe. Seguir seria apostar num
// relógio quebrado para evitar um 504 que é INVISÍVEL para a fila (ninguém
// escreve nada, e a linha volta na próxima varredura como se nada tivesse
// acontecido, tendo a pessoa recebido a mensagem).
// ============================================================================

export type Orcamento = {
  /** Teto de relógio da execução inteira, em ms. Espelha `maxDuration`. */
  tetoMs: number;
  /**
   * Custo de UMA iteração do laço no PIOR CASO MEDIDO, throttle incluído.
   * Pior caso, não média: a média deixa metade das iterações estourando.
   */
  custoIteracaoMs: number;
  /**
   * Reserva para o que roda DEPOIS do laço — `finalizar()` ainda precisa
   * escrever a linha `varredura_ok`. Sem esta reserva o orçamento aprovaria a
   * última iteração e o heartbeat morreria no kill, que é o pior dos dois
   * mundos: o trabalho foi feito e não ficou registro de que foi.
   */
  reservaFinalMs: number;
};

function finito(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Cabe mais UMA iteração completa dentro do que sobrou do relógio?
 *
 * Decorrido negativo (relógio andando para trás) vira 0: é torto, mas não é
 * motivo para parar a fila. Decorrido não-finito devolve `false` — ver
 * "POR QUE FALHAR FECHADO" no cabeçalho.
 */
export function cabeMaisUmaIteracao(o: Orcamento, decorridoMs: number): boolean {
  if (!finito(decorridoMs)) return false;
  if (!finito(o.tetoMs) || !finito(o.custoIteracaoMs) || !finito(o.reservaFinalMs)) {
    return false;
  }
  const decorrido = Math.max(0, decorridoMs);
  return decorrido + o.custoIteracaoMs + o.reservaFinalMs <= o.tetoMs;
}

/**
 * Quantas iterações cabem numa execução que começa agora, do zero.
 *
 * Não é o que governa o laço — quem governa é `cabeMaisUmaIteracao`, chamada a
 * cada volta com o relógio real, porque iteração barata (linha pulada por
 * opt-out) gasta muito menos que o pior caso e o laço deve aproveitar isso.
 * Este número existe para ir ESCRITO no heartbeat: sem ele, quem lê o log não
 * distingue "a página encheu" de "o relógio acabou" — a mesma confusão que pôs
 * 15 no log como se fosse população.
 */
export function iteracoesQueCabem(o: Orcamento): number {
  if (!finito(o.tetoMs) || !finito(o.custoIteracaoMs) || !finito(o.reservaFinalMs)) {
    return 0;
  }
  if (o.custoIteracaoMs <= 0) return 0; // custo zero daria Infinity
  const util = o.tetoMs - o.reservaFinalMs;
  if (util <= 0) return 0;
  return Math.max(0, Math.floor(util / o.custoIteracaoMs));
}
