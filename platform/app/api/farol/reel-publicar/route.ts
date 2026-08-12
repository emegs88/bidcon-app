// ============================================================================
// FAROL-REEL-01 · rota 3 — GET /api/farol/reel-publicar · FASE 2 (publica)
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-REEL-01", 06/08/2026:
// "cron 15:00 UTC, mesmo guard; renders pendentes <=24h -> status no HeyGen ->
//  completed: container media_type=REELS com video_url + legenda curta (números
//  + hashtags) passando pelo revisarLegenda() existente -> polling CURTO do
//  container (máx 40s, passo 5s) -> FINISHED: media_publish -> grava post_id.
//  Ainda processando -> próximo ciclo. IDEMPOTENTE: nunca duplicar (checar por
//  video_id antes de criar container; guardar container_id pra retomar)."
// NASCE DESARMADA: sem FAROL_REEL=on, esta rota não fala com ninguém.
// ----------------------------------------------------------------------------
// A IDEMPOTÊNCIA AQUI NÃO É "LEMBRAR DE CHECAR" — É ESTRUTURAL, em três camadas,
// porque a falha que essa rota tem que impedir é a pior de todas: DOIS reels
// iguais no perfil público, que ninguém consegue desfazer sem apagar post.
//
//   (1) `farol_reels.video_id` é UNIQUE no banco. Dois renders não podem virar
//       duas linhas para o mesmo vídeo, nem que a fase 1 rode duas vezes.
//   (2) A LINHA É RECLAMADA COM UPDATE CONDICIONAL antes de qualquer chamada à
//       Meta: `update ... where id=? and status=<o que eu li>`. No Postgres isso
//       é atômico. Duas invocações que leem a mesma linha ao mesmo tempo: uma
//       reclama, a outra recebe zero linhas e PULA. Sem isso, o "checar antes"
//       seria só uma janela de corrida mais estreita, não uma trava.
//   (3) `container_id` é gravado ANTES do media_publish. Se a invocação morrer
//       entre criar o container e publicar, a próxima RETOMA aquele container
//       em vez de criar um segundo — o `if (linha.container_id)` lá embaixo é
//       literalmente esse caminho.
//
// ---------------------------------------------------------------------------
// GET NO CONTAINER: POR QUE UM HELPER LOCAL E NÃO `chamarGraph`. Medi a lib:
// `chamarGraph` de lib/instagram/publicar.ts é POST e monta SEMPRE a URL como
// `<IG_USER_ID>/<caminho>`. O status do container é um GET em `<container_id>`
// — outro verbo e outro sujeito. Mudar a assinatura dela mexeria numa função
// que está em produção publicando no feed, e a OS manda REUSAR, não alterar.
// Então o GET mora aqui, no único lugar que precisa dele, com as MESMAS envs,
// a mesma versão da Graph e o mesmo formato de erro literal. Os dois POSTs
// (media e media_publish) continuam saindo pela lib compartilhada, sem cópia.
//
// POLLING COM ORÇAMENTO. A rota só ENTRA no caminho de container se ainda
// houver tempo de invocação sobrando (`ORCAMENTO_MS`): começar um polling aos
// 50s de execução é como garantir o timeout. Estourou o orçamento, a linha fica
// 'publicando' e o ciclo seguinte retoma — que é exatamente o desenho de (3).
//
// FASE2-B/C (09/08/2026) — A CADÊNCIA E A DESISTÊNCIA MUDARAM. A OS original
// pedia "máx 40s, passo 5s". Isso foi SUBSTITUÍDO por ordem do Emerson, depois
// de ele RETIRAR a OS FASE2-CALLBACK ("o mecanismo não existe e você provou que
// não resolveria" — a Meta não publica webhook, callback nem campo de
// notificação para status de container; medido em quatro superfícies da doc).
// O que entrou no lugar:
//   B · pedir `copyright_check_status` no fields e LOGAR os quatro literais A
//       CADA consulta — era o único canal de diagnóstico documentado que estava
//       fechado por escolha nossa;
//   C · 1 consulta por minuto, no máximo ~5 por container, e DERROTA aos 15min
//       em vez das 24h da janela. "Se em 15 min não andou, é melhor falhar e
//       reagendar do que segurar um dia."
// Os números e a decisão moram em lib/farol/container.ts, sob teste. Aqui só
// mora o I/O. O que motivou: três dias, três containers — 07/08 publicou 6h40
// depois, 08/08 expirou em 24h, 09/08 preso desde 12h50 — com o mp4 periciado e
// impecável. Mil GETs num container que a Meta manda abandonar em cinco minutos
// é o oposto de diagnóstico.
//
// UMA PUBLICAÇÃO POR INVOCAÇÃO. Checar status de vídeo é barato e roda para
// várias linhas; publicar é caro e para na primeira. Dois reels publicados no
// mesmo minuto seria pior do que um reel publicado meia hora depois.
//
// A JANELA DE 24h NÃO É ESTÉTICA: o container de mídia da Meta expira em 24h, e
// um reel de ontem publicado hoje anuncia número que pode não existir mais.
// Passou de 24h sem publicar, a linha é encerrada como 'falhou' com o motivo
// literal, em vez de ficar sendo varrida para sempre.
//
// O REEL PUBLICADO TAMBÉM VAI PARA `farol_posts` com acao='reel_publicado' —
// é o que mantém "o que o FAROL fez ontem?" numa consulta só, e é o que faz a
// memória antirrepetição da fase 1 enxergar os reels.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { autorizadoFarol, revisarLegenda, registrar } from "@/lib/farol/selecao";
import { chamarGraph } from "@/lib/instagram/publicar";
import { enviarBytesResumable } from "@/lib/instagram/rupload";
import { statusVideo, tituloRender } from "@/lib/heygen";
import { subirShort } from "@/lib/youtube/upload";
import { publicarVideo } from "@/lib/tiktok/upload";
import { reais, pctAoMes } from "@/lib/carrossel-formato";
import { LABEL_TIPO_BEM } from "@/lib/status";
import {
  CAMPOS_CONTAINER,
  DERROTA_MS,
  POLL_MAX_MS,
  POLL_PASSO_MS,
  decidirDerrota,
  idadeContainerMs,
  motivoDerrota,
  resumoContainer,
  type ResumoContainer,
} from "@/lib/farol/container";
import { lerContainerGraph } from "@/lib/instagram/ler-container";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * 180s, e não os 60 de antes: o caminho caro agora é orçamento (45s) + download
 * do mp4 (45s) + upload pro bucket (~20s) + polling do container (40s) = 150s de
 * pior caso. 60s garantiria timeout no meio do upload — e um upload cortado ao
 * meio é a única forma de esta rota gravar uma URL que não toca.
 */
export const maxDuration = 180;

// A versão da Graph saiu daqui na DIAG-CONTAINER-02: quem monta a URL agora é
// lib/instagram/ler-container.ts, e uma constante repetida em três arquivos é
// uma divergência esperando a próxima migração de versão.
const TIMEOUT_IG_MS = 15_000;

// A cadência (POLL_PASSO_MS), o teto por invocação (POLL_MAX_MS) e o limiar de
// derrota (DERROTA_MS) moram em lib/farol/container.ts, sob teste — ver o
// bloco FASE2-B/C no cabeçalho. Ficavam aqui como 40s/5s.

/**
 * Só entra no caminho caro se ainda couber o trabalho inteiro com folga. Subiu
 * de 12s para 45s junto com o maxDuration: o caminho caro deixou de ser "um
 * POST + polling" e passou a incluir baixar e subir dezenas de MB.
 */
const ORCAMENTO_MS = 45_000;

/** Bucket público do xtv onde o mp4 do reel passa a morar. */
const BUCKET_VIDEOS = "farol-videos";

/**
 * Teto defensivo: reel de ~31s em 1080p dá 10–25MB. Acima disto é bug, não vídeo.
 *
 * ERA 80MB e isso QUEBROU o primeiro tique (20:10:08 de 07/08): o valor ia
 * também como `fileSizeLimit` do bucket, e o projeto tem um limite GLOBAL de
 * upload menor que isso — o `createBucket` inteiro voltou
 * "The object exceeded the maximum allowed size" e o bucket nunca nasceu.
 * 45MB fica sob qualquer teto global de projeto e ainda dá ~2x de folga sobre o
 * maior reel plausível. O limite agora vive SÓ aqui, no código (ver garantirBucket).
 */
const TETO_VIDEO_BYTES = 45 * 1024 * 1024;

/** Timeout do download do mp4 no HeyGen. Ver a conta no maxDuration. */
const TIMEOUT_VIDEO_MS = 45_000;

/** Container da Meta expira em 24h — ver header. */
const JANELA_HORAS = 24;

/** Quantas linhas pendentes olhar por invocação (checagem de status é barata). */
const LIMITE_LINHAS = 5;

// OS DOIS LIMIARES DE ZUMBI FORAM REMOVIDOS PELA FASE2-C, e o motivo fica
// escrito porque apagar constante sem dizer por quê é como esconder decisão:
//   · IDADE_ZUMBI_HOSPEDADO_MS (60 min) virou INALCANÇÁVEL. A derrota chega aos
//     15 min e tira a linha de 'publicando', então nenhum container hospedado
//     sobrevive até os 60. Deixar a constante ali seria deixar escrito um
//     caminho que nunca mais roda — código morto que se lê como regra viva.
//   · IDADE_ZUMBI_MS (20 min) nunca foi lido de verdade: o único chamador que
//     restou é o container LEGADO, e ele já entrava com `ignorarIdade = true`.
//     Medi antes de apagar; era um número que ninguém consultava.
// O `checarZumbi` continua existindo, só que agora exclusivamente para o legado
// — ver o comentário na retomada.

/**
 * Idade a partir da qual uma linha ainda 'renderizando' vira suspeita de estar
 * presa num id fantasma — e o `statusVideo` passa a tentar TAMBÉM o resgate por
 * título. Nome próprio, e não reuso do IDADE_ZUMBI_MS: aquele mede container da
 * Meta, este mede render do HeyGen. Coincidirem em 20 min hoje é coincidência
 * de grandeza, não parentesco — amarrá-los faria um ajuste num mexer no outro.
 *
 * 20 min é folgado: o reel de ~31s renderiza em poucos minutos e o ciclo é de
 * 10 min, então um render saudável entrega antes de chegar aqui. O caso que
 * motivou o limiar passou de TRÊS HORAS lendo "renderizando" com o vídeo pronto
 * no painel (08/08, 11h48).
 */
const IDADE_ESTAGNADA_MS = 20 * 60 * 1000;

// CAMPOS_CONTAINER agora vem da lib e inclui `copyright_check_status` (item B).

type LinhaReel = {
  id: string;
  carta_id: string | null;
  video_id: string;
  container_id: string | null;
  status: string;
  legenda: string | null;
  detalhe: Record<string, unknown> | null;
  criado_em: string;
  atualizado_em: string | null;
};

/**
 * GET no container da Meta.
 *
 * ----------------------------------------------------------------------------
 * DIAG-CONTAINER-02: o corpo desta função MUDOU DE ENDEREÇO, o contrato NÃO.
 * ----------------------------------------------------------------------------
 * A lógica (escada de campos, erro literal, timeout) agora é
 * `lerContainerGraph`, em lib/instagram/ler-container.ts, porque existiam DUAS
 * cópias dela na casa — esta e uma na rota do diag — e a segunda foi escrita
 * copiando a string de campos e esquecendo a escada. Em 11/08/2026 a Graph
 * recusou o conjunto com `code=100`, a cópia sem escada devolveu `null` e um
 * diagnóstico foi impresso como conclusivo em cima de duas requisições
 * rejeitadas. Enquanto houver dois leitores, o conserto de um não alcança o
 * outro.
 *
 * O QUE NÃO MUDOU, DE PROPÓSITO:
 *  · a forma `LeituraContainer` — os dois chamadores (`esperarContainer` e o
 *    laço da fase 2) seguem intocados. Este é o caminho que PUBLICA de verdade,
 *    de 10 em 10 min; refatorar leitura não é motivo para mexer nele.
 *  · `TIMEOUT_IG_MS` (15 s), que aqui é MENOR que os 20 s do diag. Passa por
 *    parâmetro. Uma unificação silenciosa mudaria a paciência da produção por
 *    causa de uma tela de diagnóstico, e ninguém pediu isso.
 *  · `code: "DESCONHECIDO"` quando a resposta vem 200 sem `status_code` — é o
 *    rótulo que o resto deste arquivo já sabe ler.
 */
type LeituraContainer =
  | { ok: true; code: string; bruto: unknown }
  | { ok: false; erro: string; bruto: unknown };

async function statusContainer(
  containerId: string,
  campos: string = CAMPOS_CONTAINER
): Promise<LeituraContainer> {
  const l = await lerContainerGraph(containerId, {
    campos,
    timeoutMs: TIMEOUT_IG_MS,
  });
  if (!l.ok) return { ok: false, erro: l.erro, bruto: l.bruto };
  return {
    ok: true,
    code: String(l.resumo.status_code ?? "DESCONHECIDO"),
    bruto: l.bruto,
  };
}

const db_ = () => createXtvClient();
type Db = ReturnType<typeof db_>;

/** Toda escrita na fila passa por aqui, para `atualizado_em` nunca ser esquecido. */
async function atualizar(
  db: Db,
  id: string,
  campos: Record<string, unknown>
): Promise<void> {
  const { error } = await db
    .from("farol_reels")
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[farol-reel] falha atualizando farol_reels:", error.message);
}

/**
 * Cria o bucket se ainda não existir. Idempotente de propósito: "já existe" é
 * SUCESSO, não erro — a rota roda a cada 10 min e não pode depender de alguém
 * ter clicado no painel do Supabase antes.
 */
async function garantirBucket(db: Db): Promise<void> {
  // SÓ `public: true`, de propósito — mesmo formato do único bucket que a casa
  // já tem (`wa-extratos`, medido: file_size_limit e allowed_mime_types nulos).
  // Passar `fileSizeLimit` maior que o teto global do projeto faz o createBucket
  // falhar por inteiro, que foi exatamente o que derrubou o tique das 20:10.
  // O teto de tamanho e o tipo do arquivo já são garantidos aqui no código
  // (TETO_VIDEO_BYTES antes do upload, contentType fixo em video/mp4) — repetir
  // isso na config do bucket não comprava segurança nova e custou uma rodada.
  const { error } = await db.storage.createBucket(BUCKET_VIDEOS, { public: true });
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`bucket_falhou: ${error.message}`);
  }
}

/**
 * Baixa o mp4 do HeyGen e o guarda em casa, devolvendo a URL pública.
 *
 * POR QUE ISTO EXISTE — medido em produção hoje, não suposto: a URL do HeyGen é
 * presignada e expira, e a Meta DEDUPLICA a criação do container pelo objeto —
 * a mesma video_url devolveu sempre o MESMO container_id (17878184478684841),
 * estacionado em IN_PROGRESS por mais de uma hora. Com a URL de terceiro, o
 * container zumbi era imortal: a autocura resetava, pedia outro, e a Meta
 * devolvia o mesmo. Hospedar mata os três problemas de uma vez — a URL fica
 * estável, é rápida (mesma região do banco) e é NOVA a cada objeto, então o
 * dedupe da Meta não tem em que se agarrar.
 *
 * BENEFÍCIO LATERAL, registrado a pedido da coordenação: este mp4 é o asset
 * oficial para repost manual no TikTok enquanto a auditoria deles não sai. Ele
 * não é subproduto do Instagram — é o arquivo, e mora num endereço estável.
 *
 * Nunca lança para o laço: devolve erro literal, e o chamador decide.
 */
async function hospedarVideo(
  db: Db,
  videoId: string,
  videoUrl: string
): Promise<{ ok: true; url: string; bytes: Uint8Array<ArrayBuffer> } | { ok: false; erro: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_VIDEO_MS);
  try {
    await garantirBucket(db);

    const resp = await fetch(videoUrl, { signal: ctrl.signal });
    if (!resp.ok) return { ok: false, erro: `download_http_${resp.status}` };

    const bytes = new Uint8Array(await resp.arrayBuffer());
    // Zero byte é o modo silencioso de falhar de URL expirada: 200 com corpo
    // vazio. Subir isso publicaria um reel quebrado no perfil público.
    if (bytes.byteLength === 0) return { ok: false, erro: "download_vazio" };
    if (bytes.byteLength > TETO_VIDEO_BYTES) {
      return { ok: false, erro: `download_grande(${bytes.byteLength}b)` };
    }

    // `upsert` + nome derivado do video_id = idempotência do objeto: rodar duas
    // vezes reescreve o mesmo arquivo, nunca cria um segundo.
    const path = `${videoId}.mp4`;
    const up = await db.storage.from(BUCKET_VIDEOS).upload(path, bytes, {
      contentType: "video/mp4",
      upsert: true,
    });
    if (up.error) return { ok: false, erro: `upload_falhou: ${up.error.message}` };

    const { data } = db.storage.from(BUCKET_VIDEOS).getPublicUrl(path);
    if (!data?.publicUrl) return { ok: false, erro: "sem_url_publica" };

    console.log("[farol-reel] vídeo hospedado:", {
      video_id: videoId,
      bytes: bytes.byteLength,
      url: data.publicUrl,
    });
    // DEVOLVE OS BYTES JUNTO (FASE2-A). Eles já estão em memória aqui — o
    // `arrayBuffer()` acima os materializou por inteiro para poder subir ao
    // bucket. Devolvê-los não acrescenta um único byte de teto; o que ele
    // evita é o caminho resumable ter que BAIXAR DE NOVO o mp4 que acabou de
    // passar por esta função. Sem isto, ligar o resumable dobraria o tráfego e
    // o tempo desta rota sem melhorar nada.
    return { ok: true, url: data.publicUrl, bytes };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_download(${TIMEOUT_VIDEO_MS}ms)` };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 300) : "erro_desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rebaixa o mp4 do NOSSO bucket para a memória, quando o caminho resumable
 * precisa dos bytes e esta invocação não foi a que hospedou.
 *
 * POR QUE ISTO EXISTE E POR QUE É BARATO: a hospedagem é idempotente por
 * video_id, então uma invocação que retoma uma linha já hospedada não tem o
 * buffer em memória — ele morreu com a lambda anterior. Baixar do HeyGen de
 * novo estaria fora de questão (URL presignada, pode ter expirado); baixar do
 * nosso bucket é a mesma região do banco e não custa o teto de tempo do
 * download original.
 *
 * Devolve null em vez de lançar: quem chama já tem um ramo de falha nomeado.
 * O teto de bytes é o MESMO da hospedagem — não há caminho por onde entrar em
 * memória mais do que TETO_VIDEO_BYTES.
 */
async function rebaixarHospedado(url: string | null): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_VIDEO_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) {
      console.error("[farol-reel] rebaixar hospedado falhou:", { url, status: resp.status });
      return null;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > TETO_VIDEO_BYTES) {
      console.error("[farol-reel] rebaixar hospedado tamanho inválido:", {
        url,
        bytes: bytes.byteLength,
      });
      return null;
    }
    return bytes;
  } catch (e) {
    console.error("[farol-reel] rebaixar hospedado erro:", {
      url,
      erro: e instanceof Error ? e.message.slice(0, 200) : "desconhecido",
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reclama a linha com UPDATE CONDICIONAL — a trava (2) do header.
 * Devolve false quando outra invocação chegou primeiro.
 */
async function reclamar(db: Db, linha: LinhaReel): Promise<boolean> {
  const { data, error } = await db
    .from("farol_reels")
    .update({ status: "publicando", atualizado_em: new Date().toISOString() })
    .eq("id", linha.id)
    .eq("status", linha.status)
    .select("id");
  if (error) {
    console.error("[farol-reel] falha reclamando linha:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Espera o container ficar FINISHED. Devolve o veredito ou 'demorou' — que NÃO
 * é falha aqui dentro: é "quem chama decide", e quem chama agora tem a régua de
 * derrota (FASE2-C). Este laço não olha idade e não escreve no banco.
 *
 * `tetoMs` é o teto DESTA invocação, não do container. Entra por parâmetro
 * porque o chamador sabe quanto tempo de invocação ainda sobra e este laço não.
 *
 * GARANTIA DE UMA LEITURA: mesmo com `tetoMs = 0` o laço lê UMA vez antes de
 * sair. É o que permite ao chamador pedir "só me dá o estado atual" para
 * declarar derrota com dado fresco, sem gastar um minuto de sono para isso — e
 * sem precisar de uma segunda função que chamasse a Meta de outro jeito.
 */
async function esperarContainer(
  containerId: string,
  tetoMs: number = POLL_MAX_MS
): Promise<
  | { fim: "pronto" }
  | { fim: "falhou"; erro: string }
  | { fim: "demorou"; ultimo: string; resumo: ResumoContainer }
> {
  const limite = Date.now() + tetoMs;
  let ultimo = "SEM_LEITURA";
  let resumo: ResumoContainer = resumoContainer(null);

  for (;;) {
    const s = await statusContainer(containerId);
    resumo = resumoContainer(s.bruto);

    // A RESPOSTA INTEIRA, A CADA CONSULTA — item B da OS, literal: "LOGAR os
    // quatro literais a cada consulta, no container_status_bruto que já
    // existe". Antes era só na PRIMEIRA leitura do laço, e a justificativa era
    // que 8 cópias por invocação seriam ruído. O item C tirou essa
    // justificativa do mapa: com passo de 60s e teto de 90s são DUAS leituras
    // por invocação. Duas linhas de log por invocação não é ruído — é a série
    // temporal que mostra se `copyright_check_status` mexe ou fica parado, que
    // é exatamente a pergunta em aberto sobre o avatar sintético falando.
    console.log("[farol-reel] container_status_bruto:", {
      container_id: containerId,
      ok: s.ok,
      resposta: s.bruto,
      // Os quatro literais também DESTRINCHADOS, e não só dentro do objeto
      // cru: é o que permite achar por texto no log do Vercel sem depender de
      // como ele resolve imprimir um objeto aninhado.
      status_code: resumo.status_code,
      copyright_check_status: resumo.copyright_check_status,
      status: resumo.status,
      ...(s.ok ? {} : { erro: s.erro }),
    });

    if (!s.ok) return { fim: "falhou", erro: `status_container: ${s.erro}` };
    ultimo = s.code;
    // Valores medidos na doc de Content Publishing da Meta:
    // EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED.
    if (s.code === "FINISHED" || s.code === "PUBLISHED") return { fim: "pronto" };
    if (s.code === "ERROR" || s.code === "EXPIRED") {
      return { fim: "falhou", erro: `container_${s.code.toLowerCase()}` };
    }

    // Só dorme se o sono INTEIRO couber no teto. A versão anterior testava o
    // relógio no topo do laço e por isso dormia 60s para depois descobrir que
    // não tinha mais tempo de ler — um minuto de invocação paga do bolso do
    // upload que vem depois.
    if (Date.now() + POLL_PASSO_MS >= limite) break;
    await new Promise((r) => setTimeout(r, POLL_PASSO_MS));
  }
  return { fim: "demorou", ultimo, resumo };
}

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  if (process.env.FAROL_REEL !== "on") {
    console.log("[farol-reel] represado (desarmado)");
    return NextResponse.json({ ok: true, publicou: false, motivo: "desarmado" });
  }

  const inicio = Date.now();
  const db = createXtvClient();
  const desde = new Date(Date.now() - JANELA_HORAS * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await db
      .from("farol_reels")
      .select(
        "id,carta_id,video_id,container_id,status,legenda,detalhe,criado_em,atualizado_em"
      )
      .in("status", ["renderizando", "pronto", "publicando"])
      .gte("criado_em", desde)
      .order("criado_em", { ascending: true })
      .limit(LIMITE_LINHAS);
    if (error) throw new Error(`farol_reels_ilegivel: ${error.message}`);

    const pendentes = (data ?? []) as LinhaReel[];

    // Encerra o que passou da janela — antes de olhar os vivos, para que a fila
    // não cresça sem fim com renders que nunca vão publicar.
    await encerrarVencidos(db, desde);

    if (pendentes.length === 0) {
      console.log("[farol-reel] nada pendente");
      return NextResponse.json({ ok: true, publicou: false, motivo: "nada_pendente" });
    }

    const olhados: Record<string, string>[] = [];

    for (const linha of pendentes) {
      // ---- (3) Retomada: container já existe, não cria outro ---------------
      if (linha.container_id) {
        if (Date.now() - inicio > ORCAMENTO_MS) {
          olhados.push({ video_id: linha.video_id, resultado: "sem_orcamento" });
          break;
        }

        // Container LEGADO = criado com a URL expirável do HeyGen, antes desta
        // fatia. Reconhecido pela ausência de `url_hospedada` no detalhe, e não
        // por um id chumbado no código: o 17878184478684841 é o caso de hoje,
        // a condição é a regra. Esses containers não melhoram com o tempo —
        // são exatamente os que a Meta devolve iguais para sempre — então a
        // espera de 20 min não compra informação nenhuma e é dispensada.
        const detAtual = (linha.detalhe ?? {}) as { url_hospedada?: string };
        const legado = !detAtual.url_hospedada;

        // FASE2-C: a checagem de zumbi ficou EXCLUSIVA do legado.
        // Para o container HOSPEDADO ela não existe mais, e isso é ganho duplo:
        //   · o reset por idade nunca foi resgate para ele — medido em 07/08, a
        //     Meta devolve o MESMO id, então resetar era roleta;
        //   · a régua que resolve o caso dele agora é a DERROTA aos 15 min, que
        //     roda dentro do `publicarContainer` e chega MUITO antes dos 60 min
        //     que este ramo esperava. O ramo virou inalcançável — e um caminho
        //     inalcançável que continua escrito é uma regra falsa.
        // De quebra some um GET por ciclo: o `checarZumbi` fazia leitura
        // própria do container, separada da leitura do polling.
        const z = legado
          ? await checarZumbi(linha, linha.container_id)
          : { zumbi: false, code: "NAO_CHECADO", idadeMin: 0 };
        if (z.zumbi) {
          // Autocura: zera o container e NÃO dá `continue` — cai no caminho
          // normal logo abaixo, que relê o HeyGen, HOSPEDA o mp4 e só então
          // pede um container novo.
          // CORRIGINDO A PREMISSA ORIGINAL desta autocura, que a medição de
          // 07/08 refutou: não bastava "recriar com video_url fresca". Com a
          // URL do HeyGen, a Meta devolvia o MESMO container — o reset girava
          // em falso a cada 10 min. O que realmente quebra o ciclo é a URL ser
          // NOSSA e nova; o reset sozinho nunca resolveu nada.
          console.warn("[farol-reel] container zumbi resetado", {
            container_id: linha.container_id,
            idade_min: z.idadeMin,
            code: z.code,
            motivo: "sem_url_hospedada",
          });
          // Guarda o id ABANDONADO para poder reconhecer o dedupe lá embaixo:
          // se a Meta devolver este mesmo id no lugar de um novo, o reset foi
          // roleta e queremos que isso fique escrito, não deduzido.
          const detReset = {
            ...(linha.detalhe ?? {}),
            container_anterior: linha.container_id,
          };
          await atualizar(db, linha.id, { container_id: null, detalhe: detReset });
          linha.detalhe = detReset;
          linha.container_id = null;
        } else {
          const r = await publicarContainer(db, linha, linha.container_id);
          olhados.push({ video_id: linha.video_id, resultado: r });
          // 'derrota' entra aqui junto de 'falhou' porque é a MESMA espécie de
          // desfecho: a linha saiu de 'publicando' e virou 'falhou' no banco.
          // O nome é separado só para o log dizer QUAL das duas mortes foi —
          // a que a Meta declarou (ERROR/EXPIRED) ou a que nós declaramos aos
          // 15 min. Se ficasse fora desta lista, o laço continuaria para a
          // próxima linha depois de já ter gasto o orçamento inteiro numa
          // sondagem, que é exatamente o gasto que a FASE2-C veio cortar.
          if (r === "publicado" || r === "falhou" || r === "derrota") break;
          continue;
        }
      }

      // ---- Estado do render no HeyGen -------------------------------------
      const det = (linha.detalhe ?? {}) as {
        avatar_tipo?: string;
        data?: string;
        tipo?: string;
      };
      const tipoAvatar = String(det.avatar_tipo ?? "avatar");
      // Título = chave de resgate quando o id guardado não resolve (404 do
      // HeyGen). Reconstruído do `detalhe` que a PRÓPRIA fase 1 gravou, pela
      // mesma função que a fase 1 usa para montá-lo. Se o detalhe não tiver os
      // campos, vai `null` e o comportamento é o de antes: 404 vira pendente.
      const titulo = det.data && det.tipo ? tituloRender(det.data, det.tipo) : null;
      // Idade da LINHA, ancorada em `criado_em` — o instante do disparo do
      // render. Não em `atualizado_em`: qualquer escrita na fila empurra aquele
      // carimbo, e uma linha estagnada que fosse tocada por outro motivo
      // rejuvenesceria e nunca alcançaria o limiar. `criado_em` só anda para
      // frente. Passar disso arma o resgate por título mesmo sem 404 (ver
      // `resgatarSeEstagnado` em lib/heygen.ts).
      const idadeLinhaMs = Date.now() - new Date(linha.criado_em).getTime();
      const estagnada = Number.isFinite(idadeLinhaMs) && idadeLinhaMs >= IDADE_ESTAGNADA_MS;
      const s = await statusVideo(linha.video_id, tipoAvatar, titulo, estagnada);
      if (!s.ok) {
        // Falha de LEITURA não condena o render: pode ser 429 ou rede. Espera.
        console.error("[farol-reel] status do vídeo ilegível:", {
          video_id: linha.video_id,
          erro: s.erro,
        });
        olhados.push({ video_id: linha.video_id, resultado: `status_ilegivel` });
        continue;
      }

      if (s.data.idResolvido && s.data.idResolvido !== linha.video_id) {
        // O estado veio pelo resgate por título: o HeyGen conhece este vídeo
        // por OUTRO id. Registro e sigo publicando — o id guardado continua
        // sendo a chave de idempotência desta linha (UNIQUE), e reescrevê-lo
        // no meio do laço mexeria nessa chave sem necessidade. Trocar de chave
        // é decisão do Emerson, não efeito colateral de uma leitura.
        console.warn("[farol-reel] id divergente (resgatado por título):", {
          guardado: linha.video_id,
          heygen: s.data.idResolvido,
        });
      }

      if (s.data.estado === "falhou") {
        console.error("[farol-reel] render falhou no HeyGen:", {
          video_id: linha.video_id,
          bruto: s.data.bruto,
          erro: s.data.erro,
        });
        await atualizar(db, linha.id, {
          status: "falhou",
          erro: `heygen_${s.data.bruto}: ${s.data.erro ?? "sem_mensagem"}`.slice(0, 500),
        });
        await registrar(db, "reel_falhou", linha.carta_id, null, {
          video_id: linha.video_id,
          erro: s.data.erro,
        });
        olhados.push({ video_id: linha.video_id, resultado: "falhou_no_heygen" });
        continue;
      }

      if (s.data.estado === "processando") {
        olhados.push({ video_id: linha.video_id, resultado: "renderizando" });
        continue;
      }

      // `pronto` sem URL não sai de `lerStatus`, mas o tipo permite — e daqui
      // pra frente a URL é obrigatória. Estreita aqui, uma vez, em vez de `!`
      // espalhado adiante.
      if (!s.data.videoUrl) {
        console.error("[farol-reel] pronto sem video_url:", { video_id: linha.video_id });
        olhados.push({ video_id: linha.video_id, resultado: "sem_video_url" });
        continue;
      }

      // ---- Duração do render: o multiplicando do custo -----------------------
      // GRAVA AQUI, e não junto com o `detalhe` final lá embaixo, de propósito.
      // Daqui até o container ainda dá para sair por quatro portas (orçamento,
      // linha reclamada por outra invocação, legenda reprovada, hospedagem
      // falhou) e três delas terminam a linha sem nunca mais voltar. O render
      // JÁ FOI PAGO nesse ponto — o vídeo existe no HeyGen. Deixar a duração
      // para depois faria o custo sumir exatamente nos reels que falharam
      // depois de renderizar, que são os mais caros que temos: pagos e não
      // publicados. O custo tem que doer onde ele acontece.
      //
      // Escreve UMA vez por linha (guarda `duracao_s == null`): a fase 2 relê o
      // status a cada tique, e sem a guarda isto viraria um UPDATE por tique
      // gravando o mesmo número.
      const detDur = (linha.detalhe ?? {}) as { duracao_s?: number };
      if (s.data.duracaoS != null && detDur.duracao_s == null) {
        const detalheDur = { ...(linha.detalhe ?? {}), duracao_s: s.data.duracaoS };
        await atualizar(db, linha.id, { detalhe: detalheDur });
        linha.detalhe = detalheDur;
      }

      // ---- Pronto: caminho caro. Orçamento e reclamação antes da Meta ------
      if (Date.now() - inicio > ORCAMENTO_MS) {
        olhados.push({ video_id: linha.video_id, resultado: "sem_orcamento" });
        break;
      }
      if (!(await reclamar(db, linha))) {
        olhados.push({ video_id: linha.video_id, resultado: "reclamada_por_outra" });
        continue;
      }

      const legenda = linha.legenda ?? "";
      // Última medição de compliance antes do perfil público. A fase 1 já mediu;
      // esta é a que vale, porque é a que fica publicada.
      const reprovada = revisarLegenda(legenda);
      if (!legenda || reprovada) {
        const motivo = reprovada ?? "legenda_vazia";
        console.error("[farol-reel] legenda reprovada na publicação:", motivo);
        await atualizar(db, linha.id, { status: "falhou", erro: `legenda:${motivo}` });
        olhados.push({ video_id: linha.video_id, resultado: `legenda_${motivo}` });
        break;
      }

      // ---- Hospedagem: o mp4 passa a morar em casa -------------------------
      // Reaproveita o que já estiver hospedado (o objeto é idempotente por
      // video_id), para que uma republicação não pague o download de novo.
      const detPre = (linha.detalhe ?? {}) as { url_hospedada?: string };
      let urlPublica = detPre.url_hospedada ?? null;
      // Buffer vivo desta invocação. Só existe se a hospedagem correu AGORA;
      // numa invocação que reaproveitou `url_hospedada` ele fica nulo e o
      // caminho resumable rebaixa do nosso bucket (rápido, mesma região).
      let bytesEmMemoria: Uint8Array<ArrayBuffer> | null = null;
      if (!urlPublica) {
        const h = await hospedarVideo(db, linha.video_id, s.data.videoUrl);
        if (!h.ok) {
          // Falha de hospedagem NÃO condena o render: a linha fica 'publicando'
          // com container_id nulo e o próximo ciclo tenta de novo do zero.
          // `break` e não `continue` porque esta invocação já gastou o
          // orçamento pesado — insistir noutra linha convida o timeout.
          console.error("[farol-reel] hospedagem falhou:", {
            video_id: linha.video_id,
            erro: h.erro,
          });
          olhados.push({ video_id: linha.video_id, resultado: "hospedagem_falhou" });
          break;
        }
        urlPublica = h.url;
        bytesEmMemoria = h.bytes;
        // Grava ANTES de criar o container, pelo mesmo motivo da trava (3): se
        // a invocação morrer no meio, a próxima reaproveita o upload em vez de
        // refazê-lo — e é este campo que distingue container novo de legado.
        const detalheNovo = { ...(linha.detalhe ?? {}), url_hospedada: urlPublica };
        await atualizar(db, linha.id, { detalhe: detalheNovo });
        linha.detalhe = detalheNovo;
      }

      // ---- Container: DOIS CAMINHOS, um deles desarmado (FASE2-A) ----------
      // PADRÃO (`video_url`): a Meta recebe a NOSSA URL — estável, sem
      // expiração e distinta por objeto, que é o que quebra o dedupe de
      // container medido em produção. Este continua sendo o caminho de fábrica.
      //
      // RESUMABLE (`FAROL_REEL_RESUMABLE=on`): nós EMPURRAMOS os bytes em vez
      // de dar uma URL para a Meta buscar. Isso remove da corrente o único
      // trecho que nunca conseguimos observar — o fetch dela na nossa URL —,
      // que por eliminação é onde o container fica IN_PROGRESS para sempre.
      //
      // É HIPÓTESE SOB TESTE, NÃO CONSERTO. Se o container travar mesmo com os
      // bytes entregues na mão, a hipótese do fetch morre e sobra a Meta. Isso
      // é informação, e é por isso que a troca nasce atrás de env: quem decide
      // mudar o padrão decide com o log na mão, não com uma expectativa.
      //
      // A HOSPEDAGEM CONTINUA ACONTECENDO NOS DOIS CAMINHOS, de propósito. Ela
      // não é só insumo do container: o mp4 hospedado é o asset oficial para o
      // repost manual no TikTok, e é ele que permite voltar ao caminho padrão
      // sem baixar nada do HeyGen de novo (cuja URL presignada já pode ter
      // expirado). Economizar a hospedagem aqui compraria segundos e venderia
      // a reversibilidade.
      const usarResumable = process.env.FAROL_REEL_RESUMABLE === "on";

      const container = usarResumable
        ? await chamarGraph("media", {
            media_type: "REELS",
            upload_type: "resumable",
            caption: legenda,
            share_to_feed: true,
          })
        : await chamarGraph("media", {
            media_type: "REELS",
            video_url: urlPublica,
            caption: legenda,
            share_to_feed: true,
          });
      if (!container.ok) {
        console.error("[farol-reel] container recusado:", {
          video_id: linha.video_id,
          erro: container.erro,
        });
        await atualizar(db, linha.id, {
          status: "falhou",
          erro: `container: ${container.erro}`.slice(0, 500),
        });
        await registrar(db, "reel_falhou", linha.carta_id, null, {
          video_id: linha.video_id,
          erro: container.erro,
        });
        olhados.push({ video_id: linha.video_id, resultado: "container_recusado" });
        break;
      }

      // ---- Anti-roleta: a Meta devolveu o MESMO container? -----------------
      // Se devolveu, o reset não resgatou nada — só girou. Fica registrado no
      // log E no detalhe, para o próximo ciclo saber sem precisar deduzir.
      const detPos = (linha.detalhe ?? {}) as { container_anterior?: string };
      const idNovo = String(container.id ?? "");
      const dedupou = !!detPos.container_anterior && detPos.container_anterior === idNovo;

      const detalheFinal: Record<string, unknown> = { ...(linha.detalhe ?? {}) };
      delete detalheFinal.container_anterior;
      if (dedupou) {
        console.warn("[farol-reel] dedupe_confirmado", { container_id: idNovo });
        // Carimbo NOVO a cada confirmação, e não o primeiro preservado. Se
        // guardasse o primeiro, a idade já nasceria vencida no tique seguinte e
        // a roleta voltaria a girar de 10 em 10 min — exatamente o que esta
        // regra existe para impedir. Renovando, o próximo reset só é possível
        // depois do limiar CHEIO contado daqui.
        detalheFinal.dedupe_confirmado_em = new Date().toISOString();
      } else {
        // Id diferente: o dedupe se soltou. O relógio volta ao normal.
        delete detalheFinal.dedupe_confirmado_em;
      }

      // GRAVA O CONTAINER ANTES DE PUBLICAR — trava (3) do header.
      await atualizar(db, linha.id, {
        status: "publicando",
        container_id: container.id,
        detalhe: detalheFinal,
      });
      linha.detalhe = detalheFinal;

      // ---- O push dos bytes (só no caminho resumable) -----------------------
      // DEPOIS de gravar o container_id, e não antes: se a lambda morrer no meio
      // do push, a linha fica 'publicando' com o container conhecido, e a
      // autocura tem em que se agarrar. Empurrar antes de gravar deixaria um
      // container órfão na Meta que ninguém sabe que existe.
      if (usarResumable) {
        const bytes = bytesEmMemoria ?? (await rebaixarHospedado(urlPublica));
        if (!bytes) {
          console.error("[farol-reel] resumable sem bytes:", {
            video_id: linha.video_id,
            url: urlPublica,
          });
          await atualizar(db, linha.id, { status: "falhou", erro: "resumable: sem_bytes" });
          olhados.push({ video_id: linha.video_id, resultado: "resumable_sem_bytes" });
          break;
        }

        const push = await enviarBytesResumable({
          containerId: container.id as string,
          bytes,
          token: process.env.IG_ACCESS_TOKEN ?? "",
        });

        // O CUSTO SEMPRE VAI PARA O LOG, inclusive no erro. Foi o que a
        // coordenação pediu, e é o número que decide se este caminho vira
        // padrão: um push de 2,6 MB que leva 800ms é barato; o mesmo push
        // levando 40s comeria metade do maxDuration e a conversa muda.
        console.log("[farol-reel] rupload:", {
          video_id: linha.video_id,
          container_id: container.id,
          bytes: push.bytes,
          ms: push.ms,
          ok: push.ok,
          erro: push.ok ? null : push.erro,
        });

        if (!push.ok) {
          // Falha de push NÃO é falha de render. A linha morre com motivo
          // literal e o container fica lá vazio — inofensivo, porque sem bytes
          // ele nunca vira post. O próximo ciclo recomeça do zero, e desarmar
          // o env volta ao caminho padrão sem tocar em código.
          await atualizar(db, linha.id, {
            status: "falhou",
            erro: `rupload: ${push.erro}`.slice(0, 500),
          });
          await registrar(db, "reel_falhou", linha.carta_id, null, {
            video_id: linha.video_id,
            erro: push.erro,
            bytes: push.bytes,
            ms: push.ms,
          });
          olhados.push({ video_id: linha.video_id, resultado: "rupload_falhou" });
          break;
        }
      }

      const r = await publicarContainer(db, linha, container.id as string);
      olhados.push({ video_id: linha.video_id, resultado: r });
      break;
    }

    const publicou = olhados.some((o) => o.resultado === "publicado");
    console.log("[farol-reel] fase 2:", { pendentes: pendentes.length, olhados });
    return NextResponse.json({ ok: true, publicou, olhados });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-reel] erro na fase 2:", erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}

/**
 * Espera o container e publica. Compartilhado pelo caminho novo e pela retomada
 * — que é o que garante que retomar seja o MESMO código, e não um primo dele.
 */
async function publicarContainer(
  db: Db,
  linha: LinhaReel,
  containerId: string
): Promise<string> {
  // Se o container JÁ passou da idade de derrota, não gasta minuto sondando:
  // pede uma leitura só (teto 0 ainda garante UMA), para declarar a derrota com
  // dado fresco em vez de com o último code que sobrou de outra invocação.
  const idadeAntes = idadeContainerMs(linha, Date.now());
  const jaVencido = Number.isFinite(idadeAntes) && idadeAntes >= DERROTA_MS;
  const espera = await esperarContainer(containerId, jaVencido ? 0 : POLL_MAX_MS);

  if (espera.fim === "demorou") {
    // ---- FASE2-C: a régua da DERROTA ------------------------------------
    // Aqui, e não numa varredura à parte, por dois motivos medidos: (a) a
    // leitura fresca do container ACABOU de acontecer no `esperarContainer`,
    // então declarar derrota não custa nenhuma chamada extra à Meta; (b) é o
    // único ponto do código por onde passam TODOS os containers em espera —
    // caminho novo e retomada —, então não há um segundo caminho para a regra
    // esquecer de cobrir.
    const idadeMs = idadeContainerMs(linha, Date.now());
    const idadeMin = Math.round(idadeMs / 60_000);
    const d = decidirDerrota({ idadeMs, ultimoCode: espera.ultimo });

    if (d.derrota) {
      const motivo = motivoDerrota(espera.resumo, idadeMin);
      console.error("[farol-reel] DERROTA declarada:", {
        video_id: linha.video_id,
        container_id: containerId,
        idade_min: idadeMin,
        limite_min: Math.round(DERROTA_MS / 60_000),
        status_code: espera.resumo.status_code,
        copyright_check_status: espera.resumo.copyright_check_status,
        status: espera.resumo.status,
      });
      // O motivo vai para DOIS lugares de propósito: `erro` é a coluna que o
      // painel já lê (é o que faz a linha aparecer como falha rápida, e não
      // como "em movimento" mentindo por 24h), e `detalhe.derrota` guarda os
      // literais separados para o item A da próxima fatia poder comparar
      // container a container sem ter que fatiar string.
      await atualizar(db, linha.id, {
        status: "falhou",
        erro: motivo,
        detalhe: {
          ...(linha.detalhe ?? {}),
          derrota: {
            em: new Date().toISOString(),
            container_id: containerId,
            idade_min: idadeMin,
            status_code: espera.resumo.status_code,
            copyright_check_status: espera.resumo.copyright_check_status,
            status: espera.resumo.status,
          },
        },
      });
      await registrar(db, "reel_falhou", linha.carta_id, null, {
        video_id: linha.video_id,
        container_id: containerId,
        erro: motivo,
      });
      // NÃO reagenda daqui. Reagendar é trabalho da fase 1, que já escolhe
      // carta e roteiro do zero no ciclo seguinte — inventar um retry aqui
      // criaria um segundo dono do "quando nasce um reel", e dois donos da
      // mesma decisão é como se duplica post.
      return "derrota";
    }

    // Ainda dentro do prazo: não é falha. A linha fica 'publicando' com
    // container_id, e o próximo ciclo entra direto pela retomada.
    console.log("[farol-reel] container ainda processando:", {
      video_id: linha.video_id,
      container_id: containerId,
      ultimo: espera.ultimo,
      idade_min: idadeMin,
      falta_min: Math.max(0, Math.round((DERROTA_MS - idadeMs) / 60_000)),
      copyright_check_status: espera.resumo.copyright_check_status,
    });
    return "container_processando";
  }

  if (espera.fim === "falhou") {
    console.error("[farol-reel] container falhou:", {
      video_id: linha.video_id,
      container_id: containerId,
      erro: espera.erro,
    });
    await atualizar(db, linha.id, { status: "falhou", erro: espera.erro.slice(0, 500) });
    await registrar(db, "reel_falhou", linha.carta_id, null, {
      video_id: linha.video_id,
      container_id: containerId,
      erro: espera.erro,
    });
    return "falhou";
  }

  const publicado = await chamarGraph("media_publish", { creation_id: containerId });
  if (!publicado.ok) {
    // SEM RETRY IMEDIATO AQUI, ao contrário do post de feed: lá o container é
    // uma imagem e o erro transitório passa em 3s. Aqui o container é vídeo e
    // já foi confirmado FINISHED — um erro neste ponto é recusa, não pressa.
    // A linha continua 'publicando' com container_id, e o ciclo seguinte
    // retoma o MESMO container. É a segunda tentativa, sem risco de duplicar.
    console.error("[farol-reel] publicação recusada:", {
      video_id: linha.video_id,
      container_id: containerId,
      erro: publicado.erro,
    });
    await atualizar(db, linha.id, { erro: `publish: ${publicado.erro}`.slice(0, 500) });
    return "publicacao_recusada";
  }

  await atualizar(db, linha.id, {
    status: "publicado",
    post_id: publicado.id,
    erro: null,
  });
  await registrar(db, "reel_publicado", linha.carta_id, publicado.id ?? null, {
    video_id: linha.video_id,
    container_id: containerId,
  });

  console.log("[farol-reel] reel publicado:", {
    post_id: publicado.id,
    video_id: linha.video_id,
    carta_id: linha.carta_id,
  });

  // YOUTUBE-01: o MESMO mp4 vira Short. Depois do IG e fora do caminho crítico
  // — ver `subirParaYoutube`, que nunca lança e nunca muda o veredito abaixo.
  await subirParaYoutube(db, linha);

  // TIKTOK-01: o MESMO mp4, terceira casa. Roda DEPOIS do YouTube e é
  // igualmente inofensiva ao veredito. A ordem importa por um motivo só: o
  // `subirParaYoutube` acima sincroniza `linha.detalhe` em memória depois de
  // gravar, então o spread aqui embaixo preserva o `yt_video_id` em vez de
  // sobrescrevê-lo com uma cópia velha do objeto.
  await subirParaTiktok(db, linha);

  return "publicado";
}

// ===========================================================================
// YOUTUBE-01 — o mesmo mp4 como Short do @Bidconoficial
// AUTORIZADO: Emerson Gomes dos Santos — OS "YOUTUBE-01", 07/08/2026:
// "após media_publish do IG com sucesso, se env FAROL_YOUTUBE=on: subir o MESMO
//  mp4 como Short (...). Falha do YouTube NUNCA derruba o fluxo do IG — try/catch
//  isolado, log [farol-youtube]."
// ---------------------------------------------------------------------------
// NASCE DESARMADO. Sem `FAROL_YOUTUBE=on` esta função sai na primeira linha, e
// o FAROL segue publicando no Instagram como publicava ontem.
//
// O IG É O DONO DO VEREDITO. Esta função é `void` de propósito: não devolve
// nada que possa mudar o `return "publicado"` de cima. O reel JÁ ESTÁ NO AR no
// Instagram quando ela roda — deixar o YouTube reprovar isso seria contar uma
// mentira sobre um fato que já aconteceu. Ela captura tudo, registra e cala.
//
// IDEMPOTÊNCIA POR `detalhe.yt_video_id`. A fase 2 pode passar de novo pela
// mesma linha (retomada, disparo manual da validação da OS). Sem esta trava, o
// mesmo Short subiria duas vezes — e o YouTube, ao contrário da Meta, NÃO
// deduplica: aceita o upload repetido e cria um segundo vídeo.
//
// O MP4 VEM DO NOSSO BUCKET, não do HeyGen. `detalhe.url_hospedada` é estável e
// sem expiração; a URL do HeyGen vence. Linha legada sem esse campo é pulada com
// motivo literal, e não com um erro de download meia hora depois.
// ===========================================================================

/** Tags fixas — mesma família das hashtags do reel, sem o `#`. */
const TAGS_YOUTUBE = [
  "consorcio",
  "carta contemplada",
  "planejamento",
  "patrimonio",
  "bidcon",
];

const CANAL_YOUTUBE = "https://youtube.com/@Bidconoficial";

/**
 * Título curto, no formato da OS: "{tipo} de {crédito} · custo {custo} | Bidcon".
 *
 * O custo sai de `pctAoMes()`, que já entrega "0,65% a.m." — a OS escreveu
 * "custo {custo} a.m." com o sufixo à mão, mas repetir o sufixo aqui daria
 * "0,65% a.m. a.m.". Uso o formatador canônico da casa e o texto renderizado é
 * exatamente o que a OS pediu. Mesma regra do CLAUDE.md: custo SEMPRE em % a.m.
 */
function tituloShort(det: {
  tipo?: string;
  credito?: number;
  custo_am?: number | null;
}): string {
  const label = LABEL_TIPO_BEM[det.tipo ?? ""] ?? "Carta contemplada";
  const credito = typeof det.credito === "number" ? reais(det.credito) : null;
  const custo = pctAoMes(det.custo_am ?? null);

  const partes = [credito ? `${label} de ${credito}` : label, `custo ${custo}`];
  return `${partes.join(" · ")} | Bidcon`;
}

async function subirParaYoutube(db: Db, linha: LinhaReel): Promise<void> {
  if (process.env.FAROL_YOUTUBE !== "on") return;

  try {
    const det = (linha.detalhe ?? {}) as {
      url_hospedada?: string;
      yt_video_id?: string;
      tipo?: string;
      credito?: number;
      custo_am?: number | null;
    };

    if (det.yt_video_id) {
      console.log("[farol-youtube] já subiu, pulando:", {
        video_id: linha.video_id,
        yt_video_id: det.yt_video_id,
      });
      return;
    }

    if (!det.url_hospedada) {
      console.log("[farol-youtube] sem url_hospedada (linha legada), pulando:", {
        video_id: linha.video_id,
      });
      return;
    }

    const descricao = [linha.legenda ?? "", "", CANAL_YOUTUBE, ""].join("\n");

    const r = await subirShort({
      url: det.url_hospedada,
      titulo: tituloShort(det),
      descricao,
      tags: TAGS_YOUTUBE,
    });

    if (!r.ok) {
      // Erro do YouTube é EVENTO, não sentença: a linha continua 'publicado'
      // e o `erro` dela não é tocado, porque ele descreve o IG.
      console.error("[farol-youtube] upload falhou:", {
        video_id: linha.video_id,
        erro: r.erro,
      });
      await registrar(db, "reel_youtube_falhou", linha.carta_id, null, {
        video_id: linha.video_id,
        erro: r.erro,
      });
      return;
    }

    const detalheNovo = { ...(linha.detalhe ?? {}), yt_video_id: r.videoId };
    await atualizar(db, linha.id, { detalhe: detalheNovo });
    linha.detalhe = detalheNovo;

    console.log("[farol-youtube] short publicado:", {
      video_id: linha.video_id,
      yt_video_id: r.videoId,
      carta_id: linha.carta_id,
    });
    // `post_id` fica NULL de propósito: em `farol_posts` essa coluna significa
    // "post do Instagram" em todos os outros eventos. O id do YouTube vai no
    // detalhe, onde não se confunde com o do IG.
    await registrar(db, "reel_youtube_publicado", linha.carta_id, null, {
      video_id: linha.video_id,
      yt_video_id: r.videoId,
    });
  } catch (e) {
    // A rede de segurança final. Se a gravação do `detalhe` falhar, o Short já
    // está no ar e o id vai para o log — que é a única forma de alguém amarrar
    // um ao outro à mão. Nada disso volta para o chamador.
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-youtube] erro isolado (IG não afetado):", {
      video_id: linha.video_id,
      erro,
    });
  }
}

// ===========================================================================
// TIKTOK-01 — o mesmo mp4 no perfil @bidcon
// AUTORIZADO: Emerson Gomes dos Santos — OS "TIKTOK-01", 07/08/2026:
// "após publicar no IG, se FAROL_TIKTOK=on: subir o MESMO mp4 → gravar
//  tt_publish_id no detalhe. Idempotente (pular se já existe). Falha do TikTok
//  NUNCA derruba IG/YouTube — try/catch isolado, log [farol-tiktok]."
// ---------------------------------------------------------------------------
// NASCE DESARMADO. Sem `FAROL_TIKTOK=on` esta função sai na primeira linha.
//
// TRÊS PLATAFORMAS, TRÊS SILÊNCIOS INDEPENDENTES. Esta função é irmã gêmea da
// `subirParaYoutube` e a semelhança é deliberada: `void`, try/catch total,
// idempotência por campo do `detalhe`, erro vira evento em `farol_posts` e
// nunca sentença. O IG continua sendo o dono do veredito; o YouTube, que já
// rodou acima, também não é afetado por nada daqui — são três caminhos que só
// compartilham o arquivo mp4.
//
// IDEMPOTÊNCIA POR `detalhe.tt_publish_id`. Vale a mesma advertência do
// YouTube: o TikTok não deduplica, aceita o mesmo arquivo de novo e cria um
// segundo post.
//
// O QUE É GRAVADO É O `publish_id`, NÃO O ID DO POST. Medido: o Direct Post é
// assíncrono do lado do TikTok — o `init` devolve `publish_id` e a publicação
// termina depois, em outro tempo. O id público (`publicaly_available_post_id`)
// só existe quando a moderação libera, e esperar por ele aqui seguraria a fase
// 2 por tempo indeterminado. O `publish_id` é a chave que consulta o desfecho
// via `consultarStatus()`; é o que existe para gravar no momento em que estamos.
//
// A LEGENDA É A MESMA DO IG. Ela já passou pelo `revisarLegenda()` antes do
// render e de novo antes do Instagram: mesma fala, mesma alfândega. O teto de
// 2200 runas do TikTok é aplicado dentro da lib.
// ===========================================================================
async function subirParaTiktok(db: Db, linha: LinhaReel): Promise<void> {
  if (process.env.FAROL_TIKTOK !== "on") return;

  try {
    const det = (linha.detalhe ?? {}) as {
      url_hospedada?: string;
      tt_publish_id?: string;
      tipo?: string;
      credito?: number;
      custo_am?: number | null;
    };

    if (det.tt_publish_id) {
      console.log("[farol-tiktok] já subiu, pulando:", {
        video_id: linha.video_id,
        tt_publish_id: det.tt_publish_id,
      });
      return;
    }

    if (!det.url_hospedada) {
      console.log("[farol-tiktok] sem url_hospedada (linha legada), pulando:", {
        video_id: linha.video_id,
      });
      return;
    }

    // Legenda do IG; se ela não existir (linha antiga), o título curto do Short
    // é melhor do que um post sem texto nenhum.
    const titulo = linha.legenda?.trim() || tituloShort(det);

    const r = await publicarVideo({ url: det.url_hospedada, titulo });

    if (!r.ok) {
      console.error("[farol-tiktok] publicação falhou:", {
        video_id: linha.video_id,
        erro: r.erro,
      });
      await registrar(db, "reel_tiktok_falhou", linha.carta_id, null, {
        video_id: linha.video_id,
        erro: r.erro,
      });
      return;
    }

    const detalheNovo = { ...(linha.detalhe ?? {}), tt_publish_id: r.publishId };
    await atualizar(db, linha.id, { detalhe: detalheNovo });
    linha.detalhe = detalheNovo;

    console.log("[farol-tiktok] post enviado:", {
      video_id: linha.video_id,
      tt_publish_id: r.publishId,
      carta_id: linha.carta_id,
      privacidade: process.env.TT_PRIVACY ?? "SELF_ONLY",
    });
    // `post_id` NULL pelo mesmo motivo do YouTube: em `farol_posts` essa coluna
    // significa "post do Instagram" em todos os outros eventos.
    await registrar(db, "reel_tiktok_publicado", linha.carta_id, null, {
      video_id: linha.video_id,
      tt_publish_id: r.publishId,
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-tiktok] erro isolado (IG/YouTube não afetados):", {
      video_id: linha.video_id,
      erro,
    });
  }
}

/**
 * Container zumbi: a linha ficou em 'publicando' com container_id, o tempo
 * passou e o container da Meta CONTINUA IN_PROGRESS. Foi o que o operador
 * destravou à mão hoje; aqui vira regra.
 *
 * Duas recusas deliberadas, porque um reset errado custa um upload e pode
 * jogar fora um vídeo que ia publicar:
 *  - leitura ilegível (429, rede, token): NÃO é zumbi — não sei o estado, e não
 *    saber nunca vira sentença;
 *  - qualquer code que não seja IN_PROGRESS: devolve o code e o caminho normal
 *    decide. FINISHED publica; ERROR/EXPIRED viram falha por `esperarContainer`,
 *    que já registra o code literal. Duas rotas para o mesmo veredito seriam
 *    duas verdades.
 *
 * A TERCEIRA RECUSA — a espera por idade — MORREU NA FASE2-C, e o motivo fica
 * escrito porque tirar uma trava sem dizer por quê é pior do que nunca a ter
 * posto. Ela existia para o ciclo de 10 min não pagar um GET por linha a cada
 * passada. Só que o único chamador que restou é o container LEGADO, e ele
 * sempre entrou aqui com a espera dispensada (`ignorarIdade = true`): o limiar
 * nunca foi consultado de verdade. Medi antes de apagar. O caso que a idade
 * protegia — o container hospedado — não passa mais por aqui: quem decide o
 * destino dele é a DERROTA aos 15 min, dentro do `publicarContainer`.
 *
 * O `idadeMin` continua sendo devolvido, agora calculado pela MESMA âncora que
 * a régua da derrota usa (`idadeContainerMs`, sob teste em lib/farol/container).
 * Ele não decide nada aqui — é só o número que vai para o log, e ter dois
 * cálculos de idade no mesmo arquivo era ter duas idades.
 *
 * Abandonar um container NÃO publica nada por acidente: container só vai ao ar
 * por chamada explícita de `media_publish`, e o abandonado nunca mais recebe uma.
 */
async function checarZumbi(
  linha: LinhaReel,
  containerId: string
): Promise<{ zumbi: boolean; code: string; idadeMin: number }> {
  const idadeMin = Math.round(idadeContainerMs(linha, Date.now()) / 60_000);

  if (linha.status !== "publicando") {
    return { zumbi: false, code: "NAO_CHECADO", idadeMin };
  }

  const s = await statusContainer(containerId);
  if (!s.ok) {
    console.error("[farol-reel] status do container ilegível:", {
      container_id: containerId,
      erro: s.erro,
    });
    return { zumbi: false, code: "ILEGIVEL", idadeMin };
  }
  return { zumbi: s.code === "IN_PROGRESS", code: s.code, idadeMin };
}

/** Encerra o que passou da janela de 24h — ver header. */
async function encerrarVencidos(db: Db, desde: string): Promise<void> {
  const { error } = await db
    .from("farol_reels")
    .update({
      status: "falhou",
      erro: `expirado: sem publicar em ${JANELA_HORAS}h`,
      atualizado_em: new Date().toISOString(),
    })
    .in("status", ["renderizando", "pronto", "publicando"])
    .lt("criado_em", desde);
  if (error) console.error("[farol-reel] falha encerrando vencidos:", error.message);
}
