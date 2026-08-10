// ============================================================================
// FAROL-ARTE-01 — buscar a arte do acervo, ou desistir sem barulho
// AUTORIZADO: Emerson Gomes dos Santos — 09/08/2026:
//   "O FALLBACK OBRIGATÓRIO com teste — é onde mora o risco real da fatia:
//    arte inexistente, id inválido, arquivo corrompido, bucket fora do ar ou
//    lento devem TODOS cair no card de hoje, idêntico, sem drama e sem post
//    perdido. Exercitável com id inventado, custo zero."
// ----------------------------------------------------------------------------
// A REGRA DESTE MÓDULO, EM UMA LINHA: `buscarArte` NUNCA lança e NUNCA
// devolve algo pela metade. Ou vem uma arte inteira e validada, ou vem `null`.
// Não existe terceiro estado, e não existe caminho por onde uma falha daqui
// chegue ao chamador como exceção.
//
// POR QUE ISSO É O ITEM MAIS IMPORTANTE DA FATIA E NÃO UM DETALHE DE ROBUSTEZ:
// quem consome /api/card-image é o servidor da Meta montando um post. Se esta
// função estourar, o card não sai; se o card não sai, O POST DO DIA NÃO
// ACONTECE. A arte é enfeite — o post é o produto. Enfeite não pode derrubar
// produto. Por isso todo caminho de erro abaixo termina em `null`, e `null`
// significa exatamente uma coisa para o chamador: renderize o card de hoje,
// idêntico ao que ele seria se esta fatia nunca tivesse existido.
//
// ----------------------------------------------------------------------------
// POR QUE UM PRAZO ÚNICO EM VOLTA DE TUDO
// ----------------------------------------------------------------------------
// Os modos de falha pedidos na ordem se dividem em dois tipos: os que FALHAM
// (id inválido, linha inexistente, arquivo corrompido, bucket 500) e os que
// DEMORAM (bucket lento, banco lento). Os primeiros são pegos um a um, com
// motivo nomeado no log. O segundo tipo não se pega com try/catch — só com
// relógio. `Promise.race` contra um prazo cobre O TRAJETO INTEIRO (consulta ao
// banco + download do arquivo) com um mecanismo só, em vez de um timeout por
// etapa que sempre deixa uma etapa nova sem cobertura.
//
// CUSTO DECLARADO: a promessa perdedora continua correndo até o fim e o
// resultado dela é descartado. É aceitável aqui porque ela não escreve nada —
// é leitura pura. Um `AbortController` cancela o fetch de verdade e está posto
// no download; o prazo global existe para o que o AbortController não alcança,
// que é a consulta ao Postgres.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";

/**
 * Bucket PRIVADO das artes — privado por decisão de coordenação, porque arte
 * rejeitada não pode ficar servível por URL direta. Ver POR QUE ASSINADA, abaixo.
 */
export const BUCKET_ARTES = "farol-artes";

/**
 * Prazo TOTAL. Acima disso o card sai sem arte, e sai na hora.
 * 2,5s é folgado para um GET de storage na mesma região e curto o bastante para
 * não aproximar o timeout do servidor da Meta, que é quem espera este render.
 */
export const PRAZO_MS = 2500;

/**
 * Validade da URL assinada, em segundos. 60s é MUITO mais do que o necessário —
 * quem consome a URL é o `fetch` da linha de baixo, dentro dos mesmos 2,5s — e é
 * curto o bastante para que uma URL que vaze em log não sirva a ninguém depois.
 * Não vale reduzir para perto de PRAZO_MS: relógio de container fora de sincronia
 * transformaria a assinatura em fonte nova de card sem arte.
 */
export const VALIDADE_URL_S = 60;

/**
 * Teto de bytes do arquivo. Uma arte de 1152×2048 em PNG fica na casa de 2–4 MB.
 * O teto existe porque o arquivo vira base64 na memória do render (+33%), e um
 * arquivo trocado por engano — um vídeo, um PSD — derrubaria o container por
 * memória em vez de cair no fallback. Estourar o teto é `null`, como tudo mais.
 */
export const TETO_BYTES = 8 * 1024 * 1024;

/**
 * O VÉU. Navy #0A0E1A a 78%, exatamente como a ordem mandou.
 *
 * ELE NÃO É ESTILO — É O QUE TORNA A FATIA SEGURA E O QUE SUSTENTA A ESCOLHA DE
 * QUALIDADE. Sobram 22% da arte, o suficiente para dar matéria e profundidade
 * ao fundo, e insuficiente para que qualquer coisa que o modelo tenha desenhado
 * por engano — uma forma parecida com letra, um resto de marca d'água — compita
 * com os números que o gerador determinístico escreve por cima. O contraste do
 * texto branco sobre este véu continua o mesmo do card navy chapado de hoje.
 *
 * CONDIÇÃO DE REABERTURA (registrada por ordem expressa, e repetida na migração
 * 0076): a qualidade `medium` foi escolhida PORQUE este véu apaga o detalhe fino
 * que `high` compra. Se algum uso futuro exibir a arte SEM véu — capa de
 * carrossel, thumb de YouTube, banner —, a decisão de qualidade se REABRE para
 * aquele uso. Quem mexer neste valor está mexendo naquela decisão junto.
 */
export const VEU_NAVY = "rgba(10, 14, 26, 0.78)";

export type Arte = {
  id: string;
  /** data URI pronto para o satori. Ver POR QUE DATA URI, abaixo. */
  fonte: string;
  largura: number;
  altura: number;
};

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dimensão máxima aceita por lado. Ver `dimensaoSa` abaixo. */
const LADO_MAX = 8000;

/**
 * ASSINATURAS DE ARQUIVO. O `content-type` da resposta NÃO é evidência: o
 * storage devolve o que foi declarado no upload, e um .png declarado que na
 * verdade é lixo passa por ele sem reclamar. Os bytes iniciais são o único
 * teste que responde "isto é mesmo uma imagem".
 *
 * É este bloco que cumpre o "arquivo corrompido" da ordem. Sem ele, o lixo
 * chegaria ao satori como data URI e estouraria DENTRO do render — que é a
 * cicatriz já documentada em renderKit: o erro não vira 500, vira conexão vazia
 * (`curl: (52) Empty reply from server`). Ou seja: sem esta checagem, o modo de
 * falha mais provável da fatia seria também o mais difícil de diagnosticar.
 */
// EXPORTADO SÓ PARA O TESTE, e declarado como tal: é o guarda do "arquivo
// corrompido" da ordem, e testá-lo por dentro é a única forma de exercitá-lo sem
// rede e sem custo. Nenhuma rota deve chamá-lo.
export function tipoPelaAssinatura(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // WEBP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Dimensão precisa ser inteiro positivo e plausível — 0 ou lixo quebra o recorte. */
function dimensaoSa(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= LADO_MAX;
}

/**
 * Um `console.warn` por desistência, com MOTIVO NOMEADO. Não é ruído: quando o
 * perfil amanhecer com card sem arte, esta linha é a diferença entre "descobrir
 * em 10 segundos" e "abrir o banco procurando". O nível é `warn` e não `error`
 * de propósito — nada quebrou, o card saiu.
 */
function desistir(motivo: string, id?: string): null {
  console.warn(`[farol-arte] sem arte (${motivo})${id ? ` id=${id}` : ""}`);
  return null;
}

/**
 * Busca a arte APROVADA de id `id`, pronta para o render.
 *
 * Devolve `null` — e o chamador renderiza o card de hoje, idêntico — quando:
 *   · não veio id (o caso comum: card sem `?arte=`; não loga, não é anomalia);
 *   · o id não é uuid                       → nem toca o banco;
 *   · não existe linha, ou ela não está `aprovada`;
 *   · largura/altura ausentes ou implausíveis;
 *   · o download falha, devolve não-2xx, ou estoura o teto de bytes;
 *   · os bytes não são de uma imagem reconhecível;
 *   · o trajeto inteiro passa de PRAZO_MS.
 *
 * ----------------------------------------------------------------------------
 * O `preview`, E POR QUE ELE É UM PARÂMETRO E NÃO UM ENV
 * ----------------------------------------------------------------------------
 * Existia uma circularidade: o card serve para JULGAR a arte, mas a arte só
 * entrava no card depois de julgada. `preview: true` ignora o filtro de status
 * — e só isso; todos os outros guardas continuam de pé.
 *
 * Quem pode ligar: SÓ o painel de curadoria, em sessão admin. O caminho de
 * publicação (post diário, carrossel, reel) chama `buscarArte(id)` sem segundo
 * argumento e portanto NUNCA vê arte não aprovada. Isso não é convenção: o
 * padrão do parâmetro é `false`, então esquecer de passar cai no lado seguro, e
 * há teste travando que o caminho de publicação não passa `preview`.
 *
 * Um env não serviria: seria global e mudaria o comportamento de TODO card do
 * processo, inclusive o do post do dia. Parâmetro é por chamada, que é a
 * granularidade certa para uma exceção de curadoria.
 */
export async function buscarArte(
  id: string | null | undefined,
  opcoes?: { preview?: boolean }
): Promise<Arte | null> {
  // Sem id não há o que buscar. Silencioso de propósito: este é o caminho
  // NORMAL de todo card que não pediu arte, e logar aqui encheria o log de
  // "sem arte" em requisição que nunca quis arte.
  if (!id) return null;

  if (!RE_UUID.test(id)) return desistir("id_nao_uuid");

  const preview = opcoes?.preview === true;

  let prazo: ReturnType<typeof setTimeout> | undefined;
  try {
    const corrida = await Promise.race([
      carregar(id, preview),
      new Promise<"prazo">((resolve) => {
        prazo = setTimeout(() => resolve("prazo"), PRAZO_MS);
      }),
    ]);
    if (corrida === "prazo") return desistir("prazo_estourado", id);
    return corrida;
  } catch (e) {
    // Rede de segurança final. Se algo escapou dos guardas de `carregar`, ele
    // morre AQUI e não no render. Este catch nunca deveria disparar — se
    // disparar, o log diz o quê.
    return desistir(
      `excecao:${e instanceof Error ? e.message : "desconhecida"}`,
      id
    );
  } finally {
    if (prazo) clearTimeout(prazo);
  }
}

async function carregar(id: string, preview: boolean): Promise<Arte | null> {
  // ---- A linha ------------------------------------------------------------
  // `status = 'aprovada'` NO WHERE, e não conferido depois em JavaScript: assim
  // não existe caminho de código — nem futuro, nem por descuido de refatoração —
  // em que uma arte pendente ou rejeitada seja servida. A curadoria é uma
  // cláusula da consulta, não uma boa intenção do chamador.
  //
  // A ÚNICA exceção é `preview`, e ela segue sendo cláusula de consulta: em vez
  // de conferir status depois, o filtro simplesmente não é acrescentado. Assim
  // continua não existindo caminho em que alguém "esqueça de checar".
  //
  // Colunas UMA A UMA, nunca `select('*')`: doutrina da casa para leitura com
  // service_role.
  const db = createXtvClient();
  let consulta = db
    .from("farol_arte")
    .select("id, caminho, largura, altura")
    .eq("id", id);
  if (!preview) consulta = consulta.eq("status", "aprovada");
  const { data, error } = await consulta.maybeSingle();

  if (error) return desistir(`banco:${error.message}`, id);
  if (!data) {
    return desistir(preview ? "inexistente" : "nao_aprovada_ou_inexistente", id);
  }

  const caminho = typeof data.caminho === "string" ? data.caminho : "";
  if (!caminho) return desistir("caminho_vazio", id);
  if (!dimensaoSa(data.largura) || !dimensaoSa(data.altura)) {
    return desistir("dimensao_implausivel", id);
  }

  // ---- O arquivo ----------------------------------------------------------
  // POR QUE ASSINADA, e não `getPublicUrl` — CORRIGIDO EM 10/08/2026.
  //
  // O comentário que morava aqui afirmava que o bucket era público e defendia
  // `getPublicUrl` por economia de prazo. Era falso: `farol-artes` nasceu
  // PRIVADO, e privado por decisão de coordenação — arte REJEITADA não pode
  // ficar servível por URL direta a quem souber o caminho. O código pedia URL
  // pública a um bucket privado, recebia uma URL que responde 400, e caía em
  // `desistir("http_400")`. Como a queda é o caminho bem-comportado da fatia, o
  // card saía sem arte EM SILÊNCIO: nenhuma arte aparecia em card nenhum, para
  // ninguém, e nada acusava.
  //
  // Lição registrada: comentário que descreve infraestrutura envelhece mal e
  // não é verificado por teste nenhum. Este aqui afirmava o oposto do real.
  //
  // O custo é uma ida a mais ao Supabase dentro dos 2,5s. Ele cabe: a assinatura
  // é uma chamada de metadado, e o download que vem depois é que é o caro. Se um
  // dia o prazo apertar, o lugar de mexer é PRAZO_MS, não a privacidade.
  //
  // Validade CURTA de propósito: a URL só precisa viver o suficiente para este
  // mesmo processo baixar os bytes, logo abaixo. Ela nunca vai para o HTML, para
  // o card ou para o cliente — o que sai daqui são os BYTES, viram data URI no
  // render. Uma URL que vazasse de um log morre em VALIDADE_URL_S segundos.
  const { data: assinada, error: erroUrl } = await db.storage
    .from(BUCKET_ARTES)
    .createSignedUrl(caminho, VALIDADE_URL_S);
  if (erroUrl) return desistir(`assinatura:${erroUrl.message}`, id);
  const url = assinada?.signedUrl;
  if (!url) return desistir("sem_url_assinada", id);

  // AbortController além do prazo global: ele CANCELA a conexão de verdade, em
  // vez de só deixá-la órfã. É o que evita um bucket lento segurar socket do
  // container depois que o card já saiu sem arte.
  const freio = new AbortController();
  const corta = setTimeout(() => freio.abort(), PRAZO_MS);
  let bytes: ArrayBuffer;
  try {
    const r = await fetch(url, { signal: freio.signal, cache: "no-store" });
    if (!r.ok) return desistir(`http_${r.status}`, id);

    // Teto conferido pelo header ANTES de ler o corpo, quando ele existe: é a
    // diferença entre recusar um arquivo gigante de graça e baixá-lo inteiro
    // para só então recusá-lo.
    const declarado = Number(r.headers.get("content-length") ?? "0");
    if (declarado > TETO_BYTES) return desistir(`grande_demais:${declarado}`, id);

    bytes = await r.arrayBuffer();
  } catch (e) {
    // `AbortError` cai aqui quando o prazo local vence antes do global.
    return desistir(
      `download:${e instanceof Error ? e.name : "desconhecido"}`,
      id
    );
  } finally {
    clearTimeout(corta);
  }

  // Segunda conferência de tamanho: `content-length` pode não vir, e resposta
  // com `transfer-encoding: chunked` não declara tamanho nenhum.
  if (bytes.byteLength === 0) return desistir("arquivo_vazio", id);
  if (bytes.byteLength > TETO_BYTES) {
    return desistir(`grande_demais:${bytes.byteLength}`, id);
  }

  const vista = new Uint8Array(bytes);
  const tipo = tipoPelaAssinatura(vista);
  if (!tipo) return desistir("nao_e_imagem", id);

  // POR QUE DATA URI E NÃO A URL DIRETO NO `<img src>`: se o satori buscar a
  // imagem sozinho, a falha dele acontece DENTRO do render — e render que falha
  // no meio do stream não vira 500, vira conexão vazia (a cicatriz de
  // renderKit). Trazendo os bytes aqui, toda falha de rede vira `null` ANTES de
  // o render começar, que é a única forma de o fallback ser um caminho normal
  // em vez de uma exceção capturada por sorte.
  const fonte = `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;

  return { id, fonte, largura: data.largura, altura: data.altura };
}

/**
 * RECORTE CENTRAL — a aritmética que faz UMA arte servir os dois formatos.
 *
 * Decisão de 09/08/2026: gerar em 1152×2048 e recortar o centro para o quadrado,
 * "metade do custo, e o feed e o story passam a ser visivelmente a MESMA peça do
 * dia — coerência de marca, não economia".
 *
 * Equivale ao `object-fit: cover` do CSS, escrito à mão de propósito: o suporte
 * do satori a `object-fit` é parcial, e aqui não pode haver dúvida — arte
 * esticada num dos eixos é pior do que arte nenhuma. Com número explícito, o
 * resultado é conferível numa tabela em vez de depender do renderizador.
 *
 * CONFERÊNCIA (é a que o teste repete):
 *   arte 1152×2048 em canvas 1080×1920 → escala 0,9375 → 1080×1920, offset 0/0
 *     — redução pura, sem recorte, que é a razão de 1152×2048 ter sido escolhido.
 *   arte 1152×2048 em canvas 1080×1080 → escala 0,9375 → 1080×1920, offset 0/−420
 *     — sobra 840px de altura, 420 cortados de cada ponta: o centro fica no centro.
 *
 * `Math.max` das duas escalas é o que garante COBRIR o canvas (nunca deixar
 * tarja); `Math.round` evita subpixel, que no satori vira borda de 1px.
 */
export function recorteCentral(
  arte: { largura: number; altura: number },
  canvasLargura: number,
  canvasAltura: number
): { largura: number; altura: number; esquerda: number; topo: number } {
  const escala = Math.max(
    canvasLargura / arte.largura,
    canvasAltura / arte.altura
  );
  const largura = Math.round(arte.largura * escala);
  const altura = Math.round(arte.altura * escala);
  return {
    largura,
    altura,
    esquerda: Math.round((canvasLargura - largura) / 2),
    topo: Math.round((canvasAltura - altura) / 2),
  };
}

// ---------------------------------------------------------------------------
// A ESCADA DE RENDER — o degrau que faltava
// ---------------------------------------------------------------------------
// POR QUE ISTO NASCEU EM 10/08/2026, e por que é o mesmo assunto do cabeçalho.
//
// A ordem de 09/08 mandava que "arquivo corrompido" caísse no card de hoje, e
// `buscarArte` cumpre isso até onde alcança: fareja a assinatura dos bytes e
// devolve `null` para o que não é imagem. Só que assinatura válida não é
// imagem íntegra. Um PNG com cabeçalho bom e corpo truncado PASSA por todos os
// guardas daqui, vira data URI, e só quebra quando o satori tenta DECODIFICAR
// — dentro do render, que é o único lugar que este módulo não alcança.
//
// Este módulo até declara essa ambição, logo acima do data URI: trazer os
// bytes para cá faria "toda falha virar null ANTES de o render começar, que é
// a única forma de o fallback ser um caminho normal em vez de uma exceção
// capturada por sorte". A ambição está certa e o buraco é real: falha de
// DECODIFICAÇÃO não tem como acontecer antes do render. Quem fecha é a escada.
//
// O DEFEITO CONCRETO QUE ISTO CONSERTA, em card-image/[id]: o `renderKit`
// tinha dois degraus, e os dois carregavam a MESMA arte. Ele só sabia desistir
// das FONTES. Então, com uma arte que não decodifica: o 1º degrau estourava, o
// `catch` culpava as fontes e jogava fora o cache delas, e o 2º degrau
// re-renderizava a mesma arte envenenada — dessa vez em STREAM, sem `catch`
// possível. Render que morre no meio do stream não vira 500: vira conexão
// vazia. E conexão vazia é exatamente o que faz o servidor da Meta responder
// "não consegui buscar a mídia nesta URI".
//
// POR QUE A ARTE CAI ANTES DAS FONTES. O `catch` do 1º degrau não sabe dizer
// se quem quebrou foi a fonte ou a arte — chega a mesma exceção. Então a ordem
// não pode ser adivinhação, tem que ser a que sobrevive aos DOIS casos. Se
// derrubássemos a fonte primeiro, o degrau seguinte ainda levaria a arte
// quebrada e ainda seria o último — ou seja, o caso "arte ruim" voltaria a
// morrer em stream. Derrubando a arte primeiro, o caso "fonte ruim" apenas
// gasta um degrau a mais e chega inteiro no último. Uma ordem serve aos dois;
// a outra serve a um só.
//
// A INVARIANTE, e é ela que o teste crava: o ÚLTIMO degrau nunca leva arte e
// nunca leva fonte. É o único que renderiza em stream, sem rede de segurança,
// e por isso tem que ser o mais pobre e o mais provável de dar certo — o card
// navy chapado, idêntico ao que existia antes de a arte existir. Enfeite não
// derruba produto.

/** Um degrau da escada: o que ele ainda se permite carregar. */
export type Degrau = {
  /** Usa as fontes do kit? `false` = stack padrão do renderizador. */
  fontes: boolean;
  /** Leva a arte do acervo? `false` = card navy chapado. */
  arte: boolean;
};

/**
 * A ordem das tentativas de render, da mais rica para a mais pobre.
 *
 * Sempre termina em `{ fontes: false, arte: false }` — inclusive quando não há
 * arte nem fonte para começo de conversa, caso em que a escada tem UM degrau só
 * e o comportamento é exatamente o de antes desta fatia.
 *
 * Não gera degrau inútil: sem arte, não existe degrau "sem arte" intermediário.
 */
export function degrausDeRender(temArte: boolean, temFontes: boolean): Degrau[] {
  const degraus: Degrau[] = [];
  if (temFontes && temArte) degraus.push({ fontes: true, arte: true });
  if (temFontes) degraus.push({ fontes: true, arte: false });
  if (!temFontes && temArte) degraus.push({ fontes: false, arte: true });
  degraus.push({ fontes: false, arte: false });
  return degraus;
}
