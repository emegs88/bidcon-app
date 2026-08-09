// ============================================================================
// lib/farol/responde.ts — a série "Responde, Porta-voz"
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-SABER-01", Entrega 3.
// ----------------------------------------------------------------------------
// O QUE ESTA SÉRIE É. Todo reel que a casa publica hoje nasce de uma CARTA: o
// crédito, a entrada, a parcela. Esta série nasce de uma PERGUNTA — uma dúvida
// que gente de verdade mandou no WhatsApp e que o FAQ VIVO já viu repetir. É a
// diferença entre falar do que temos para vender e falar do que perguntam. O
// segundo tende a reter mais porque quem assiste se reconhece na pergunta.
//
// ---------------------------------------------------------------------------
// A PRIVACIDADE AQUI É REGRA DURA DE CÓDIGO, NÃO DE PROMPT — foi ordem
// explícita da OS, e é a decisão de desenho mais importante deste arquivo.
//
// Um prompt dizendo "não exponha o cliente" é uma sugestão a um modelo
// estatístico que, no dia em que a pergunta vier com um nome no meio, pode
// achar que o nome deixa o roteiro mais humano. `podePublicar()` abaixo roda
// ANTES do modelo ver qualquer coisa, é determinística, e recusa sem apelação.
// São quatro travas, e cada uma responde a um risco diferente:
//
//   1) OCORRÊNCIAS >= 3. A mais forte das quatro, e a menos óbvia. Uma pergunta
//      feita por UMA pessoa é a pergunta DAQUELA pessoa: se ela virar reel, o
//      cliente que a mandou ontem se reconhece no vídeo de hoje — e com razão,
//      porque É dele. A partir de três pessoas distintas a pergunta deixou de
//      pertencer a alguém e virou dúvida do público. Note que o limiar aqui é
//      MAIOR que o `MIN_OCORRENCIAS = 2` que grava no acervo: gravar para o
//      cérebro do WhatsApp ler e PUBLICAR para o Instagram inteiro ver são
//      dois atos com riscos diferentes, e por isso dois números diferentes.
//
//   2) NENHUM MARCADOR DE REDAÇÃO. Se o texto contém "[telefone]", "[email]",
//      "[numero]" e afins, significa que a pergunta original TINHA dado
//      pessoal grudado nela. A anonimização fez o trabalho — mas uma pergunta
//      que precisou ser redigida não é uma pergunta que a casa põe no
//      Instagram. Há fila sobrando; recusar é barato.
//
//   3) `anonimizar()` DE NOVO, e recusa se mudar alguma coisa. Redundante por
//      construção (o FAQ VIVO já anonimizou na escrita) e é justamente por
//      isso que vale: pega o caso em que a função melhorou depois que a linha
//      foi gravada. A trava roda contra a versão de HOJE, não contra a de
//      quando o dado entrou.
//
//   4) TAMANHO. Texto curto demais não é pergunta ("e aí"); longo demais é
//      desabafo, e desabafo carrega contexto pessoal que nenhuma regex pega.
//
// E o que NÃO fazemos: a pergunta do cliente nunca é gravada no `detalhe` do
// reel. Vai o `saber_id` e a origem, como a OS pediu. Quem quiser auditar
// segue o id até o acervo; o histórico do Instagram não vira cópia do inbox.
//
// ---------------------------------------------------------------------------
// O ROTEIRO É PERGUNTA → RESPOSTA → CTA, e o modelo NÃO decide a estrutura.
// Ele recebe as três partes nomeadas no JSON e o route as costura. Deixar o
// modelo "escrever um roteiro no formato pergunta e resposta" produziria, em
// algum dia, um roteiro com duas perguntas ou nenhum CTA — e ninguém notaria
// até o vídeo estar no ar. Campos separados são verificáveis um a um.
//
// ---------------------------------------------------------------------------
// A RESPOSTA SAI DO ACERVO, NÃO DA MEMÓRIA DO MODELO. O bloco de saber entra
// na mensagem e o system manda, com todas as letras, não completar de cabeça.
// É a diferença entre um vídeo que diz o que a Bidcon faz e um vídeo que diz o
// que um modelo de linguagem acha que uma empresa de consórcio faria. O
// segundo é exatamente o material que gera reclamação em órgão regulador.
//
// A cerca final continua sendo `revisarLegenda()`, no route, sobre o texto
// montado — a MESMA do FAROL-POST e do FAROL-REEL. Não há aqui um segundo
// linter "da série": um texto que reprovaria lá tem que reprovar aqui.
// ============================================================================
import { anonimizar } from "@/lib/farol/saber";
import {
  chamar,
  textoDe,
  recortarJson,
  MODELO,
  TIMEOUT_REDACAO_MS,
  type R,
} from "@/lib/farol/pauta";

/**
 * Limiar de PUBLICAÇÃO. Deliberadamente acima do limiar de gravação
 * (`MIN_OCORRENCIAS = 2`, no route do saber). Ver trava 1 no header.
 */
export const MIN_OCORRENCIAS_PUBLICO = 3;

/** Marcadores que `anonimizar()` deixa no lugar do dado pessoal. */
const MARCADORES = /\[(telefone|email|numero|cpf|cnpj|perfil|link)\]/;

const MIN_CHARS = 15;
const MAX_CHARS = 200;

export type PerguntaFaq = {
  id: string;
  titulo: string;
  conteudo: string;
  ocorrencias: number;
};

export type TextoResposta = {
  /** A pergunta como ela vai ser FALADA — reescrita pelo modelo, genérica. */
  pergunta: string;
  resposta: string;
  cta: string;
  legenda: string;
  hashtags: string[];
};

/**
 * As quatro travas do header, em ordem do mais barato para o mais caro.
 * Devolve o MOTIVO da recusa (string) ou `null` quando pode publicar — o
 * mesmo contrato de `revisarLegenda()`, para que os dois se leiam igual.
 */
export function podePublicar(p: PerguntaFaq): string | null {
  const texto = (p.conteudo ?? "").trim();

  if ((p.ocorrencias ?? 0) < MIN_OCORRENCIAS_PUBLICO) {
    return `poucas_ocorrencias(${p.ocorrencias ?? 0}<${MIN_OCORRENCIAS_PUBLICO})`;
  }
  if (texto.length < MIN_CHARS) return `curta_demais(${texto.length})`;
  if (texto.length > MAX_CHARS) return `longa_demais(${texto.length})`;
  if (MARCADORES.test(texto)) return "contem_marcador_de_redacao";
  if (anonimizar(texto) !== texto) return "anonimizacao_ainda_mudaria_o_texto";

  return null;
}

function systemResponde(): string {
  return [
    "Você escreve o roteiro de um Reel curto da Bidcon, marketplace independente",
    "de cartas de crédito de consórcio contempladas. Formato da série:",
    "'Responde, Porta-voz' — uma pergunta real de cliente, respondida direto.",
    "",
    "ESTRUTURA (três campos, e cada um é um campo mesmo):",
    "- pergunta: a dúvida reescrita em UMA frase curta, na 3ª pessoa e genérica",
    "  ('Dá pra somar duas cartas?'). Nunca cite pessoa, cidade, valor de",
    "  ninguém, nem escreva como se estivesse lendo a mensagem de alguém.",
    "- resposta: 2 a 4 frases. SÓ com o que estiver na base de conhecimento",
    "  abaixo. Se a base não responder, escreva que o time confirma no",
    "  atendimento — nunca complete de cabeça.",
    "- cta: uma frase convidando a comentar ou chamar no WhatsApp.",
    "",
    "REGRAS DE FALA (o texto vira áudio, então é falado, não lido):",
    "- Frases curtas. Nada de asterisco, emoji, markdown ou parênteses.",
    "- O total de pergunta + resposta + cta cabe em ~35 segundos de fala",
    "  (aproximadamente 90 palavras). Passou disso, corte a resposta.",
    "- Números por extenso quando forem falados.",
    "",
    "LÉXICO OBRIGATÓRIO DA CASA:",
    "- Consórcio é compra programada, não é investimento. NUNCA use as palavras",
    "  investimento, investidor, rendimento, rentabilidade, lucro, CDI, retorno,",
    "  aplicação, nem compare com poupança ou renda fixa.",
    "- NUNCA prometa, sugira ou estime quando uma contemplação acontece, e não",
    "  diga 'garantido'. Não diga desconto, aprovação de crédito ou limite.",
    "- Use: planejamento, compra programada, carta de crédito, poder de compra,",
    "  patrimônio.",
    "",
    "LEGENDA: 2 a 4 linhas para o Instagram, mesmo léxico, terminando em convite.",
    "HASHTAGS: 3 a 5, começando com '#', sem nenhuma do léxico proibido.",
    "",
    "Responda SÓ um objeto JSON com as chaves:",
    'pergunta, resposta, cta, legenda, hashtags (array de strings).',
  ].join("\n");
}

/**
 * Uma chamada, sem `tools` — o mesmo motivo de `escreverPauta`: ferramenta no
 * corpo faz o turno fechar em `tool_use` e voltar sem texto.
 */
export async function escreverResposta(args: {
  pergunta: PerguntaFaq;
  saber: string;
}): Promise<R<TextoResposta>> {
  const { pergunta, saber } = args;

  const conteudo = [
    "BASE DE CONHECIMENTO DA CASA (a resposta sai daqui, e só daqui):",
    saber || "(vazia — então diga que o time confirma no atendimento)",
    "",
    "A dúvida que chegou (reescreva, não copie):",
    // Terceira passada de `anonimizar` — a segunda foi na trava. Custa
    // microssegundos e é o último ponto antes de o texto sair da máquina.
    anonimizar(pergunta.conteudo),
    "",
    "Escreva o roteiro da série. Responda só o JSON.",
  ].join("\n");

  const r = await chamar(
    {
      model: MODELO,
      max_tokens: 1200,
      system: systemResponde(),
      messages: [{ role: "user", content: conteudo }],
    },
    TIMEOUT_REDACAO_MS
  );
  if (!r.ok) return r;

  const bruto = textoDe(r.data.content);
  if (!bruto) return { ok: false, erro: "resposta_sem_texto" };

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(recortarJson(bruto));
  } catch {
    return { ok: false, erro: "json_invalido" };
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const out: TextoResposta = {
    pergunta: str(obj.pergunta),
    resposta: str(obj.resposta),
    cta: str(obj.cta),
    legenda: str(obj.legenda),
    hashtags: Array.isArray(obj.hashtags)
      ? obj.hashtags.filter((h): h is string => typeof h === "string" && h.startsWith("#"))
      : [],
  };

  // Campo vazio não é "roteiro fraco", é roteiro quebrado — mesma régua de
  // `escreverPauta`. Sem CTA a série perde a única coisa que ela pede de
  // volta; sem pergunta não é a série.
  if (!out.pergunta || !out.resposta || !out.cta || !out.legenda) {
    return { ok: false, erro: "campos_vazios" };
  }

  return { ok: true, ...out };
}

/**
 * Costura o roteiro FALADO. É código, não prompt: a ordem das três partes é a
 * série, e ela não pode depender de o modelo ter obedecido. Ver header.
 */
export function montarRoteiroResposta(t: TextoResposta): string {
  return [t.pergunta, t.resposta, t.cta].join(" ");
}

/** Legenda publicada: texto + hashtags, mesmo formato do reel-render. */
export function montarLegendaResposta(t: TextoResposta): string {
  return t.hashtags.length > 0 ? `${t.legenda}\n\n${t.hashtags.join(" ")}` : t.legenda;
}
