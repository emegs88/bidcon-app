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
  /**
   * A última coisa que o bot (ou o humano) disse ANTES dessa fala do cliente —
   * ou seja, a pergunta que ela provavelmente responde. `null` quando o cliente
   * abriu a conversa. Só serve à prévia; ver `previaComContexto`.
   */
  ultimaPerguntaBot: string | null;
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
  | "ultimaPerguntaBot"
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
 *
 * A PERGUNTA ANTERIOR (CONVERSAS-03, item 4). Guarda também a última fala de
 * quem NÃO é o cliente imediatamente antes da última fala dele. Serve a um
 * problema medido na tela: metade das prévias da sala é resposta de um dígito
 * — "2", "sim", "125mil" — e um dígito solto na lista não é informação, é
 * ruído. Com a pergunta ao lado, "2" vira "quantas parcelas restam: 2".
 *
 * 'sistema' fica de fora desta captura pelo mesmo motivo que fica de fora da
 * primeira resposta: é a nota de handoff que o próprio painel escreve
 * ("Emerson assumiu"), não uma pergunta feita ao cliente. Exibi-la como
 * pergunta faria a prévia ler "Emerson assumiu · 2", que não quer dizer nada.
 */
export function resumirConversa(msgs: MensagemCrua[]): ResumoConversa {
  const ordenadas = [...msgs].sort(
    (a, b) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime()
  );

  let ultimaFalaCliente: string | null = null;
  let ultimaFalaClienteEm: string | null = null;
  let ultimaPerguntaBot: string | null = null;
  let temAnexo = false;
  let primeiraClienteEm: string | null = null;
  let msPrimeiraResposta: number | null = null;

  // O que o bot/humano falou por último ATÉ AQUI. Vira `ultimaPerguntaBot` no
  // instante em que o cliente responde — depois disso, uma fala nova do bot
  // sobrescreve este rascunho sem tocar no que já foi respondido.
  let rascunhoPergunta: string | null = null;

  for (const m of ordenadas) {
    if (m.temAnexo) temAnexo = true;

    if (m.papel === "cliente") {
      ultimaFalaCliente = m.conteudo ?? null;
      ultimaFalaClienteEm = m.criado_em;
      ultimaPerguntaBot = rascunhoPergunta;
      if (!primeiraClienteEm) primeiraClienteEm = m.criado_em;
      continue;
    }

    if (m.papel === "prosperito" || m.papel === "humano") {
      const t = (m.conteudo ?? "").trim();
      if (t) rascunhoPergunta = t;
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
    ultimaPerguntaBot,
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

// ===========================================================================
// CONVERSAS-03 — período e legibilidade
// AUTORIZADO: Emerson Gomes dos Santos — 11/08/2026:
//   "melhor filtro por dia, não deixar confuso, melhorar painel"
// ---------------------------------------------------------------------------
// O DEFEITO QUE ESTA SEÇÃO CONSERTA, MEDIDO ANTES DE ESCREVER UMA LINHA.
//
// A página calculava o começo do dia assim:
//
//     const inicioDoDia = new Date();
//     inicioDoDia.setHours(0, 0, 0, 0);
//
// `setHours` usa o fuso do PROCESSO. A Vercel roda em UTC; o Brasil está em
// UTC-3. Todo dia, das 21h à meia-noite de Brasília, "conversas hoje" já
// virou o dia seguinte no servidor — o número zerava três horas antes da
// virada, na faixa da noite em que o WhatsApp mais fala. Ninguém ia notar:
// um contador que mostra 0 parece um dia parado, não um dia errado.
//
// Enquanto o único consumidor era um número de cabeçalho, o estrago era um
// número torto. Com filtro por dia e separadores por dia, a mesma conta passa
// a decidir o que a lista MOSTRA e sob qual cabeçalho — e aí conversa some.
// Por isso a fronteira do dia é calculada aqui, em `America/São_Paulo`
// explícito, com teste, e não com o relógio de quem estiver rodando o
// processo.
// ===========================================================================

/**
 * O fuso da casa, escrito por extenso e num só lugar.
 *
 * Não é `-03:00` fixo de propósito. O Brasil já teve horário de verão e pode
 * ter de novo; um deslocamento cravado no código atravessaria a mudança
 * mentindo, e mentindo em silêncio. `Intl` carrega a tabela e acerta sozinho.
 */
export const TZ_CASA = "America/Sao_Paulo";

const MS_DIA = 24 * 60 * 60 * 1000;

function dois(n: number): string {
  return String(n).padStart(2, "0");
}

type PartesData = {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  min: number;
  seg: number;
};

/**
 * Quebra um instante nas partes do calendário CIVIL de um fuso.
 *
 * `hourCycle: "h23"` e não `hour12: false`: com `hour12: false` alguns motores
 * devolvem hora "24" para a meia-noite, e 24 vira o dia seguinte na hora de
 * remontar. O ciclo h23 fecha essa porta.
 */
function partesTz(ms: number, tz: string): PartesData {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));

  const ler = (tipo: string): number => {
    const achado = p.find((x) => x.type === tipo)?.value ?? "0";
    const n = Number(achado);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    ano: ler("year"),
    mes: ler("month"),
    dia: ler("day"),
    hora: ler("hour") % 24,
    min: ler("minute"),
    seg: ler("second"),
  };
}

/**
 * Quanto o fuso está deslocado do UTC, em minutos, NAQUELE instante.
 *
 * Negativo a oeste: São Paulo devolve -180. Depende do instante porque é
 * exatamente isso que o horário de verão muda.
 */
export function offsetTzMinutos(ms: number, tz: string = TZ_CASA): number {
  const p = partesTz(ms, tz);
  const comoSeFosseUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min, p.seg);
  // O arredondamento come os milissegundos que `comoSeFosseUtc` não carrega;
  // deslocamento de fuso é sempre minuto inteiro, então nada se perde.
  return Math.round((comoSeFosseUtc - ms) / 60000);
}

/**
 * O instante (em ms UTC) da meia-noite civil do dia em que `ms` cai, no fuso.
 *
 * DUAS PASSADAS, e a segunda não é preciosismo. A primeira usa o deslocamento
 * do instante consultado; se o horário de verão virar no meio daquele dia, o
 * deslocamento à meia-noite é OUTRO, e a primeira conta erra por uma hora —
 * o bastante para a fronteira cair no dia anterior. A segunda passada refaz a
 * conta com o deslocamento do candidato e só o aceita se ele de fato cair às
 * 00:00 do mesmo dia civil.
 *
 * Quando a meia-noite simplesmente NÃO EXISTE (madrugada que pula da 23:59
 * para a 01:00), nenhum candidato satisfaz o teste e a função devolve a
 * primeira conta. É a resposta menos errada disponível: um começo de dia
 * deslocado numa hora, uma vez por ano, contra uma exceção lançada na cara do
 * operador.
 */
export function inicioDoDiaMs(ms: number, tz: string = TZ_CASA): number {
  const p = partesTz(ms, tz);
  const meiaNoiteComoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, 0, 0, 0, 0);

  const primeira = meiaNoiteComoUtc - offsetTzMinutos(ms, tz) * 60000;
  const segunda = meiaNoiteComoUtc - offsetTzMinutos(primeira, tz) * 60000;

  const q = partesTz(segunda, tz);
  const bate =
    q.ano === p.ano &&
    q.mes === p.mes &&
    q.dia === p.dia &&
    q.hora === 0 &&
    q.min === 0 &&
    q.seg === 0;

  return bate ? segunda : primeira;
}

/** A meia-noite civil do dia SEGUINTE ao de `ms`. */
function proximoDiaMs(ms: number, tz: string): number {
  // +36h e não +24h: com 24h, a virada do horário de verão para trás cairia de
  // volta no mesmo dia civil e a janela do "hoje" ficaria vazia.
  return inicioDoDiaMs(inicioDoDiaMs(ms, tz) + 36 * 60 * 60 * 1000, tz);
}

function chaveDeMs(ms: number, tz: string): string {
  const p = partesTz(ms, tz);
  return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}`;
}

/**
 * A chave de agrupamento de um dia: `"2026-08-11"` no fuso da casa.
 *
 * `null` para data ausente ou impossível de ler — e quem chama tem de decidir
 * o que fazer com isso. Devolver a chave de hoje seria empurrar a conversa
 * para um dia em que ela não aconteceu.
 */
export function chaveDia(iso: string | null, tz: string = TZ_CASA): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return chaveDeMs(t, tz);
}

// ---------------------------------------------------------------------------
// Item 1 — o filtro de período
// ---------------------------------------------------------------------------

export type Periodo = "hoje" | "ontem" | "7d" | "30d" | "tudo";

/**
 * O padrão pedido na OS. Sete dias, e não "tudo", porque a sala é uma fila de
 * trabalho: conversa de março não está esperando ninguém, está esperando ser
 * esquecida. Quem precisar dela pede "tudo" num clique.
 */
export const PERIODO_PADRAO: Periodo = "7d";

export const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "ontem", rotulo: "Ontem" },
  { valor: "7d", rotulo: "7 dias" },
  { valor: "30d", rotulo: "30 dias" },
  { valor: "tudo", rotulo: "Tudo" },
];

/**
 * Lê o `?periodo=` da URL. Valor desconhecido cai no padrão, sem reclamar:
 * um link velho ou um erro de digitação não pode virar tela de erro.
 */
export function lerPeriodo(bruto: string | null | undefined): Periodo {
  const v = (bruto ?? "").trim().toLowerCase();
  const achado = PERIODOS.find((p) => p.valor === v);
  return achado ? achado.valor : PERIODO_PADRAO;
}

/**
 * A janela de um período. `desdeMs` inclusivo, `ateMs` EXCLUSIVO — a meia-noite
 * pertence ao dia que começa, nunca aos dois.
 *
 * `null` nos dois lados é "sem fronteira daquele lado".
 */
export type Janela = { desdeMs: number | null; ateMs: number | null };

/**
 * Traduz o chip escolhido em fronteiras de relógio.
 *
 * "7 dias" é HOJE MAIS OS SEIS ANTERIORES, não "as últimas 168 horas". Os
 * chips vizinhos são "Hoje" e "Ontem", que são dias civis; misturar uma janela
 * deslizante no meio de dias civis faria a conversa de terça de manhã sumir de
 * "7 dias" na terça à tarde, sem nada ter acontecido.
 *
 * O limite superior fica ABERTO em tudo que inclui hoje. Mensagem com carimbo
 * no futuro (relógio de aparelho adiantado — acontece) continua visível em vez
 * de cair num limbo entre a janela e o amanhã.
 */
export function janelaPeriodo(
  periodo: Periodo,
  agoraMs: number,
  tz: string = TZ_CASA
): Janela {
  if (periodo === "tudo") return { desdeMs: null, ateMs: null };

  const inicioHoje = inicioDoDiaMs(agoraMs, tz);

  if (periodo === "hoje") return { desdeMs: inicioHoje, ateMs: null };

  if (periodo === "ontem") {
    // -12h em vez de -24h: cai no meio de ontem, longe de qualquer fronteira,
    // e portanto imune à hora que o horário de verão come ou devolve.
    const inicioOntem = inicioDoDiaMs(inicioHoje - 12 * 60 * 60 * 1000, tz);
    return { desdeMs: inicioOntem, ateMs: inicioHoje };
  }

  const dias = periodo === "7d" ? 7 : 30;
  const desdeMs = inicioDoDiaMs(inicioHoje - (dias - 1) * MS_DIA + MS_DIA / 2, tz);
  return { desdeMs, ateMs: null };
}

/**
 * A conversa cai na janela?
 *
 * SEM DATA NÃO ENTRA EM JANELA DATADA, e isso é deliberado: uma conversa sem
 * `ultimaEm` não tem dia, então não há dia sob o qual mostrá-la. Ela reaparece
 * inteira em "Tudo". A página CONTA quantas foram escondidas e escreve o
 * número na tela — sumiço silencioso é o defeito que esta função poderia
 * introduzir, e a conta na tela é o que impede.
 */
export function dentroDoPeriodo(iso: string | null, j: Janela): boolean {
  if (j.desdeMs === null && j.ateMs === null) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  if (j.desdeMs !== null && t < j.desdeMs) return false;
  if (j.ateMs !== null && t >= j.ateMs) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Item 2 — os separadores de dia
// ---------------------------------------------------------------------------

/**
 * Abreviações fixas, e não `Intl.DateTimeFormat(..., { weekday: "short" })`.
 *
 * Duas razões, nesta ordem: o pt-BR do ICU devolve "sex." — minúsculo e com
 * ponto, que não é o rótulo que a tela quer; e a saída do ICU varia com a
 * versão dos dados de locale, o que faria um teste passar aqui e falhar na
 * Vercel. Sete strings numa constante não têm versão.
 */
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * O cabeçalho de um grupo: "Hoje", "Ontem", "Sex 08/08" — e "Sex 08/08/2025"
 * quando o ano não é o corrente, porque em "Tudo" a lista atravessa anos e
 * "08/08" sozinho seria ambíguo justamente onde a ambiguidade engana.
 */
export function rotuloDia(
  chave: string,
  agoraMs: number,
  tz: string = TZ_CASA
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave);
  if (!m) return chave;

  const hoje = chaveDeMs(agoraMs, tz);
  if (chave === hoje) return "Hoje";

  const inicioHoje = inicioDoDiaMs(agoraMs, tz);
  const ontem = chaveDeMs(inicioHoje - 12 * 60 * 60 * 1000, tz);
  if (chave === ontem) return "Ontem";

  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const semana = DIAS_SEMANA[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()];
  const base = `${semana} ${dois(dia)}/${dois(mes)}`;
  return ano === Number(hoje.slice(0, 4)) ? base : `${base}/${ano}`;
}

export type GrupoDia<T> = { chave: string; rotulo: string; itens: T[] };

/**
 * O que sobra depois de agrupar. `semData` é devolvido, não descartado.
 *
 * A versão fácil desta função devolveria só os grupos e engoliria quem não tem
 * data. Item sumido é o pior defeito de tela que existe: não há erro, não há
 * lista vazia, há uma lista plausível com uma linha a menos.
 */
export type Agrupamento<T> = { grupos: GrupoDia<T>[]; semData: T[] };

/**
 * Agrupa por dia civil, do mais recente para o mais antigo, PRESERVANDO a
 * ordem de entrada dentro de cada dia — a lista já chega ordenada pela sala, e
 * reordenar aqui desfaria a fila em silêncio.
 */
export function agruparPorDia<T>(
  itens: T[],
  data: (i: T) => string | null,
  agoraMs: number,
  tz: string = TZ_CASA
): Agrupamento<T> {
  const mapa = new Map<string, T[]>();
  const semData: T[] = [];

  for (const item of itens) {
    const chave = chaveDia(data(item), tz);
    if (!chave) {
      semData.push(item);
      continue;
    }
    const atual = mapa.get(chave);
    if (atual) atual.push(item);
    else mapa.set(chave, [item]);
  }

  const grupos = [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([chave, lista]) => ({
      chave,
      rotulo: rotuloDia(chave, agoraMs, tz),
      itens: lista,
    }));

  return { grupos, semData };
}

/**
 * Separa a fila do resto — e este é o DESVIO que declaro ao Emerson.
 *
 * Os separadores de dia (item 2) e a ordenação da CONVERSAS-02 ("quem esperou
 * mais vem no topo") se contradizem: agrupar por dia é ordenar por dia, e isso
 * enterra a pessoa que espera há três dias lá embaixo, no cabeçalho da
 * terça-feira. Uma das duas ordens tem de ceder, e nenhuma delas é decorativa.
 *
 * A saída escolhida não sacrifica nenhuma: quem espera resposta humana sai da
 * linha do tempo e vira um bloco fixo no topo, sem cabeçalho de dia; o RESTO,
 * que é histórico, é o que ganha os separadores. A fila continua sendo fila e
 * a linha do tempo continua legível — ao preço de a tela ter duas seções em vez
 * de uma, que é o preço que se declara em vez de se esconder.
 */
// GENÉRICA DE PROPÓSITO. A página empacota cada conversa num tipo mais largo
// (`Linha`, com href, criadoEm, cedente…) e precisa desses campos de volta para
// desenhar o card. Sem o genérico, a chamada teria de terminar em
// `as { fila: Linha[]; resto: Linha[] }` — um casto na PÁGINA, que a suíte não
// varre. Com o genérico, o único casto fica aqui dentro, uma linha abaixo, onde
// há teste: e ele é honesto, porque `ordenarSala` devolve uma cópia ordenada dos
// MESMOS objetos, sem construir nenhum.
export function separarSala<T extends ConversaSala>(
  lista: T[],
  agoraMs: number
): { fila: T[]; resto: T[] } {
  const ordenada = ordenarSala(lista, agoraMs) as T[];
  const fila: T[] = [];
  const resto: T[] = [];
  for (const c of ordenada) {
    if (esperandoHumano(c)) fila.push(c);
    else resto.push(c);
  }
  return { fila, resto };
}

// ---------------------------------------------------------------------------
// Item 3 — a pastilha nunca repete o título
// ---------------------------------------------------------------------------

export type IdentidadeCard = {
  /** A linha forte do card. */
  titulo: string;
  /** A linha fraca. `null` quando repetiria o título. */
  subtitulo: string | null;
  /** Sem nome cadastrado — para o avatar, não para pastilha nenhuma. */
  semNome: boolean;
  /** O título é um telefone de verdade (muda a tipografia, não o texto). */
  tituloEhContato: boolean;
};

/**
 * Quem é esta conversa, em uma ou duas linhas.
 *
 * A REGRA, na formulação do Emerson: "pastilha nunca repete o que o título
 * diz". A tela anterior escrevia "Sem nome" como título, o telefone embaixo e
 * ainda uma pastilha "sem nome" ao lado — três elementos para dizer duas
 * coisas, e a mais inútil delas repetida. Sem nome, o TELEFONE sobe e vira o
 * título: é o único identificador que existe, e é o que o operador vai discar.
 *
 * Sem nome E sem contato o título vira "Sem contato" — que é fato, não rótulo
 * de ausência: essa conversa realmente não tem por onde ser respondida, e o
 * card precisa dizer isso onde se lê primeiro.
 */
export function identidadeCard(
  c: Pick<ConversaSala, "nome" | "telefone" | "canal">
): IdentidadeCard {
  const contato = formatarContato(c.telefone, c.canal);
  const nome = (c.nome ?? "").trim();

  if (nome) {
    return {
      titulo: nome,
      subtitulo: contato.texto,
      semNome: false,
      tituloEhContato: false,
    };
  }

  const vazio = contato.texto === "sem contato";
  return {
    titulo: vazio ? "Sem contato" : contato.texto,
    subtitulo: null,
    semNome: true,
    tituloEhContato: !vazio,
  };
}

// ---------------------------------------------------------------------------
// Item 4 — a prévia curta demais
// ---------------------------------------------------------------------------

/**
 * Abaixo disto, a fala do cliente não se sustenta sozinha. A OS pediu "uns 12
 * caracteres", e o número resiste ao teste da lista real: "2", "sim", "ok",
 * "125 mil" e "Porto Seguro" (12, no limite, e já legível) ficam de um lado; a
 * primeira frase de verdade fica do outro.
 */
export const LIMITE_FALA_CURTA = 12;

/** Teto da pergunta do bot na prévia. Ela é contexto, não protagonista. */
export const LIMITE_PERGUNTA = 60;

export type Previa = {
  /** A pergunta do bot, só quando a resposta não se explica sozinha. */
  pergunta: string | null;
  /** A fala do cliente, sempre. */
  resposta: string;
};

/**
 * Monta a prévia do card.
 *
 * Devolve `null` quando o cliente nunca falou — e a tela escreve "aguardando o
 * cliente", que é diferente de linha vazia.
 *
 * A pergunta só entra quando a resposta é curta demais para se explicar. Pôr
 * a pergunta em TODA prévia dobraria o tamanho da lista para repetir o que o
 * bot já disse 27 vezes; pôr só onde falta contexto é o conserto do ruído sem
 * criar ruído novo.
 */
export function previaComContexto(
  ultimaFalaCliente: string | null,
  ultimaPerguntaBot: string | null,
  limiteCurta: number = LIMITE_FALA_CURTA,
  limite: number = LIMITE_FALA
): Previa | null {
  const resposta = resumirFala(ultimaFalaCliente, limite);
  if (!resposta) return null;

  const cru = (ultimaFalaCliente ?? "").replace(/\s+/g, " ").trim();
  if (cru.length >= limiteCurta) return { pergunta: null, resposta };

  const pergunta = resumirFala(ultimaPerguntaBot, LIMITE_PERGUNTA);
  return { pergunta, resposta };
}
