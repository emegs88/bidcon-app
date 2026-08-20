// ============================================================================
// lib/sentinela/ciclo-envio.ts — o que é "O CICLO" quando se diz
// "envio_falha >= N no ciclo".
// AUTORIZADO: Emerson, 19/08/2026 — "vigia envio_falha >= N no Radar".
// ----------------------------------------------------------------------------
// POR QUE ISTO NÃO É UMA JANELA DE TEMPO
//
// A tentação é contar falhas "nas últimas 6 horas". Não serve, e o motivo é
// aritmética de cron: o Sentinela roda às 12h e 18h (2×/dia) e o RADAR roda a
// cada 3 horas (8×/dia). Uma janela fixa de 6h faz o RADAR das 00h20 olhar
// para trás e não encontrar o ciclo das 18h.
//
// E "não encontrar" seria a pior coisa possível, porque não vira silêncio
// neutro: vira `falhas = 0`, a condição é marcada como julgada, e a FASE 3
// FECHA o alerta grave que o RADAR das 21h20 tinha acabado de abrir. O vigia
// se desmentiria sozinho seis vezes por dia. É o FALSO SILÊNCIO + FECHAMENTO
// da Regra 19, chegando pela porta do relógio em vez da porta do `??`.
//
// Então a unidade é o CICLO, não a hora: agrupa-se o que o Sentinela fez numa
// mesma execução e julga-se a execução mais recente. Todos os oito RADARs do
// dia julgam o MESMO ciclo e chegam à MESMA conclusão — o alerta fica aberto
// enquanto a pane existir, e fecha quando um ciclo novo e limpo passar.
//
// COMO SE AGRUPA, e por que por lacuna e não por hora cheia
//
// Uma execução envia no máximo 15 mensagens com 2s de intervalo: cabe em ~30
// segundos. Duas execuções são separadas por 6 horas. Qualquer lacuna maior
// que uma hora, portanto, só pode ser fronteira entre execuções.
//
// Agrupar por hora cheia (`date_trunc('hour')`) funcionaria hoje e quebraria
// no dia em que o cron atrasasse e uma execução começasse às 11h59: metade das
// linhas cairia num balde, metade noutro, e um ciclo de 15 falhas viraria dois
// ciclos de 7 e 8 — ambos abaixo de qualquer limiar, e o vigia emudeceria
// exatamente sob a carga que ele existe para ver.
// ============================================================================

/** Uma linha de `sentinela_log` das que interessam ao envio. */
export type LinhaEnvio = { acao: string; criado_em: string };

/**
 * Uma hora. Ver o cabeçalho: uma execução inteira cabe em ~30s e duas
 * execuções distam 6h, então a fronteira é folgada dos dois lados.
 */
export const GAP_ENTRE_CICLOS_MS = 60 * 60 * 1000;

export type CicloEnvio = {
  falhas: number;
  feitos: number;
  inicio: string;
  fim: string;
};

/**
 * Reduz as linhas de log ao ÚLTIMO ciclo de envio.
 *
 * Devolve `null` em dois casos que o chamador deve tratar IGUAL — e o
 * tratamento é: **não marcar a condição como julgada**.
 *
 *   `linhas === null`  — não conseguimos ler o log. Julgar aqui seria julgar
 *                        no escuro.
 *
 *   lista vazia        — medimos e não houve envio nenhum na janela. Isso NÃO
 *                        prova que o envio está são; prova que ninguém estava
 *                        elegível. Marcar como julgada faria a FASE 3 fechar
 *                        um alerta de pane porque a fila secou — que é o
 *                        contrário de uma boa notícia.
 *
 * Só conta `envio_ok` e `envio_falha`. Qualquer outra ação (`aguardando_
 * template`, `parada_opt_out`, `varredura_ok`) é ignorada de propósito:
 * opt-out é decisão de quem recebe e inflaria o contador que decide o alerta.
 */
export function ultimoCicloDeEnvio(
  linhas: LinhaEnvio[] | null,
  gapMs: number = GAP_ENTRE_CICLOS_MS
): CicloEnvio | null {
  if (linhas === null || !Array.isArray(linhas)) return null;

  const relevantes = linhas
    .filter((l) => l.acao === "envio_ok" || l.acao === "envio_falha")
    .map((l) => ({ acao: l.acao, t: Date.parse(l.criado_em) }))
    .filter((l) => Number.isFinite(l.t))
    .sort((a, b) => a.t - b.t);

  if (relevantes.length === 0) return null;

  // Anda de trás para frente a partir da linha mais nova: o ciclo termina onde
  // aparece a primeira lacuna maior que `gapMs`.
  let i = relevantes.length - 1;
  while (i > 0 && relevantes[i].t - relevantes[i - 1].t <= gapMs) i--;
  const ciclo = relevantes.slice(i);

  return {
    falhas: ciclo.filter((l) => l.acao === "envio_falha").length,
    feitos: ciclo.filter((l) => l.acao === "envio_ok").length,
    inicio: new Date(ciclo[0].t).toISOString(),
    fim: new Date(ciclo[ciclo.length - 1].t).toISOString(),
  };
}
