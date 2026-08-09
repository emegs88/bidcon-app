// ============================================================================
// POST /api/farol/saber — semeia a base de conhecimento e roda o FAQ VIVO
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-SABER-01", 08/08/2026.
// ----------------------------------------------------------------------------
// DUAS TAREFAS, UMA ROTA, E ELAS SÃO INDEPENDENTES DE PROPÓSITO:
//
//   1) SEMEAR — grava as SEMENTES de lib/farol/saber.ts e as vetoriza.
//   2) FAQ VIVO — lê perguntas reais de cliente em `wa_mensagens`, anonimiza,
//      agrupa por parecença e grava as recorrentes como fonte='faq' com
//      contagem.
//
// Cada uma é ligada/desligada por query (`?semear=0`, `?faq=0`) e cada uma tem
// seu bloco try. Se a OpenAI cair no meio do FAQ, as sementes já semeadas
// permanecem e a resposta reporta o que deu certo. A rota devolve 200 com o
// relatório mesmo quando uma metade falhou — porque o chamador é humano ou
// cron, e um 500 opaco esconderia a metade que funcionou.
//
// ---------------------------------------------------------------------------
// O PADRÃO DE LOTE NÃO É INVENÇÃO MINHA: é cópia medida de
// /api/backfill-embeddings (lote pequeno, sequencial, idempotente, falha
// unitária não derruba o lote). A razão é aritmética e não estética:
// `maxDuration = 60` e cada embedding da OpenAI custa uma ida à rede. Varrer
// mil mensagens numa chamada não caberia no tempo — e nem precisa, porque o
// FAQ é acumulativo: rodar de novo amanhã continua de onde parou.
//
// ---------------------------------------------------------------------------
// POR QUE SEMEAR É UPSERT, E POR QUE ELE NÃO REVETORIZA TUDO. A chave natural
// (fonte, titulo) da migração 0072 é o que faz a segunda chamada corrigir em
// vez de duplicar. E antes de gastar embedding a rota COMPARA o conteúdo que
// já está no banco: verbete que não mudou não é revetorizado. Sem isso, cada
// chamada custaria 12 embeddings para reescrever bytes idênticos.
//
// ---------------------------------------------------------------------------
// O FAQ VIVO NUNCA GRAVA O QUE LEU — GRAVA O QUE DESTILOU. O caminho é único e
// tem a ordem que importa:
//
//   wa_mensagens (papel='cliente')
//     -> anonimizar()          <- tira telefone, e-mail, CPF/CNPJ, @, link
//     -> ehPergunta()          <- descarta "oi", "bom dia", "obrigado"
//     -> dedupe literal        <- duas iguais viram uma ANTES de custar embedding
//     -> embedding             <- o único gasto
//     -> agrupamento guloso    <- perguntas parecidas viram UM grupo
//     -> só grupos com >= MIN_OCORRENCIAS entram
//     -> antes de inserir, procura um faq parecido e INCREMENTA
//
// O `anonimizar()` vem ANTES de tudo, inclusive do embedding: assim nem o
// vetor carrega o telefone de ninguém. Nada aqui grava conversa_id, telefone
// ou nome — e a tabela também não tem coluna para eles (0072). Duas travas.
//
// ---------------------------------------------------------------------------
// POR QUE MIN_OCORRENCIAS = 2 E NÃO 1. Uma pergunta única não é um FAQ; é uma
// conversa. Guardar toda pergunta que chega encheria a base de casos
// particulares que competiriam na busca com os verbetes escritos — e a busca
// devolve 5 trechos, então o lixo desloca o bom. O corte em 2 é o que faz a
// palavra "recorrente" da OS significar alguma coisa.
//
// AUTORIZAÇÃO: Bearer DISPARO_SECRET, igual a /api/farol/reel-opcoes. Esta
// rota ESCREVE — por isso o verbo é POST e não há alias GET. Cron não a chama
// hoje; quem chama é o Emerson.
//
// ---------------------------------------------------------------------------
// createXtvClient E NÃO createAdminClient. ISTO NÃO É DETALHE, É O ARQUIVO
// INTEIRO. Há DOIS projetos Supabase e eu escrevi este arquivo com o cliente
// errado antes de medir. O que a medição mostrou:
//
//                          nnv (createAdminClient)   xtv (createXtvClient)
//   wa_mensagens ......... NÃO EXISTE                sim (158 msgs de cliente)
//   farol_* .............. 0 tabelas                 5 tabelas
//   pgvector ............. sim                       sim
//
// Com createAdminClient esta rota responderia 200 OK, semearia a base num
// banco onde nenhuma outra tabela do FAROL vive, e o FAQ VIVO leria
// `wa_mensagens` num projeto que não tem essa tabela — errando em silêncio
// para sempre. Todo o resto do FAROL e todo o código que toca `wa_mensagens`
// já usa createXtvClient; esta rota agora também. A migração 0072 é aplicada
// no projeto xtv (xtvjpnyadcdeadhmzyff), e isso está escrito lá também.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { autorizadoFarol } from "@/lib/farol/selecao";
import { gerarEmbedding, embeddingParaSQL } from "@/lib/ia";
import {
  SEMENTES,
  anonimizar,
  ehPergunta,
  similaridade,
  MIN_OCORRENCIAS_ACERVO as MIN_OCORRENCIAS,
  type Semente,
} from "@/lib/farol/saber";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Quantas mensagens de cliente o FAQ olha por chamada. O teto existe porque
// cada pergunta DISTINTA vira um embedding, e 60s não comportam centenas.
const LOTE_FAQ_PADRAO = 40;
const LOTE_FAQ_MAX = 150;

// Janela de tempo padrão do FAQ. 30 dias é o horizonte em que uma dúvida ainda
// é "a dúvida de agora" — o que interessa para a pauta e para a série Responde.
const DIAS_PADRAO = 30;

// Duas perguntas com cosseno acima disto são a MESMA dúvida com outra redação.
// 0,88 foi escolhido alto de propósito: errar para o lado de criar dois
// verbetes parecidos é reversível (dá para fundir); errar para o lado de
// fundir duas dúvidas diferentes apaga uma delas para sempre.
const LIMIAR_GRUPO = 0.88;

// Para reconhecer um FAQ que já existe no banco o limiar é mais frouxo: aqui o
// erro barato é o oposto — incrementar a contagem de um verbete quase igual é
// melhor do que espalhar cinco linhas quase idênticas pela base.
const LIMIAR_FAQ_EXISTENTE = 0.82;

// `MIN_OCORRENCIAS` agora vem de lib/farol/saber.ts (MIN_OCORRENCIAS_ACERVO),
// para que o limiar de GRAVAR e o de PUBLICAR possam ser comparados por teste.

// Um título é rótulo, não texto. O conteúdo inteiro fica em `conteudo`.
const MAX_TITULO = 120;

function autorizado(req: Request): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return false; // sem segredo configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function inteiroDaQuery(req: Request, chave: string, padrao: number, teto: number): number {
  const bruto = Number(new URL(req.url).searchParams.get(chave));
  if (!Number.isFinite(bruto) || bruto <= 0) return padrao;
  return Math.min(Math.floor(bruto), teto);
}

function ligado(req: Request, chave: string): boolean {
  return new URL(req.url).searchParams.get(chave) !== "0";
}

function titularizar(texto: string): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length <= MAX_TITULO ? limpo : `${limpo.slice(0, MAX_TITULO - 1)}…`;
}

type Db = ReturnType<typeof createXtvClient>;

// ----------------------------------------------------------------------------
// 1) SEMEAR
// ----------------------------------------------------------------------------
type RelatorioSementes = {
  total: number;
  inseridas: number;
  atualizadas: number;
  inalteradas: number;
  falhas: string[];
};

async function semear(db: Db): Promise<RelatorioSementes> {
  const rel: RelatorioSementes = {
    total: SEMENTES.length,
    inseridas: 0,
    atualizadas: 0,
    inalteradas: 0,
    falhas: [],
  };

  // O que já está no banco, para não pagar embedding do que não mudou.
  // Coluna a coluna, nunca `*` — regra da casa para o service_role.
  const { data: existentes } = await db
    .from("farol_saber")
    .select("fonte, titulo, conteudo, embedding")
    .in(
      "titulo",
      SEMENTES.map((s) => s.titulo)
    );

  const jaTem = new Map<string, { conteudo: string; temVetor: boolean }>();
  for (const linha of (existentes ?? []) as Array<{
    fonte: string;
    titulo: string;
    conteudo: string;
    embedding: unknown;
  }>) {
    jaTem.set(`${linha.fonte}||${linha.titulo}`, {
      conteudo: linha.conteudo,
      temVetor: linha.embedding != null,
    });
  }

  // Sequencial: mesma razão do backfill — rate-limit da OpenAI e custo previsível.
  for (const s of SEMENTES as Semente[]) {
    const chave = `${s.fonte}||${s.titulo}`;
    const anterior = jaTem.get(chave);

    if (anterior && anterior.conteudo === s.conteudo && anterior.temVetor) {
      rel.inalteradas += 1;
      continue;
    }

    try {
      // O vetor é do TÍTULO + CONTEÚDO juntos: a pergunta do cliente costuma
      // parecer mais com o título ("junção de cartas") do que com o corpo.
      const vetor = await gerarEmbedding(`${s.titulo}\n\n${s.conteudo}`);
      const { error } = await db.from("farol_saber").upsert(
        {
          fonte: s.fonte,
          titulo: s.titulo,
          conteudo: s.conteudo,
          tags: s.tags,
          embedding: embeddingParaSQL(vetor),
        },
        { onConflict: "fonte,titulo" }
      );
      if (error) {
        rel.falhas.push(`${s.titulo}: ${error.message}`);
        continue;
      }
      if (anterior) rel.atualizadas += 1;
      else rel.inseridas += 1;
    } catch (e) {
      rel.falhas.push(`${s.titulo}: ${(e as Error)?.message ?? "erro"}`);
    }
  }

  return rel;
}

// ----------------------------------------------------------------------------
// 2) FAQ VIVO
// ----------------------------------------------------------------------------
type Grupo = { texto: string; vetor: number[]; n: number };

type RelatorioFaq = {
  mensagens_lidas: number;
  perguntas: number;
  distintas: number;
  grupos: number;
  recorrentes: number;
  novos: number;
  incrementados: number;
  falhas: string[];
};

async function faqVivo(db: Db, lote: number, dias: number): Promise<RelatorioFaq> {
  const rel: RelatorioFaq = {
    mensagens_lidas: 0,
    perguntas: 0,
    distintas: 0,
    grupos: 0,
    recorrentes: 0,
    novos: 0,
    incrementados: 0,
    falhas: [],
  };

  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  // SÓ `conteudo`. Nem conversa_id, nem id: o que não é lido não pode vazar
  // por engano num log. `papel='cliente'` é o enum wa_papel da 0046.
  const { data: msgs, error } = await db
    .from("wa_mensagens")
    .select("conteudo")
    .eq("papel", "cliente")
    .gte("criado_em", desde)
    .order("criado_em", { ascending: false })
    .limit(lote);

  if (error) {
    rel.falhas.push(`leitura: ${error.message}`);
    return rel;
  }

  const brutas = (msgs ?? []) as Array<{ conteudo: string | null }>;
  rel.mensagens_lidas = brutas.length;

  // anonimizar ANTES de qualquer outra coisa, inclusive do embedding.
  const perguntas: string[] = [];
  for (const m of brutas) {
    const texto = anonimizar(String(m.conteudo ?? ""));
    if (!texto) continue;
    if (!ehPergunta(texto)) continue;
    perguntas.push(texto);
  }
  rel.perguntas = perguntas.length;

  // Dedupe literal antes de gastar embedding: em WhatsApp a mesma frase colada
  // duas vezes é comum, e ela não pode custar duas chamadas de rede.
  const vistas = new Map<string, number>();
  for (const p of perguntas) {
    const chave = p.toLowerCase();
    vistas.set(chave, (vistas.get(chave) ?? 0) + 1);
  }
  const distintas = [...vistas.entries()].map(([chave, n]) => ({
    // devolve a redação original (com maiúsculas) da primeira ocorrência
    texto: perguntas.find((p) => p.toLowerCase() === chave) ?? chave,
    n,
  }));
  rel.distintas = distintas.length;

  // Agrupamento guloso. O(n²) em cima de no máximo LOTE_FAQ_MAX itens — o custo
  // real está nos embeddings, não na comparação.
  const grupos: Grupo[] = [];
  for (const d of distintas) {
    let vetor: number[];
    try {
      vetor = await gerarEmbedding(d.texto);
    } catch {
      // NUNCA loga o texto: é pergunta de cliente, mesmo anonimizada.
      rel.falhas.push("embedding de uma pergunta falhou");
      continue;
    }
    const alvo = grupos.find((g) => similaridade(g.vetor, vetor) >= LIMIAR_GRUPO);
    if (alvo) {
      alvo.n += d.n;
      // O representante do grupo continua sendo o primeiro: trocá-lo mudaria o
      // título de um verbete já gravado a cada rodada.
    } else {
      grupos.push({ texto: d.texto, vetor, n: d.n });
    }
  }
  rel.grupos = grupos.length;

  const recorrentes = grupos.filter((g) => g.n >= MIN_OCORRENCIAS);
  rel.recorrentes = recorrentes.length;

  for (const g of recorrentes) {
    try {
      // Já existe um FAQ que é esta mesma dúvida? Reusa a RPC da 0072 com o
      // vetor que JÁ temos — sem segunda chamada à OpenAI.
      const { data: proximos } = await db.rpc("buscar_saber", {
        p_embedding: embeddingParaSQL(g.vetor),
        p_limite: 1,
        p_fontes: ["faq"],
      });

      const achado = Array.isArray(proximos) ? (proximos[0] as
        | { id: string; titulo: string; score: number }
        | undefined) : undefined;

      if (achado && Number(achado.score) >= LIMIAR_FAQ_EXISTENTE) {
        // Incrementa. Ler-e-escrever em vez de UPDATE atômico é aceitável aqui
        // e a razão está escrita para não parecer descuido: um único chamador,
        // no máximo uma vez por dia, e o pior caso de uma corrida é uma
        // contagem 1 unidade menor num ranking de popularidade.
        const { data: atual } = await db
          .from("farol_saber")
          .select("ocorrencias")
          .eq("id", achado.id)
          .single();
        const nova = Number((atual as { ocorrencias?: number } | null)?.ocorrencias ?? 1) + g.n;
        const { error: errUp } = await db
          .from("farol_saber")
          .update({ ocorrencias: nova })
          .eq("id", achado.id);
        if (errUp) rel.falhas.push(`incremento: ${errUp.message}`);
        else rel.incrementados += 1;
        continue;
      }

      // Novo verbete. `conteudo` é a PERGUNTA, não uma resposta: o FAQ VIVO
      // registra o que perguntam. Quem responde é o cérebro (Entrega 2) e a
      // série Responde (Entrega 3), cada um com seu linter de compliance.
      const { error: errIns } = await db.from("farol_saber").insert({
        fonte: "faq",
        titulo: titularizar(g.texto),
        conteudo: g.texto,
        tags: ["faq", "whatsapp"],
        embedding: embeddingParaSQL(g.vetor),
        ocorrencias: g.n,
      });
      if (errIns) {
        // 23505 = unique(fonte,titulo). Duas redações que só diferem depois do
        // corte de 120 caracteres. Não é falha: é o unique fazendo o trabalho.
        if ((errIns as { code?: string }).code === "23505") continue;
        rel.falhas.push(`insercao: ${errIns.message}`);
        continue;
      }
      rel.novos += 1;
    } catch (e) {
      rel.falhas.push(`grupo: ${(e as Error)?.message ?? "erro"}`);
    }
  }

  return rel;
}

// ----------------------------------------------------------------------------
/**
 * O corpo, compartilhado por POST (mão) e GET (cron). `semearPadrao` é a única
 * diferença entre os dois — ver o comentário do GET.
 */
async function executar(req: Request, semearPadrao: boolean) {
  const db = createXtvClient();
  const lote = inteiroDaQuery(req, "lote", LOTE_FAQ_PADRAO, LOTE_FAQ_MAX);
  const dias = inteiroDaQuery(req, "dias", DIAS_PADRAO, 365);

  const resposta: Record<string, unknown> = { ok: true };

  if (semearPadrao ? ligado(req, "semear") : new URL(req.url).searchParams.get("semear") === "1") {
    try {
      resposta.sementes = await semear(db);
    } catch (e) {
      resposta.sementes = { erro: (e as Error)?.message ?? "falhou" };
    }
  } else {
    resposta.sementes = "pulado (?semear=0)";
  }

  if (ligado(req, "faq")) {
    try {
      resposta.faq = await faqVivo(db, lote, dias);
    } catch (e) {
      resposta.faq = { erro: (e as Error)?.message ?? "falhou" };
    }
  } else {
    resposta.faq = "pulado (?faq=0)";
  }

  // Foto do estado final: é o que o Emerson lê para saber se a base existe.
  const { data: contagem } = await db.from("farol_saber").select("fonte");
  const porFonte: Record<string, number> = {};
  for (const l of (contagem ?? []) as Array<{ fonte: string }>) {
    porFonte[l.fonte] = (porFonte[l.fonte] ?? 0) + 1;
  }
  resposta.base = porFonte;

  return NextResponse.json(resposta);
}

/** Disparo à mão. Segredo próprio (`DISPARO_SECRET`) e semeadura LIGADA. */
export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, erro: "nao_autorizado" }, { status: 401 });
  }
  return executar(req, true);
}

/**
 * Disparo por CRON — e ele existe por uma razão que só apareceu quando a série
 * "Responde, Porta-voz" ficou pronta: cron da Vercel emite GET, esta rota só
 * exportava POST, e nada mais no repositório chama o FAQ VIVO. Ou seja, sem
 * este handler nenhuma linha `fonte='faq'` jamais nasce sozinha — e a série,
 * que só lê linhas de FAQ, responderia "sem_pergunta" para sempre. A Entrega 3
 * nasceria morta esperando um POST manual que ninguém lembraria de dar.
 *
 * DUAS DIFERENÇAS em relação ao POST, e as duas são de propósito:
 *
 * 1) A guarda é `autorizadoFarol` (FAROL_SECRET || CRON_SECRET), a mesma de
 *    todo cron do FAROL. Não é afrouxamento: `DISPARO_SECRET` é o segredo de
 *    quem dispara à mão, e a Vercel não o envia. Pôr o segredo de disparo
 *    manual dentro de um agendamento seria misturar dois papéis.
 *
 * 2) A semeadura vem DESLIGADA aqui (só roda com `?semear=1` explícito).
 *    Semear é ato de instalação: acontece uma vez, gasta embedding em texto
 *    que não mudou, e repetido de hora em hora é dinheiro queimado para
 *    reescrever a mesma coisa. O FAQ VIVO é o oposto — ele existe justamente
 *    para rodar sempre, porque o que ele lê (as mensagens de ontem) muda todo
 *    dia. Um cron que faz as duas coisas junto esconde essa diferença.
 */
export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ ok: false, erro: "nao_autorizado" }, { status: 401 });
  }
  return executar(req, false);
}
