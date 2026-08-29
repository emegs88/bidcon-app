// ============================================================================
// lib/whatsapp/tipos.ts — OUVIDO-01 v2, o espelho do CHECK da migration 0091.
// ----------------------------------------------------------------------------
// A migration 0091 diz, no comentário da coluna, que este arquivo espelha a
// lista dela. Este é o arquivo. Se as duas listas divergirem, o INSERT do
// webhook começa a falhar — e o teste `TIPOS espelha o CHECK da 0091` existe
// para que a divergência apareça no portão, e não no cliente.
//
// ----------------------------------------------------------------------------
// POR QUE O ESCRITOR NORMALIZA (e não o banco)
//
// O CHECK da 0091 não pode poder recusar a Meta: um INSERT recusado aqui é a
// mensagem do cliente sumindo INTEIRA, que é estritamente pior que o defeito
// que estamos consertando. Por isso a normalização é DAQUI: qualquer `m.type`
// que não esteja na lista da Meta vira 'desconhecido', que ESTÁ na lista do
// CHECK. Assim o CHECK só pode pegar erro de digitação NOSSO — que é
// exatamente o que se quer que ele pegue.
//
// ----------------------------------------------------------------------------
// A REDE É POR CONTEÚDO, NÃO POR TIPO — e a diferença é o ponto da fatia
//
// A ordem diz "nunca mais turno vazio entra no cérebro". A tentação é listar
// os tipos ruins (sticker, vídeo, location) e barrar por tipo. O modo de
// falhar disso é conhecido: a Meta inventa um tipo novo, ele não está na
// lista de barrados, e o turno vazio volta a entrar — em silêncio.
//
// `cerebroConsegueLer()` pergunta pelo CONTEÚDO. Um tipo que nunca vimos, sem
// texto, é barrado pelo mesmo galho que barra o sticker, sem ninguém ter
// previsto que ele existiria. A rede não tem furo de vocabulário.
//
// ----------------------------------------------------------------------------
// OS PLACEHOLDERS SÃO POUCOS DE PROPÓSITO — o vigia precisa poder gritar
//
// Seria fácil escrever `"[" + tipo + " recebido]"` para todo tipo e nunca mais
// ter uma linha com conteúdo vazio. Isso mataria o vigia do conteúdo-vazio no
// mesmo commit que o cria: um contador cujo valor é zero POR CONSTRUÇÃO não
// vigia nada, e o vigia mais perigoso é o que parou de olhar sem avisar.
//
// Só recebem placeholder os tipos que esta fatia decidiu tratar. Um tipo que
// a Meta mandar e nós nunca mapeamos continua gravando conteúdo vazio — o
// cliente ainda é atendido (a rede acima é por conteúdo, então o fallback
// sai), mas a linha vazia FICA no banco como marca do nosso ponto cego, e o
// vigia a encontra. É essa a assinatura de "algo furou a rede".
// ============================================================================

/** Vocabulário da Meta, literal (WhatsApp Cloud API). Espelha a 0091. */
export const TIPOS_META = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "button",
  "reaction",
  "order",
  "system",
  // 'unknown' e 'unsupported' são da PRÓPRIA Meta e ficam preservados como
  // eles mesmos: "a Meta disse que não suporta" e "a Meta disse algo que nunca
  // vimos" são fatos diferentes e não podem virar o mesmo registro.
  "unknown",
  "unsupported",
] as const;

/** Nosso, e só nosso: a Meta mandou algo fora da lista acima.
 *  Está em português no meio de valores em inglês de propósito — a troca de
 *  idioma marca no olho que aquele valor é NOSSO, não veio da Meta. */
export const TIPO_DESCONHECIDO = "desconhecido" as const;

export const TIPOS_MENSAGEM = [...TIPOS_META, TIPO_DESCONHECIDO] as const;

export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];

const CONJUNTO_META: ReadonlySet<string> = new Set(TIPOS_META);

/**
 * Mapeia o `m.type` cru da Meta para um valor que o CHECK da 0091 aceita.
 *
 * Ausente/vazio devolve `null` — e `null` NÃO é 'desconhecido'. "A Meta não
 * declarou tipo" e "a Meta declarou um tipo que não conhecemos" são fatos
 * diferentes; achatar os dois em 'desconhecido' apagaria a diferença de forma
 * irreversível. `null` grava NULL, que a 0091 aceita de graça e que significa
 * "não sabemos" — Regra 19.
 */
export function normalizarTipo(bruto: string | null | undefined): TipoMensagem | null {
  if (typeof bruto !== "string") return null;
  const limpo = bruto.trim().toLowerCase();
  if (limpo === "") return null;
  return CONJUNTO_META.has(limpo) ? (limpo as TipoMensagem) : TIPO_DESCONHECIDO;
}

// ----------------------------------------------------------------------------
// Placeholders — o que o webhook grava em `conteudo` quando a mensagem não traz
// texto nem legenda. `conteudo` é NOT NULL, então algo tem que entrar; a
// escolha é entre string vazia (que não diz nada a quem abre a conversa) e uma
// marca que diz a verdade sobre o que chegou.
// ----------------------------------------------------------------------------

/** Marca do áudio ANTES da transcrição. O background sobrescreve com
 *  `[áudio transcrito] …` quando o Whisper responde. Se a linha ficar com
 *  ESTE valor, a transcrição não aconteceu — e isso é legível numa consulta. */
export const MARCA_AUDIO_RECEBIDO = "[áudio recebido]";

/** Prefixo do conteúdo transcrito. Vai para o cérebro e para a tela, e é o
 *  aviso que o item (d) do prompt referencia: o agente precisa saber que
 *  aquilo passou por uma máquina que erra. */
export const PREFIXO_TRANSCRICAO = "[áudio transcrito]";

const PLACEHOLDER_POR_TIPO: Partial<Record<TipoMensagem, string>> = {
  audio: MARCA_AUDIO_RECEBIDO,
  video: "[vídeo recebido]",
  sticker: "[figurinha recebida]",
  location: "[localização recebida]",
};

/** Placeholder do tipo, ou `null` quando esta fatia não decidiu tratá-lo.
 *  `null` faz o webhook manter o comportamento antigo (conteúdo vazio), que é
 *  o que mantém o vigia capaz de gritar. */
export function placeholderDoTipo(tipo: TipoMensagem | null): string | null {
  if (!tipo) return null;
  return PLACEHOLDER_POR_TIPO[tipo] ?? null;
}

/** Todo texto que este módulo pode ter escrito no lugar da fala do cliente.
 *  É a lista que `cerebroConsegueLer` usa para não confundir marca nossa com
 *  mensagem de gente. */
const MARCAS: ReadonlySet<string> = new Set(Object.values(PLACEHOLDER_POR_TIPO));

/**
 * O cérebro consegue ler isto?
 *
 * A pergunta é sobre CONTEÚDO, não sobre tipo — ver o cabeçalho. Devolve
 * `false` para vazio, para espaço em branco e para qualquer marca que nós
 * mesmos escrevemos. Devolve `true` para transcrição, porque transcrição É a
 * fala do cliente, só que passada por uma máquina.
 */
export function cerebroConsegueLer(conteudo: string | null | undefined): boolean {
  if (typeof conteudo !== "string") return false;
  const limpo = conteudo.trim();
  if (limpo === "") return false;
  return !MARCAS.has(limpo);
}

// ----------------------------------------------------------------------------
// O FALLBACK HONESTO — a rede, nunca o caminho.
// ----------------------------------------------------------------------------
// A ordem dá o texto ao pé da letra para o áudio. Para os outros tipos o mesmo
// texto diria "Recebi teu áudio!" para quem mandou uma figurinha — o bot
// mentindo sobre o que recebeu, na primeira frase. DESVIO DECLARADO: mantenho
// a frase da ordem EXATA no caminho do áudio (que é o caso que a ordem estava
// olhando) e troco só o substantivo nos demais. A forma, o pedido e o emoji
// são os mesmos.
//
// Texto FIXO, não gerado por modelo — mesmo contrato de `resumoExtratoWa`.
// Por isso não passa por `avaliarComplianceGradual`: não há o que sanitizar em
// frase que nós escrevemos e revisamos aqui.

const SUBSTANTIVO_POR_TIPO: Partial<Record<TipoMensagem, string>> = {
  audio: "teu áudio",
  video: "teu vídeo",
  sticker: "tua figurinha",
  location: "tua localização",
  contacts: "teu contato",
};

/** A frase que o cliente recebe quando a leitura não deu. Nunca é o caminho
 *  planejado: é o que sai quando o caminho falhou, estourou ou nem existia. */
export function textoFallback(tipo: TipoMensagem | null): string {
  const oQue = (tipo && SUBSTANTIVO_POR_TIPO[tipo]) ?? "tua mensagem";
  return `Recebi ${oQue}! Consegues me escrever em texto? Assim te respondo certinho 😊`;
}
