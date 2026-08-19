// ============================================================================
// lib/sentinela/efeito-envio.ts — o que acontece com a LINHA depois do envio.
// AUTORIZADO: Emerson, 19/08/2026 — "teste 'falha não gasta toque' — a chave
// if ganha guarda".
// ----------------------------------------------------------------------------
// POR QUE ISTO SAIU DA ROTA
//
// A regra mais cara do Sentinela cabe numa frase: **o contador de toques só
// anda quando a mensagem SAI**. Ela vivia dentro de um `if (envio.ok)` no meio
// da varredura, onde `scripts/testes.mjs` não alcança — o arnês varre `lib/`,
// e só. Regra que ninguém consegue testar é regra que depende de quem lê o
// diff estar atento naquele dia.
//
// O TAMANHO DO ESTRAGO, MEDIDO E NÃO SUPOSTO
//
// Em 19/08/2026 a Meta recusou 75 envios com #132001. Medido no banco:
//
//   linhas_que_falharam  15   (15 pessoas distintas, retentadas 5 ciclos)
//   ainda_elegiveis      15
//   com_toque_gasto       0
//   com_ultimo_envio      0
//
// Zero toques queimados — o código estava certo. Mas as 20 linhas em
// `aguardando_template` carregam `max_toques = 1`. Um único incremento no
// caminho de falha tornaria `tentativas < max_toques` falso PARA SEMPRE, e
// essas pessoas sairiam da `sentinela_a_tocar` sem nunca ter recebido nada.
// Não haveria erro, não haveria alerta: a fila simplesmente encolheria. É o
// tipo de defeito que só aparece quando alguém pergunta "cadê fulano?".
//
// A GUARDA, ENTÃO, É: no caminho de falha o `patch` é `null` — a linha NÃO é
// tocada. Não é "atualiza com os mesmos valores", é não escrever. Assim a
// próxima varredura reencontra a linha exatamente como estava.
//
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO NÃO FAZ
//
// Não fala com o banco e não decide SE envia. Recebe o resultado do envio e
// devolve o efeito; quem aplica é a rota. Função pura para poder ser testada
// por mutação: trocar `patch: null` por um patch com `tentativas` tem de
// quebrar o teste, e quebra.
// ============================================================================

/** O que `sendTemplate` (lib/whatsapp/graph.ts) devolve. */
export type ResultadoEnvio = {
  ok: boolean;
  waMessageId?: string | null;
  erro?: string | null;
};

/** Os três contadores do `resumo.envios` da varredura. */
export type ContadorEnvio = "feitos" | "pulados" | "falhas";

export type EfeitoEnvio = {
  /** Qual contador do resumo anda. */
  contador: ContadorEnvio;
  /**
   * O que gravar em `sentinela_fila`. **`null` significa NÃO ESCREVER** — não
   * é um patch vazio, é a ausência de escrita. É aqui que mora a garantia de
   * que falha não gasta toque.
   */
  patch: {
    status?: string;
    tentativas?: number;
    ultimo_envio_em?: string;
    proximo_toque_em?: string;
  } | null;
  /** A linha que vai para `sentinela_log`. */
  log: { acao: string; detalhe: Record<string, unknown> };
};

/**
 * Traduz o resultado do envio no efeito sobre a linha da fila.
 *
 * TRÊS CAMINHOS, e a diferença entre o segundo e o terceiro é a que importa:
 *
 *   ok        — a mensagem saiu. Só aqui `tentativas` anda, e junto vão
 *               `ultimo_envio_em` e `proximo_toque_em` (o espaçamento de 72h).
 *               Gravar o toque sem gravar o próximo toque faria a pessoa ser
 *               reencontrada no ciclo seguinte com o toque já gasto.
 *
 *   opt_out   — a pessoa pediu para sair. É decisão DELA e é terminal:
 *               `status: "excluido"`. Não conta como falha nossa.
 *
 *   falha     — inclui a permanente (#132001, template rejeitado) e a
 *               transitória (timeout). Deliberadamente NÃO distinguimos as
 *               duas aqui: distinguir exigiria interpretar a mensagem de erro
 *               da Meta, e errar essa interpretação para o lado permanente
 *               mataria a linha. Ambas deixam a linha intacta; a repetição no
 *               `sentinela_log` é o sinal, e é o que o vigia do Radar lê.
 */
export function efeitoDoEnvio(args: {
  envio: ResultadoEnvio;
  /** `tentativas + 1` — o número do toque que ESTA execução representa. */
  toque: number;
  agora: Date;
  /** `ESPACAMENTO_MS` da varredura (72h). */
  espacamentoMs: number;
}): EfeitoEnvio {
  const { envio, toque, agora, espacamentoMs } = args;

  if (envio.ok) {
    return {
      contador: "feitos",
      patch: {
        status: "enviado",
        tentativas: toque,
        ultimo_envio_em: agora.toISOString(),
        proximo_toque_em: new Date(agora.getTime() + espacamentoMs).toISOString(),
      },
      log: { acao: "envio_ok", detalhe: { waMessageId: envio.waMessageId ?? null, toque } },
    };
  }

  if (envio.erro === "opt_out") {
    return {
      contador: "pulados",
      patch: { status: "excluido" },
      log: { acao: "parada_opt_out", detalhe: {} },
    };
  }

  return {
    contador: "falhas",
    // NÃO TOCA NA LINHA. Ver o cabeçalho: com `max_toques = 1`, escrever
    // `tentativas` aqui tiraria a pessoa da fila para sempre, em silêncio.
    patch: null,
    log: { acao: "envio_falha", detalhe: { erro: envio.erro ?? "erro_desconhecido" } },
  };
}
