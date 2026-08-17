// ============================================================================
// lib/radar/eventos.ts — FATIA SENTINELA-RADAR-01, Parte 2
// Ler `eventos_sync.detalhe`, que é TEXTO e não jsonb.
// AUTORIZADO: Emerson, 15/08/2026.
// ----------------------------------------------------------------------------
// Medido em 16/08/2026: a coluna é `text`. O RADAR precisa do número de
// divergências e da taxa da prova de amostra, e os dois estão dentro dessa
// string. Parsear texto é onde nasce bug silencioso — por isso mora aqui,
// puro e testado, em vez de virar um `.split()` no meio da rota.
//
// ----------------------------------------------------------------------------
// DUAS GRAMÁTICAS, MEDIDAS NO BANCO
//
//   ciclo_integridade_falhou:
//     "CBC divergencias=1 ciclo=2026-08-15 13:01:23.269956+00"
//     ↑ token NU na frente (a fonte), depois pares.
//
//   sync_raw_ausente / sync_raw_ok / sync_raw_desenho:
//     "fonte=CARTAS espera=1 lidas=198 recebidas=0 faltando=198 admin=1 url=…"
//     ↑ só pares; a fonte vem em `fonte=`.
//
// A ARMADILHA: em `ciclo=2026-08-15 13:01:23.269956+00` o VALOR tem espaço.
// Quebrando por espaço, `13:01:23.269956+00` aparece como um segundo token nu.
// Quem pegasse "o último token nu" leria o horário como se fosse a fonte, e o
// RADAR abriria um alerta chamado `13:01:23.269956+00` — uma chave nova a cada
// ciclo, o oposto de "um alerta por condição". Por isso o rótulo é o PRIMEIRO
// token nu, e só ele.
//
// Nada aqui adivinha: campo ausente é `null`, não zero. Zero é uma afirmação
// ("li e não havia nada"), e afirmar isso a partir de uma string que não tinha
// o campo é como o RADAR começaria a mentir.
// ============================================================================

export type DetalheLido = {
  /** O primeiro token sem `=`. É a fonte no formato do ciclo. */
  rotulo: string | null;
  campos: Record<string, string>;
};

export function lerDetalhe(texto: string | null | undefined): DetalheLido {
  const campos: Record<string, string> = {};
  let rotulo: string | null = null;
  if (typeof texto !== "string" || texto.trim() === "") return { rotulo, campos };

  for (const token of texto.trim().split(/\s+/)) {
    const corte = token.indexOf("=");
    if (corte <= 0) {
      // Token nu. Só o PRIMEIRO conta — ver a armadilha no cabeçalho.
      if (rotulo === null && token !== "") rotulo = token;
      continue;
    }
    const chave = token.slice(0, corte);
    // Primeira ocorrência vence: se a mesma chave aparecer duas vezes, a
    // segunda é lixo de formatação, não correção.
    if (!(chave in campos)) campos[chave] = token.slice(corte + 1);
  }
  return { rotulo, campos };
}

/**
 * Qual fonte o evento descreve. Cobre as duas gramáticas de uma vez: `fonte=`
 * quando existe, o token nu quando não. Devolve `null` quando nenhuma das duas
 * responde — e nesse caso o vigia não tem por onde abrir alerta, o que é o
 * comportamento certo.
 */
export function fonteDe(lido: DetalheLido): string | null {
  const porCampo = lido.campos.fonte?.trim();
  if (porCampo) return porCampo;
  const porRotulo = lido.rotulo?.trim();
  return porRotulo ? porRotulo : null;
}

/**
 * Número de um campo, ou `null`. Recusa o que não for finito — `"abc"` daria
 * NaN, e NaN comparado a qualquer limiar é falso: alarme mudo. Recusa também o
 * campo vazio, que `Number("")` transformaria em 0.
 */
export function numeroDe(lido: DetalheLido, chave: string): number | null {
  const cru = lido.campos[chave];
  if (typeof cru !== "string" || cru.trim() === "") return null;
  const n = Number(cru);
  return Number.isFinite(n) ? n : null;
}

/** Atalho para o par que o vigia 1 consome. */
export function divergenciasDe(texto: string | null | undefined): {
  fonte: string | null;
  divergencias: number | null;
} {
  const lido = lerDetalhe(texto);
  return { fonte: fonteDe(lido), divergencias: numeroDe(lido, "divergencias") };
}

/**
 * Atalho para o par que o vigia de "sync saudável que não move nada" consome.
 *
 * A gramática do `sync_fim`, medida em 16/08/2026 no xtv:
 *   "total_ms=22736 fontes_ok=5 fontes_falha=0"
 *
 * Só pares, sem token nu, sem contagem por fonte — é por isso que a pergunta
 * "quantas linhas cada fonte devolveu neste ciclo" não se responde por aqui, e
 * sim pelos `sync_raw_*`.
 *
 * Devolve `null` em vez de zero quando o campo falta, e a distinção é o ponto:
 * `fontes_falha` ausente significa "não sei se alguma falhou", enquanto zero
 * significa "nenhuma falhou". Quem trata o primeiro como o segundo deixa o
 * vigia alarmar em cima de um ciclo sobre o qual ele não mediu nada.
 */
export function saudeSyncDe(texto: string | null | undefined): {
  fontesOk: number | null;
  fontesFalha: number | null;
} {
  const lido = lerDetalhe(texto);
  return {
    fontesOk: numeroDe(lido, "fontes_ok"),
    fontesFalha: numeroDe(lido, "fontes_falha"),
  };
}

/** Atalho para o trio que o vigia 2 consome. */
export function amostraDe(texto: string | null | undefined): {
  fonte: string | null;
  espera: number | null;
  lidas: number | null;
  recebidas: number | null;
} {
  const lido = lerDetalhe(texto);
  return {
    fonte: fonteDe(lido),
    espera: numeroDe(lido, "espera"),
    lidas: numeroDe(lido, "lidas"),
    recebidas: numeroDe(lido, "recebidas"),
  };
}

// ---------------------------------------------------------------------------
// QUARENTENA — a agregação que decide 4 contra 95
// ---------------------------------------------------------------------------
//
// Esta função existe fora da rota por um motivo prático: ela é o ponto onde o
// erro de identidade acontece, e dentro da rota nenhum teste a alcança.
//
// TRÊS CAMPOS PARECEM IDENTIDADE E SÓ UM É (medido no xtv, 16/08/2026, janela
// de 24h com 95 eventos de `carta_nova_quarentenada`):
//
//   numero_externo ... 4 distintos   <- a carta NO MUNDO. É este.
//   carta_id ......... 95 distintos  <- a identidade da LINHA. O sync grava uma
//                                       nova a cada ciclo, então contar isto
//                                       devolve o número de eventos com cara de
//                                       número de cartas.
//   o número no texto  4 distintos   <- coincidência. "PLAYCONTEMPLADAS credito
//                                       18531 nasceu indisponivel" traz o VALOR
//                                       DO CRÉDITO (o gatilho monta a frase com
//                                       `r.vc`). Hoje bate por acaso, porque as
//                                       quatro cartas têm créditos diferentes;
//                                       duas cartas de crédito igual virariam
//                                       uma só.
//
// O relatório "95 cartas barradas em 24h contra 1 aprovada" nasceu de contar o
// campo errado. São QUATRO cartas (21, 78, 345 e 1182) reinserindo uma vez por
// ciclo. Não é a porta quebrada: é a porta funcionando 24 vezes.
export type EventoQuarentena = {
  numero_externo: number | null;
  detalhe: string | null;
};

export function quarentenaPorCarta(
  eventos: EventoQuarentena[]
): Map<number, { fonte: string; ciclos: number }> {
  const porCarta = new Map<number, { fonte: string; ciclos: number }>();
  for (const ev of eventos) {
    const n = ev.numero_externo;
    // `Number.isFinite` recusa null, undefined, NaN e Infinity de uma vez. Uma
    // linha sem numero_externo não vira carta anônima nem carta zero: ela é
    // descartada, e a diferença entre `eventos.length` e a soma dos ciclos é o
    // que denuncia que havia linha sem identidade.
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    const balde = porCarta.get(n) ?? {
      // Rotulagem, nunca julgamento. Se o formato do detalhe mudar, o título do
      // alerta sai com a fonte errada e os NÚMEROS continuam certos.
      fonte: fonteDe(lerDetalhe(ev.detalhe)) ?? "desconhecida",
      ciclos: 0,
    };
    balde.ciclos++;
    porCarta.set(n, balde);
  }
  return porCarta;
}
