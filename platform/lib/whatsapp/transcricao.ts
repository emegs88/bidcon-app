// ============================================================================
// lib/whatsapp/transcricao.ts — OUVIDO-01 v2, itens (b) e (c).
// ----------------------------------------------------------------------------
// Transcreve o áudio do cliente na OpenAI (Whisper) e devolve texto que o
// cérebro consegue ler. SERVIDOR-ONLY: lê OPENAI_API_KEY.
//
// NENHUM SEGREDO NOVO. É a MESMA env que `lib/ia.ts` já usa para os embeddings
// e que `lib/farol/gerar-arte.ts` usa para a arte. A ordem pediu isso ao pé da
// letra, e é o que está feito aqui.
//
// ----------------------------------------------------------------------------
// ESTA FUNÇÃO NÃO LANÇA. NUNCA.
//
// Ela é o caminho; o fallback é a rede. Se ela lançasse, quem chama teria de
// lembrar de um try/catch para o cliente não ficar sem resposta — e o dia em
// que alguém esquecesse, o turno voltaria a sumir. Devolve união discriminada:
// ou `{ok:true, texto}`, ou `{ok:false, motivo}`. Não há terceiro estado.
//
// O `motivo` é enumerado de propósito (Regra 19): "não transcrevi porque é
// longo demais", "porque o Whisper não respondeu" e "porque veio silêncio" são
// fatos DIFERENTES. Achatar os três em `null` apagaria justamente a informação
// que o vigia e a conta de custo precisam.
//
// ----------------------------------------------------------------------------
// O TETO DE ~2 MINUTOS É POR BYTES, E ISSO É UM PROXY — declarado, não escondido
//
// A ordem pede teto de duração (~2min). Medido no payload da Meta: o objeto de
// áudio traz `{ id, mime_type, sha256, voice }` e MAIS NADA. Não há campo de
// duração. Para saber a duração de verdade seria preciso decodificar o Opus,
// que é exatamente o trabalho que se está tentando não fazer aqui.
//
// Então o teto é de bytes, derivado assim: nota de voz do WhatsApp é Opus entre
// ~16 e ~32 kbps. No PIOR caso (32 kbps = 4.000 bytes/s), 120s dão 480.000
// bytes. TETO_BYTES = 512 KiB fica logo acima disso: um arquivo maior que isso
// é quase certamente mais longo que 2 minutos, em qualquer bitrate que o
// WhatsApp use. O erro do proxy cai para o lado seguro — corta o que é grande
// demais, e não corta nota curta gravada com qualidade alta.
//
// A GUARDA QUE MANDA DE VERDADE É O RELÓGIO (TIMEOUT_MS). O teto de bytes só
// evita gastar download e crédito com um arquivo que já se sabe grande; quem
// garante que a fatia não estoura o orçamento de tempo é o AbortController.
//
// ----------------------------------------------------------------------------
// ITEM (f) — O CUSTO, E POR QUE O VOLUME É UM PROXY DECLARADO
//
// Preço: ~US$0,006 por minuto de áudio (whisper-1). Está amarrado à constante
// MODELO logo abaixo, não solto num documento — trocar de modelo troca o custo.
//
// O VOLUME NÃO PÔDE SER MEDIDO DIRETO, e isso importa mais que o número.
// Medido no xtv em 28/08/2026, 431 mensagens de cliente entre 16/07 e 28/08:
//
//   com tipo preenchido ......... 0    (a coluna nasceu na 0091, hoje, sem
//                                       backfill — Regra 19, não se inventa
//                                       passado)
//   com mime_type preenchido .... 28   image/jpeg 20 · application/pdf 8
//   com mime de áudio ........... 0
//   conteúdo vazio .............. 6
//
// Contar `tipo='audio'` devolveria ZERO, e esse zero seria CEGUEIRA, não
// medição: nenhuma linha histórica tem tipo. Contar por `mime_type` também
// devolve zero para áudio — mas por outro motivo, e é o motivo interessante: o
// webhook antigo só persistia mime para os anexos que sabia tratar (imagem e
// documento). O áudio caía fora e não deixava rastro NENHUM, exceto um.
//
// Esse um é a estimativa: as 6 mensagens de CONTEÚDO VAZIO em 44 dias são a
// pegada do que o webhook não soube ouvir. Bate com o "5 em 30 dias" que a
// ordem já trazia. No pior caso — 6 áudios, todos no teto de 2 min:
//
//   6 × 2 min × US$0,006 = US$0,072 em 44 dias.
//
// Dez vezes esse volume ainda dá menos de um dólar por mês. É por isso que o
// teto que interessa aqui é o de TEMPO (a resposta do cliente), não o de
// dinheiro. Se um dia o volume mudar de ordem de grandeza, quem descobre é o
// VIGIA 10 — não esta linha de comentário, que envelheceria calada.
// ============================================================================

const OPENAI_URL = "https://api.openai.com/v1";

/** `whisper-1` é o modelo cujo preço a ordem declara no item (f):
 *  ~US$0,006 por minuto de áudio. Trocar de modelo muda o custo — se um dia
 *  trocar, o número da spec tem de trocar junto, ou a spec vira mentira. */
const MODELO = "whisper-1";

/** Item (c), ao pé da letra: ~8s. É esta a guarda que manda.
 *  Orçamento da fatia: 8s aqui + 8s de debounce + ~20s de geração ≈ 40s,
 *  contra LOCK_TTL_MS de 120s em processar-background.ts. Cabe com folga. */
export const TIMEOUT_MS = 8_000;

/** ~2 min de Opus no pior bitrate. Ver a aritmética no cabeçalho. */
export const TETO_BYTES = 512 * 1024;

/** Por que não transcreveu. Cada valor é um fato distinto — Regra 19. */
export type MotivoFalha =
  | "sem_chave" // OPENAI_API_KEY ausente no ambiente
  | "longo_demais" // passou de TETO_BYTES (proxy de duração)
  | "vazio" // baixamos 0 byte: não há o que mandar
  | "whisper_fora" // rede, timeout, 4xx/5xx — o Whisper não respondeu
  | "silencio"; // o Whisper respondeu, mas sem texto legível

export type Transcricao =
  | { ok: true; texto: string }
  | { ok: false; motivo: MotivoFalha };

/** O `fetch` é injetável só para o teste poder derrubar o Whisper sem rede.
 *  Em produção nunca é passado. */
export type Buscador = typeof fetch;

/** Whisper quer nome de arquivo com extensão que ele reconheça. A nota de voz
 *  do WhatsApp é `audio/ogg; codecs=opus` — o `; codecs=...` precisa cair fora
 *  antes da comparação, senão nenhuma chave bate e todo áudio vira `.ogg` por
 *  acidente em vez de por decisão. */
const EXT_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "m4a",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "audio/webm": "webm",
};

export function extDoAudio(mime: string | null | undefined): string {
  if (typeof mime !== "string") return "ogg";
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXT_POR_MIME[base] ?? "ogg";
}

/**
 * Manda os bytes ao Whisper e devolve a fala do cliente em texto.
 *
 * Recebe BYTES, não `media_id`, de propósito: quem baixa é `baixarMidia`, que
 * já existe e já sabe o passo duplo da Graph. Assim esta função é testável sem
 * rede e sem Meta, e o teste do item (e) pode derrubar o Whisper de verdade.
 */
export async function transcreverAudio(
  bytes: ArrayBuffer | Uint8Array,
  mime: string | null | undefined,
  opcoes: { timeoutMs?: number; buscar?: Buscador } = {}
): Promise<Transcricao> {
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_MS;
  const buscar = opcoes.buscar ?? fetch;

  const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  // As duas recusas baratas vêm ANTES da chave e antes da rede: não se gasta
  // crédito nem relógio com arquivo que já se sabe que não serve.
  if (dados.byteLength === 0) return { ok: false, motivo: "vazio" };
  if (dados.byteLength > TETO_BYTES) return { ok: false, motivo: "longo_demais" };

  // A chave é lida aqui dentro (não no import) — importar este módulo não pode
  // explodir build/SSG. Falta de env é `sem_chave`, não exceção: ambiente mal
  // configurado tem de virar fallback honesto, não turno perdido.
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) return { ok: false, motivo: "sem_chave" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append("model", MODELO);
    // `pt` poupa o Whisper de adivinhar idioma. Todo cliente da casa fala
    // português; deixar em branco troca acerto por latitude que não usamos.
    form.append("language", "pt");
    form.append("response_format", "json");
    // `new Uint8Array(dados)` COPIA, e a cópia é deliberada — não é enfeite de
    // tipo. `dados` pode estar apoiado num ArrayBufferLike (que inclui
    // SharedArrayBuffer), e `Blob` só aceita view apoiada em ArrayBuffer. Este
    // construtor recebe `dados` como ArrayLike e devolve uma view sobre buffer
    // NOSSO — o compilador passa a saber o que já era verdade em produção.
    //
    // A cópia vem DEPOIS das duas recusas baratas lá em cima, e isso importa:
    // aqui ela custa no máximo TETO_BYTES (512 KiB). Copiar na linha 111, antes
    // das guardas, faria um áudio de 50 MB ser duplicado na memória só para ser
    // recusado no passo seguinte.
    const paraEnviar = new Uint8Array(dados);
    form.append(
      "file",
      new Blob([paraEnviar], { type: (mime ?? "audio/ogg").split(";")[0].trim() }),
      `audio.${extDoAudio(mime)}`
    );

    const resp = await buscar(`${OPENAI_URL}/audio/transcriptions`, {
      method: "POST",
      // Sem "Content-Type": o FormData precisa pôr o próprio boundary.
      // Escrevê-lo à mão aqui quebraria o multipart de um jeito silencioso.
      headers: { Authorization: `Bearer ${chave}` },
      body: form,
      signal: ctrl.signal,
    });

    // Mesmo contrato de `postOpenAI` em lib/ia.ts: o corpo do erro pode conter
    // detalhe da conta e NÃO é propagado. Só o status chega ao log de quem chama.
    if (!resp.ok) return { ok: false, motivo: "whisper_fora" };

    const json = (await resp.json()) as { text?: unknown };
    const texto = typeof json.text === "string" ? json.text.trim() : "";

    // Silêncio, ruído e áudio inaudível voltam como string vazia. Devolver
    // `ok:true` com texto vazio aqui seria reabrir o defeito da fatia do lado
    // de dentro: um turno vazio entrando no cérebro, agora com a nossa bênção.
    if (texto === "") return { ok: false, motivo: "silencio" };

    return { ok: true, texto };
  } catch {
    // Timeout (abort), DNS, TLS, socket — tudo é "o Whisper não respondeu".
    // O catch é mudo de propósito: o erro pode carregar URL com credencial.
    return { ok: false, motivo: "whisper_fora" };
  } finally {
    clearTimeout(t);
  }
}
