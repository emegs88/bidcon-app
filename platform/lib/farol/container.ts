// ============================================================================
// container.ts — regras puras do container de mídia da Meta (FASE2-B/C)
// AUTORIZADO: Emerson Gomes dos Santos — 09/08/2026, depois de RETIRAR a OS
// FASE2-CALLBACK ("o mecanismo não existe e você provou que não resolveria"):
//   B · copyright_check_status — AGORA. Pedir o campo no fields
//       (id,status,status_code,copyright_check_status) e LOGAR os quatro
//       literais a cada consulta, no container_status_bruto que já existe.
//   C · orçamento honesto — AGORA. 1 consulta por minuto, no máximo 5 minutos
//       por container (é o que a doc pede), e a linha declara DERROTA em ~15min
//       (3x a margem da doc) em vez de 24h. Ao declarar: status 'falhou',
//       motivo literal no detalhe (incluindo o copyright_check_status).
// ----------------------------------------------------------------------------
// POR QUE ISTO É UM ARQUIVO SEPARADO E NÃO MAIS UM PEDAÇO DA ROTA. A regra que
// decide DESISTIR de um reel é a regra mais cara desta fatia: se ela disparar
// cedo demais, joga fora vídeo que ia publicar; tarde demais, é o que temos
// hoje — 24h segurando uma linha morta. Dentro da rota ela só seria exercitada
// por um cron em produção, isto é: testada pelo público. Aqui ela é função
// pura, roda contra fixture, e o limiar não pode ser afrouxado sem alguém
// mexer num teste que diz em voz alta o que está afrouxando.
//
// O QUE ESTE ARQUIVO **NÃO** FAZ: não fala com a Meta, não lê banco, não tem
// relógio próprio (o `agora` sempre entra por parâmetro). Tudo que é I/O
// continua na rota — aqui só moram decisão e vocabulário.
//
// A MEDIÇÃO QUE ORIGINOU O ARQUIVO (09/08/2026), para ninguém reabrir a
// discussão sem dado novo:
//   · 07/08 → container 17878196991684841 PUBLICOU, 6h40 depois de criado;
//   · 08/08 → container 17878355355684841 EXPIROU, 24h em IN_PROGRESS;
//   · 09/08 → container 17878490436684841 preso em IN_PROGRESS desde 12h50.
// Não é rejeição sistemática — é fila/instabilidade do lado deles. O mp4 foi
// periciado e está impecável: 1080x1920 (9:16), 23,853s, H.264+AAC, faststart
// aplicado (ftyp→moov), 2.749.052 bytes, HTTP 200 com accept-ranges. Ou seja:
// não há hipótese nossa sobrando para testar por tentativa — só resta PERGUNTAR
// melhor (B) e PARAR DE PERGUNTAR MIL VEZES A MESMA COISA (C).
// ============================================================================

/**
 * Campos pedidos ao container, no degrau mais alto da escada.
 *
 * `status` é o verboso — é ali que a Meta escreve a RECLAMAÇÃO por extenso.
 * `status_code` é a palavra seca. `copyright_check_status` é o campo NOVO, e é
 * a razão desta fatia: era o único canal de diagnóstico documentado que
 * estava fechado por escolha nossa. A hipótese que ele testa é do Emerson —
 * reel com avatar sintético FALANDO pode estar preso em checagem de direitos
 * de voz/áudio. Se estiver, aparece aqui; se não estiver, o campo volta
 * limpo e a hipótese morre medida, que é o outro resultado útil.
 */
export const CAMPOS_CONTAINER = "id,status,status_code,copyright_check_status";

/**
 * ESCADA DE DEGRADAÇÃO. Um degrau por linha, do mais informativo ao mínimo
 * viável. Quando a Graph recusa o conjunto por campo inexistente (code 100),
 * desce UM degrau — não despenca até o fundo.
 *
 * O DEFEITO QUE ISTO CONSERTA, e que era meu: a rede de segurança anterior
 * caía direto de "id,status,status_code" para "status_code". Se a Meta
 * recusasse o campo novo, perderíamos junto o `status` verboso — a frase da
 * reclamação —, que não tem culpa nenhuma e é justamente o que diagnostica.
 * Perder um campo é o preço de pedir um campo novo; perder DOIS é bug.
 *
 * O último degrau é `status_code` sozinho porque é o conjunto que esta rota já
 * usava e está medido em produção: instrumentar não pode custar a leitura de
 * estado. Ficar cego ao container é pior do que ficar sem a frase da Meta.
 */
export const ESCADA_CAMPOS: readonly string[] = [
  "id,status,status_code,copyright_check_status",
  "id,status,status_code",
  "status_code",
];

/** Degrau imediatamente abaixo, ou `null` quando já se está no chão. */
export function degrauAbaixo(campos: string): string | null {
  const i = ESCADA_CAMPOS.indexOf(campos);
  // Conjunto fora da escada (chamada avulsa, com campos escolhidos na mão):
  // cai direto para o piso conhecido em vez de devolver null. Continuar lendo o
  // container importa mais do que a pureza da escada.
  if (i < 0) return ESCADA_CAMPOS[ESCADA_CAMPOS.length - 1];
  return i + 1 < ESCADA_CAMPOS.length ? ESCADA_CAMPOS[i + 1] : null;
}

/**
 * Cadência: UMA consulta por minuto. É literalmente o que a doc de Content
 * Publishing da Meta pede ("query a container's status once per minute").
 * Era 5s. Cinco segundos não era polling, era insistência.
 */
export const POLL_PASSO_MS = 60_000;

/**
 * Teto de sondagem POR INVOCAÇÃO. Não é o teto por container — esse é a
 * DERROTA_MS lá embaixo.
 *
 * A CONTA, porque o número parece arbitrário e não é: a rota tem
 * `maxDuration = 180` e só entra no caminho caro dentro do ORCAMENTO_MS (45s).
 * 45 + 90 + ~15s de publish = 150s, que é exatamente o pior caso já declarado
 * no cabeçalho da rota. Com passo de 60s isso dá 2 leituras por invocação.
 *
 * E aí a conta FECHA com o envelope da Meta, o que é o ponto: o cron é de 10
 * em 10 minutos e a derrota é aos 15, então um container vê invocação em ~0min
 * (2 leituras), ~10min (2 leituras) e ~20min (1 leitura, já em derrota) —
 * CINCO consultas no total. A doc pede "no more than 5 minutes". Antes desta
 * fatia eram 8 leituras por invocação, a cada 10 min, por 24h: mais de MIL
 * GETs num container que a Meta mandou abandonar em cinco minutos.
 */
export const POLL_MAX_MS = 90_000;

/**
 * DERROTA. Idade do container a partir da qual a linha para de esperar e vira
 * `falhou`.
 *
 * 15 min = 3x a margem da doc (5 min). A folga de 3x existe porque a doc fala
 * de imagem e vídeo curto no caso geral, e nosso caso tem um render de ~24s
 * saindo de um avatar sintético — merece uma casa decimal a mais de paciência.
 * Não merece um DIA: era 24h (JANELA_HORAS), e 24h de espera não é paciência,
 * é a linha sequestrando a fila e o painel mentindo "em movimento".
 *
 * A REGRA DE OURO, dita pelo Emerson e escrita aqui porque é o eixo:
 * "se em 15 min não andou, é melhor falhar e reagendar do que segurar um dia."
 * Falhar rápido devolve a vez para o ciclo seguinte; segurar não devolve nada.
 */
export const DERROTA_MS = 15 * 60 * 1000;

/**
 * Códigos TERMINAIS do container, medidos na doc de Content Publishing:
 * EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED. Terminal = a Meta já
 * decidiu, num sentido ou no outro. Só o que NÃO está aqui pode virar derrota:
 * derrota é veredito sobre ESPERA, e não se declara espera vencida contra quem
 * já respondeu.
 */
export const CODES_TERMINAIS: readonly string[] = [
  "FINISHED",
  "PUBLISHED",
  "ERROR",
  "EXPIRED",
];

/**
 * Códigos EM CURSO — a Meta afirmando que o container ainda anda.
 *
 * Mudou de endereço na CONTAINER-LOTERIA-01: nasceu em `diag-container.ts`, e
 * agora mora aqui, ao lado de `CODES_TERMINAIS`, porque passou a ter DOIS
 * leitores (a árvore do diag e a régua de recriação da fase 2). Duas listas
 * com os mesmos nomes não são a mesma lista — foi exatamente esse o defeito
 * que a DIAG-CONTAINER-02 gastou uma manhã consertando. `diag-container.ts`
 * reexporta daqui; nenhum chamador mudou de import.
 *
 * A LISTA NÃO É O COMPLEMENTO DE `CODES_TERMINAIS`, de propósito. Fora das
 * duas listas sobram `null` e `"DESCONHECIDO"` — que não são estados do
 * container, e sim o nome que damos a NÃO TER LIDO. Exigir presença aqui é o
 * que impede "não li" de autorizar uma ação.
 */
export const CODES_EM_CURSO: readonly string[] = ["IN_PROGRESS", "PUBLISHING"];

/** Os quatro literais que interessam, extraídos da resposta crua da Graph. */
export type ResumoContainer = {
  id: string | null;
  status: string | null;
  status_code: string | null;
  copyright_check_status: string | null;
};

/**
 * `status` da Graph nem sempre é string — em alguns retornos vem objeto com a
 * reclamação dentro. Serializar em vez de descartar: o objetivo do item B é
 * NÃO escolher por conta própria o que da resposta merece ser visto.
 */
function literal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v).slice(0, 300);
  } catch {
    return "ilegivel";
  }
}

/**
 * Os quatro literais. Campo ausente vira `null` — e `null` é informação: quer
 * dizer "a Meta não devolveu", que é diferente de "devolveu vazio". Quem
 * imprime decide como mostrar a diferença; aqui ela é preservada.
 */
export function resumoContainer(bruto: unknown): ResumoContainer {
  const o = (bruto ?? {}) as Record<string, unknown>;
  return {
    id: literal(o.id),
    status: literal(o.status),
    status_code: literal(o.status_code),
    copyright_check_status: literal(o.copyright_check_status),
  };
}

/**
 * ÂNCORA DO RELÓGIO do container — a mesma do `checarZumbi`, e agora num lugar
 * só para as duas contas nunca divergirem.
 *
 * `dedupe_confirmado_em` vem primeiro porque é o carimbo de quando ESTE
 * container passou a ser o container desta linha. `atualizado_em` serve de
 * segunda opção (é empurrado por qualquer escrita, mas o caminho de espera não
 * escreve — a linha em 'publicando' que só está sendo sondada não tem
 * `atualizado_em` mexido), e `criado_em` é o piso que sempre existe.
 */
export function ancoraContainer(linha: {
  criado_em: string;
  atualizado_em: string | null;
  detalhe: Record<string, unknown> | null;
}): string {
  const det = (linha.detalhe ?? {}) as { dedupe_confirmado_em?: string };
  return det.dedupe_confirmado_em ?? linha.atualizado_em ?? linha.criado_em;
}

/** Idade em ms a partir da âncora. `NaN` quando a âncora não é data — e NaN nunca vira derrota. */
export function idadeContainerMs(
  linha: {
    criado_em: string;
    atualizado_em: string | null;
    detalhe: Record<string, unknown> | null;
  },
  agora: number
): number {
  return agora - new Date(ancoraContainer(linha)).getTime();
}

/**
 * A DECISÃO. Pura, com o relógio de fora, e conservadora nas três direções em
 * que errar custa um vídeo jogado fora:
 *   · código terminal NUNCA é derrota (a Meta já respondeu);
 *   · idade ilegível NUNCA é derrota (data podre não condena ninguém);
 *   · abaixo do limiar NUNCA é derrota (é o caso comum e sadio).
 */
export function decidirDerrota(p: { idadeMs: number; ultimoCode: string }): {
  derrota: boolean;
  motivo: string;
} {
  if (CODES_TERMINAIS.includes(p.ultimoCode)) {
    return { derrota: false, motivo: "code_terminal" };
  }
  if (!Number.isFinite(p.idadeMs)) {
    return { derrota: false, motivo: "idade_ilegivel" };
  }
  if (p.idadeMs < DERROTA_MS) {
    return { derrota: false, motivo: "dentro_do_prazo" };
  }
  return { derrota: true, motivo: "sem_avanco" };
}

/**
 * O motivo LITERAL que vai para `farol_reels.erro` — e daí para o painel, que
 * já lê essa coluna. Curto de propósito: a coluna é truncada em 500 e a tela
 * mostra a linha inteira. O detalhe longo vai para `detalhe.derrota`.
 *
 * Os quatro literais entram por nome, inclusive quando ausentes: uma frase que
 * diz `copyright_check_status=ausente` é um diagnóstico ("a Meta não devolveu
 * o campo"), enquanto omitir o campo é um silêncio que se lê como "não olhei".
 */
export function motivoDerrota(resumo: ResumoContainer, idadeMin: number): string {
  const partes = [
    `derrota_${idadeMin}min_sem_avanco`,
    `status_code=${resumo.status_code ?? "ausente"}`,
    `copyright_check_status=${resumo.copyright_check_status ?? "ausente"}`,
    resumo.status ? `status=${resumo.status}` : null,
  ].filter(Boolean);
  return partes.join(" ").slice(0, 500);
}

// ===========================================================================
// CONTAINER-LOTERIA-01 — container travado deixa de matar a linha
// AUTORIZADO: Emerson Gomes dos Santos, 11/08/2026:
//   "o A/B + o resgate provaram em produção que container da Meta é binário
//    (termina em segundos ou trava pra sempre) e que container FRESCO cura.
//    Mudança na fase 2: derrota por IN_PROGRESS não mata a linha — RECRIA o
//    container com URL cache-busted (copiar o mp4 para caminho novo,
//    retry/<ts>.mp4, como o diag fez com A — retry com a MESMA URL em janela
//    curta arrisca o dedupe devolver o container travado, que é o 'reset
//    girando em falso' que teu próprio comentário registra). Teto: 3
//    tentativas, depois derrota de verdade."
// ---------------------------------------------------------------------------
// POR QUE A URL PRECISA SER NOVA, E NÃO SÓ O CONTAINER. Medido em 07/08: com a
// mesma URL, resetar o container fazia a Meta devolver o MESMO id, de 10 em 10
// minutos. Recriar apontando para o mesmo endereço não é uma segunda tentativa
// — é a primeira, repetida, com outro nome. O que quebra o dedupe é o endereço
// mudar. Daí `caminhoRetry`.
//
// O TETO EXISTE PARA A RECRIAÇÃO NÃO VIRAR A PRÓPRIA LOTERIA. Sem ele, uma
// linha condenada por conteúdo (não por azar) giraria para sempre, gastando
// download, upload e chamada de container a cada ciclo. Três é o número do
// Emerson; o valor mora aqui, sob teste, e não espalhado no laço.
// ===========================================================================

/** Quantas vezes uma linha pode nascer de novo antes da derrota valer. */
export const TETO_RECRIACOES = 3;

/**
 * Quantas recriações esta linha já gastou, lidas de `detalhe.recriacoes`.
 *
 * Devolve `NaN` quando o campo existe e NÃO é lista. Não é preciosismo: o
 * `detalhe` é JSON livre, e um campo corrompido lido como `0` autorizaria três
 * recriações novas em cima de uma linha que já pode ter gasto as suas. `NaN`
 * atravessa `decidirRecriacao` como recusa — o mesmo desenho de `idadeMs`
 * ilegível em `decidirDerrota`: dado podre nunca autoriza ação.
 */
export function contarRecriacoes(detalhe: Record<string, unknown> | null): number {
  const v = (detalhe ?? {}).recriacoes;
  if (v === undefined || v === null) return 0;
  if (!Array.isArray(v)) return Number.NaN;
  return v.length;
}

/**
 * O caminho do mp4 recriado. Puro, com o relógio de fora.
 *
 * O `videoId` entra no nome (a ordem pedia só `retry/<ts>.mp4`) porque um
 * carimbo de tempo sozinho é inauditável: daqui a um mês, olhando o bucket,
 * ninguém sabe de que linha veio cada arquivo. Declarado como desvio.
 *
 * A HIGIENIZAÇÃO NÃO É DECORAÇÃO. `videoId` vem de fora (HeyGen) e vira
 * caminho de objeto; sem a troca, um id com `../` escreveria fora do prefixo
 * `retry/`. Nada indica que o HeyGen faça isso — a trava não é sobre o que ele
 * faz, é sobre o que ela custa (uma linha) contra o que evita.
 */
export function caminhoRetry(videoId: string, agora: number): string {
  const limpo = String(videoId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "sem_id";
  return `retry/${limpo}-${agora}.mp4`;
}

/**
 * A DECISÃO de recriar. Pura, e conservadora nas três direções em que errar
 * custa dinheiro ou verdade:
 *
 *   · código que NÃO está em curso nunca recria. Aqui mora a lição da
 *     DIAG-CONTAINER-02: `null` e `"DESCONHECIDO"` são o nome de "não li o
 *     container", e recriar por não ter lido seria repetir, gastando bytes, o
 *     mesmo erro que aquela fatia consertou. Recriação exige a Meta AFIRMANDO
 *     que o container ainda anda;
 *   · contador ilegível nunca recria (ver `contarRecriacoes`);
 *   · teto atingido nunca recria — é o ponto em que a derrota vira definitiva.
 *
 * `tentativa` é o número da recriação que está sendo autorizada (1-based), e
 * vem `0` quando não há autorização. Serve para o registro e para o caminho do
 * arquivo, sem que o chamador tenha que somar 1 por conta própria.
 */
export function decidirRecriacao(p: { ultimoCode: string; recriacoes: number }): {
  recriar: boolean;
  motivo: string;
  tentativa: number;
} {
  if (!CODES_EM_CURSO.includes(p.ultimoCode)) {
    return { recriar: false, motivo: `code_nao_em_curso(${p.ultimoCode})`, tentativa: 0 };
  }
  if (!Number.isFinite(p.recriacoes) || p.recriacoes < 0) {
    return { recriar: false, motivo: "contador_ilegivel", tentativa: 0 };
  }
  if (p.recriacoes >= TETO_RECRIACOES) {
    return { recriar: false, motivo: `teto_atingido(${TETO_RECRIACOES})`, tentativa: 0 };
  }
  return { recriar: true, motivo: "container_travado", tentativa: p.recriacoes + 1 };
}
