// ============================================================================
// lib/whatsapp/sala.ts — a aritmética da sala de atendimento
// AUTORIZADO: Emerson Gomes dos Santos — CONVERSAS-02, 09/08/2026:
//   "uma lista de telefones não é uma sala de atendimento — é um log."
//   "ordenação padrão = quem esperou mais tempo por resposta humana no topo,
//    não cronologia pura."
// ----------------------------------------------------------------------------
// POR QUE ISTO É LIB E NÃO ESTÁ NA PÁGINA. Três das regras desta fatia são
// decisões que erram silenciosamente: "quem está esperando", "há quanto tempo"
// e "quem vai no topo". Um erro em qualquer uma delas não quebra a tela — ela
// continua bonita, mostrando a conversa errada em primeiro lugar. Defeito que
// não aparece só é pego por teste, e teste só existe onde a casa procura:
// `scripts/testes.mjs` varre `lib/`. Página não é varrida.
//
// TUDO AQUI É PURO. Nenhuma consulta, nenhum `new Date()` implícito — o agora
// entra por parâmetro. Função que lê o relógio por conta própria é função que
// só se testa esperando o tempo passar.
// ============================================================================

/**
 * Os quatro papéis do enum `wa_mensagens.papel`, medidos no banco em 09/08.
 *
 * A tabela `mensagens` (canal site) usa OUTRO vocabulário — medido: só
 * 'cliente' (213) e 'agente' (213). A tradução 'agente' → 'prosperito' é feita
 * na página, ao montar a `ConversaSala`, e não aqui: são duas tabelas com
 * história diferente, e o que esta lib precisa saber é uma coisa só — se quem
 * falou por último foi o cliente. Para essa pergunta, 'agente' e 'prosperito'
 * dizem o mesmo (o robô respondeu), então a tradução não perde nada que a sala
 * use.
 */
export type Papel = "cliente" | "prosperito" | "sistema" | "humano";

/**
 * Os canais reais, MEDIDOS em 09/08: `wa_conversas.canal` tem 23 whatsapp + 4
 * instagram; `conversas.canal` tem 28 site.
 *
 * Isto corrige um defeito da tela anterior, que rotulava as 27 do WhatsApp como
 * "WhatsApp" porque derivava o canal da TABELA (wa_conversas = WhatsApp) em vez
 * da COLUNA. A coluna existe e estava sendo ignorada — quatro conversas do
 * Instagram apareciam com o crachá errado.
 *
 * O site entra AQUI, e não numa aritmética paralela, porque a fila é UMA só: o
 * cliente que preencheu o formulário espera igual ao que mandou WhatsApp, e uma
 * sala que ordena os dois em listas separadas devolve ao operador exatamente o
 * trabalho que esta lib existe para tirar dele — comparar duas filas de cabeça.
 */
export type CanalSala = "whatsapp" | "instagram" | "site";

export type ConversaSala = {
  id: string;
  canal: CanalSala;
  nome: string | null;
  telefone: string | null;
  status: string;
  /** Última mensagem de QUALQUER papel — o relógio da conversa. */
  ultimaEm: string | null;
  /** Papel de quem falou por último. Decide se alguém está esperando. */
  ultimoPapel: Papel | null;
  /** O que o CLIENTE disse por último — nunca o que o bot respondeu. */
  ultimaFalaCliente: string | null;
  /** Quando o cliente falou por último. Base do tempo de espera. */
  ultimaFalaClienteEm: string | null;
  totalMensagens: number;
  temAnexo: boolean;
  /**
   * Quanto tempo (ms) o cliente esperou pela PRIMEIRA resposta desta conversa.
   * `null` quando a pergunta ainda não foi respondida — ver `resumirConversa`.
   */
  msPrimeiraResposta: number | null;
};

// ---------------------------------------------------------------------------
// Redução por conversa
// ---------------------------------------------------------------------------

/** A mensagem como a página a lê do banco, dos dois canais. */
export type MensagemCrua = {
  papel: Papel;
  conteudo: string | null;
  criado_em: string;
  temAnexo?: boolean;
};

/** Os campos derivados de uma conversa, a partir das mensagens dela. */
export type ResumoConversa = Pick<
  ConversaSala,
  | "ultimaEm"
  | "ultimoPapel"
  | "ultimaFalaCliente"
  | "ultimaFalaClienteEm"
  | "totalMensagens"
  | "temAnexo"
  | "msPrimeiraResposta"
>;

/**
 * Reduz as mensagens de UMA conversa aos campos que o card mostra.
 *
 * POR QUE ISTO NÃO FICOU NA PÁGINA. É aqui que mora a regra mais fácil de errar
 * sem que ninguém veja: "a última fala do CLIENTE" — não a última mensagem. A
 * tela anterior mostrava a data e nada do teor; a versão errada óbvia mostraria
 * a última mensagem qualquer, que em 142 das 328 é o próprio bot falando. O
 * operador leria a sala inteira como se fosse o Prosperito conversando sozinho.
 *
 * A PRIMEIRA RESPOSTA, E POR QUE 'null' NÃO É ZERO. Percorre em ordem crescente
 * e procura a primeira fala do cliente; a resposta é a primeira mensagem de
 * 'prosperito' ou 'humano' DEPOIS dela. Três casos devolvem `null`, cada um por
 * uma razão diferente:
 *
 *   1. o cliente nunca falou (disparo ativo, template que ninguém respondeu) —
 *      não houve pergunta, então não há tempo de resposta a medir;
 *   2. o cliente falou e ainda NÃO foi respondido — esta é a decisão que
 *      importa. A tentação é contar "agora menos a pergunta", mas isso mistura
 *      uma medição encerrada com um cronômetro em curso e faz a mediana piorar
 *      sozinha a cada segundo, sem ninguém ter feito nada. Essa conversa já é
 *      contada onde deve: no número "aguardando resposta";
 *   3. só houve 'sistema' depois — e 'sistema' é a nota de handoff que o painel
 *      escreve, não uma resposta ao cliente. Contá-la como resposta faria "um
 *      humano assumiu" parecer "o cliente foi atendido", que é exatamente a
 *      confusão que a sala existe para desfazer.
 *
 * A comparação é POR POSIÇÃO na lista ordenada, não por subtração de datas.
 * Duas mensagens no mesmo instante são um empate que a data não resolve, e a
 * ordem em que elas chegaram é a informação que sobra.
 */
export function resumirConversa(msgs: MensagemCrua[]): ResumoConversa {
  const ordenadas = [...msgs].sort(
    (a, b) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime()
  );

  let ultimaFalaCliente: string | null = null;
  let ultimaFalaClienteEm: string | null = null;
  let temAnexo = false;
  let primeiraClienteEm: string | null = null;
  let msPrimeiraResposta: number | null = null;

  for (const m of ordenadas) {
    if (m.temAnexo) temAnexo = true;

    if (m.papel === "cliente") {
      ultimaFalaCliente = m.conteudo ?? null;
      ultimaFalaClienteEm = m.criado_em;
      if (!primeiraClienteEm) primeiraClienteEm = m.criado_em;
      continue;
    }

    // Resposta só conta se veio DEPOIS de uma pergunta, e só a primeira.
    if (
      primeiraClienteEm &&
      msPrimeiraResposta === null &&
      (m.papel === "prosperito" || m.papel === "humano")
    ) {
      const dt = new Date(m.criado_em).getTime() - new Date(primeiraClienteEm).getTime();
      if (Number.isFinite(dt)) msPrimeiraResposta = Math.max(0, dt);
    }
  }

  const ultima = ordenadas[ordenadas.length - 1] ?? null;

  return {
    ultimaEm: ultima?.criado_em ?? null,
    ultimoPapel: ultima?.papel ?? null,
    ultimaFalaCliente,
    ultimaFalaClienteEm,
    totalMensagens: ordenadas.length,
    temAnexo,
    msPrimeiraResposta,
  };
}

// ---------------------------------------------------------------------------
// Identidade
// ---------------------------------------------------------------------------

/**
 * Formata o contato para leitura humana.
 *
 * TRÊS CANAIS, TRÊS FORMATOS — e a razão de não serem um só está medida.
 *
 * 1. INSTAGRAM não é telefone. Ali `telefone` guarda um IGSID (medido:
 *    `1310819618770667`, 16 dígitos). Formatá-lo como DDI+DDD produziria
 *    "+13 10 81961-8770667" — um número que não existe, exibido com a
 *    confiança de um número que existe. Quatro das 27 conversas cairiam nisso.
 *
 * 2. WHATSAPP guarda com DDI. Medido em `wa_conversas`: 13 linhas com 13
 *    dígitos e 9 com 12 dígitos (o formato antigo, sem o nono) — as duas
 *    formas começando em 55. Essas viram "+55 19 99756-1909", como a OS pediu.
 *
 * 3. SITE guarda SEM DDI. Medido em `interesses`: as 41 linhas têm exatamente
 *    11 dígitos e NENHUMA começa em 55 — o formulário coleta o número como o
 *    brasileiro o escreve. Por isso o site sai em forma nacional,
 *    "(19) 99756-1909", e NÃO "+55 19 99756-1909": carimbar um DDI que o banco
 *    nunca guardou é inventar dado, e a própria OS proíbe ("Sem dado
 *    inventado"). O 55 estaria certo em 40 dos 41 casos e errado no 41º sem
 *    que ninguém percebesse — e é justamente o caso que a formatação esconderia
 *    que interessa a quem vai discar.
 *
 * O QUE NÃO BATE COM NENHUM MOLDE SAI CRU. Medido: uma linha de `wa_conversas`
 * tem 12 dígitos começando em `44` — DDI do Reino Unido, não Brasil. Nenhuma
 * regex daqui a toca, e é o comportamento correto: devolver o número como veio
 * mostra que ele é estranho; formatá-lo à força o disfarçaria de nacional.
 */
export function formatarContato(
  telefone: string | null,
  canal: CanalSala
): { texto: string; ehTelefone: boolean } {
  const cru = (telefone ?? "").trim();
  if (!cru) return { texto: "sem contato", ehTelefone: false };

  if (canal === "instagram") {
    return { texto: `ID ${cru}`, ehTelefone: false };
  }

  const d = cru.replace(/\D/g, "");

  if (canal === "site") {
    // DDD(2) + número(8 fixo | 9 celular), sem DDI — o formato medido nas 41.
    const n = /^(\d{2})(\d{4,5})(\d{4})$/.exec(d);
    if (!n) return { texto: cru, ehTelefone: false };
    return { texto: `(${n[1]}) ${n[2]}-${n[3]}`, ehTelefone: true };
  }

  // 55 + DDD(2) + número(8 fixo | 9 celular). Fora disso, devolve como veio:
  // inventar formatação para um número que não bate com o padrão é esconder
  // que ele não bate.
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  if (!m) return { texto: cru, ehTelefone: false };
  return { texto: `+55 ${m[1]} ${m[2]}-${m[3]}`, ehTelefone: true };
}

/**
 * Iniciais para o avatar de texto. Sem foto de perfil — a OS vetou, e com
 * razão: é dado de terceiro que não precisamos guardar para atender.
 *
 * Sem nome, o avatar não inventa letra a partir do telefone (o "55" de todo
 * mundo viraria a mesma inicial, e um mural de "55" não identifica ninguém).
 * Devolve nulo, e a tela mostra o crachá "sem nome".
 */
export function iniciais(nome: string | null): string | null {
  const limpo = (nome ?? "").trim().replace(/\s+/g, " ");
  if (!limpo) return null;
  const partes = limpo.split(" ").filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  const sigla = (primeira + ultima).toUpperCase();
  return sigla || null;
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

/** Teto da prévia da fala, em caracteres. A OS pediu "uns 90". */
export const LIMITE_FALA = 90;

/**
 * Resume a última fala do cliente para caber numa linha.
 *
 * Corta em espaço SEMPRE QUE isso não jogue fora quase o texto todo, e só põe
 * reticências quando de fato cortou. Reticência em texto que coube é ruído que
 * faz o operador achar que há mais texto escondido.
 *
 * A RESSALVA DOS 60% É O CASO REAL, não a exceção teórica. Em prosa — "quero
 * vender minha cota do consórcio de imóvel que tenho na Porto" — há espaço a
 * cada seis caracteres, o último cai colado no limite e a fronteira é sempre
 * respeitada. A guarda só dispara quando NÃO há prosa: uma URL de rastreio, um
 * código de barras colado, um `aaaa…` de teste. Aí a fronteira de palavra fica
 * lá atrás, e obedecê-la transformaria 90 caracteres de prévia em 12. Nesse
 * caso o corte é duro no limite, de propósito: prévia truncada no meio de um
 * token ilegível ainda mostra mais do que prévia vazia.
 *
 * Quebras de linha viram espaço: uma mensagem de WhatsApp com três enters
 * arrebentaria a altura do card e desalinharia a lista inteira.
 */
export function resumirFala(conteudo: string | null, limite = LIMITE_FALA): string | null {
  const t = (conteudo ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= limite) return t;
  const cortado = t.slice(0, limite);
  const ultimoEspaco = cortado.lastIndexOf(" ");
  // Só respeita a fronteira de palavra se ela não jogar fora metade do texto —
  // uma URL gigante sem espaço não pode virar reticência sozinha.
  const base = ultimoEspaco > limite * 0.6 ? cortado.slice(0, ultimoEspaco) : cortado;
  return `${base.trimEnd()}…`;
}

/**
 * Tempo relativo em português, na voz que o operador usa.
 *
 * Não usa Intl.RelativeTimeFormat de propósito: ele diria "há 1 dia" onde o
 * atendimento diz "ontem", e "há 2 dias" onde a sala diz "2 dias". A tela é
 * para quem prioriza fila, não para quem lê data.
 *
 * Futuro devolve "agora": relógio de servidor adiantado em poucos segundos não
 * pode virar "em 3 segundos" na tela.
 */
export function tempoRelativo(iso: string | null, agoraMs: number): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";

  const seg = Math.floor((agoraMs - t) / 1000);
  if (seg < 60) return "agora";

  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;

  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;

  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `${d} dias`;

  const meses = Math.floor(d / 30);
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(d / 365);
  return `${anos} ${anos === 1 ? "ano" : "anos"}`;
}

// ---------------------------------------------------------------------------
// A fila
// ---------------------------------------------------------------------------

/**
 * Está esperando resposta HUMANA?
 *
 * A regra tem duas metades, e a segunda é a que importa:
 *   1. o cliente falou por último — ninguém respondeu depois dele;
 *   2. E o bot não está no comando (`status === 'humano'` = alguém assumiu).
 *
 * Se o bot está ativo e respondeu, não há espera. Se alguém ASSUMIU e o cliente
 * falou depois, há espera de gente — e é a mais cara da casa, porque o cliente
 * já foi avisado de que tem um humano do outro lado.
 *
 * MEDIDO em 09/08: 5 das 27 têm o cliente como último papel; 1 dessas está
 * assumida. Ou seja, a tela de hoje esconde 5 pessoas esperando no meio de uma
 * ordenação cronológica.
 */
export function esperandoHumano(c: ConversaSala): boolean {
  if (c.ultimoPapel !== "cliente") return false;
  // Encerrada não espera: foi arquivada de propósito. Se o cliente escrever de
  // novo, o webhook reabre — e aí ela volta à fila por mérito próprio.
  if (c.status === "encerrado" || c.status === "fechada") return false;
  return true;
}

/**
 * Há quanto tempo (ms) esta conversa espera por resposta humana. `null` quando
 * não espera — e `null` NÃO é zero: zero iria para o topo da fila.
 */
export function esperaMs(c: ConversaSala, agoraMs: number): number | null {
  if (!esperandoHumano(c)) return null;
  const base = c.ultimaFalaClienteEm ?? c.ultimaEm;
  if (!base) return null;
  const t = new Date(base).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, agoraMs - t);
}

/**
 * A ORDENAÇÃO PADRÃO da sala, que é a diferença entre um log e uma fila.
 *
 * Duas camadas:
 *   1. quem espera resposta humana vem ANTES de quem não espera — sempre,
 *      mesmo que a conversa que espera seja mais antiga. Cronologia pura
 *      empurra para o fim exatamente quem está há mais tempo sem resposta,
 *      que é o inverso do que a sala precisa;
 *   2. dentro de cada grupo: quem espera há MAIS tempo primeiro; quem não
 *      espera, por atividade mais recente.
 *
 * Ordena uma CÓPIA. `sort` muta o array, e mutar a lista que a página já
 * derivou é o tipo de efeito colateral que só aparece na segunda leitura.
 */
export function ordenarSala(lista: ConversaSala[], agoraMs: number): ConversaSala[] {
  return [...lista].sort((a, b) => {
    const ea = esperaMs(a, agoraMs);
    const eb = esperaMs(b, agoraMs);

    if (ea !== null && eb === null) return -1;
    if (ea === null && eb !== null) return 1;
    if (ea !== null && eb !== null) return eb - ea;

    const ta = a.ultimaEm ? new Date(a.ultimaEm).getTime() : 0;
    const tb = b.ultimaEm ? new Date(b.ultimaEm).getTime() : 0;
    return tb - ta;
  });
}

/**
 * Mediana, não média — e a escolha é o ponto.
 *
 * Uma conversa esquecida por três dias joga a MÉDIA para as dezenas de horas e
 * faz o número dizer que o atendimento é péssimo quando quase todo mundo é
 * respondido em minutos. A mediana descreve o atendimento típico, que é o que
 * o número do topo promete descrever.
 *
 * Lista vazia devolve `null` — e a tela escreve "sem dados", nunca "0 min".
 * Zero minuto seria a leitura mais elogiosa possível de "não sei".
 */
export function mediana(valores: number[]): number | null {
  const v = valores.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

/**
 * Duração legível para o número do topo. Entra ms, sai "12 min" / "2h 10".
 *
 * `floor`, não `round`. Com `round`, 30 segundos viravam "1 min" — o teste
 * pegou. Não é preciosismo de arredondamento: "12 min" na tela significa "já
 * se passaram 12 minutos", e arredondar para cima faz o número prometer uma
 * espera que ainda não aconteceu. Truncar erra sempre para o lado de dizer
 * menos do que se sabe, que é o lado seguro de um número que julga atendimento.
 */
export function duracaoCurta(ms: number | null): string {
  if (ms === null) return "sem dados";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  if (h < 24) return resto ? `${h}h ${String(resto).padStart(2, "0")}` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}
