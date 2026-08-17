// ============================================================================
// /admin/conversas — a SALA DE ATENDIMENTO (CONVERSAS-02)
// AUTORIZADO: Emerson Gomes dos Santos — 09/08/2026:
//   "uma lista de telefones não é uma sala de atendimento — é um log."
// ----------------------------------------------------------------------------
// O QUE MUDOU, E POR QUÊ. A tela anterior mostrava, por linha: o telefone, o
// telefone de novo, "Bot ativo" e uma data. Quem opera não sabia quem é a
// pessoa, do que falaram, nem quem estava esperando. Três defeitos concretos
// foram corrigidos aqui, e todos eram silenciosos:
//
//   1. O CANAL ERA INVENTADO. A linha 116 antiga escrevia `canal: "whatsapp"`
//      para toda linha de `wa_conversas`, derivando o canal da TABELA. A coluna
//      `canal` existe e estava sendo ignorada — as 4 conversas de Instagram
//      apareciam com o crachá errado.
//   2. O TELEFONE APARECIA DUAS VEZES. `{l.nome ?? l.telefone}` no título e
//      `{l.telefone}` no meta: sem nome, a linha repetia o mesmo número.
//   3. A ORDEM ERA CRONOLÓGICA PURA. Quem esperava havia mais tempo ia para o
//      FIM da lista, que é o inverso do que uma fila precisa fazer.
//
// A ARITMÉTICA NÃO MORA AQUI. `lib/whatsapp/sala.ts` guarda tudo o que erra em
// silêncio (quem espera, há quanto tempo, quem vai no topo, o que o cliente
// disse por último) porque `scripts/testes.mjs` varre `lib/` e NÃO varre
// páginas. O que sobrou neste arquivo é leitura de banco e marcação.
//
// AGREGAÇÃO SEM LAÇO POR CONVERSA. São 4 consultas de tamanho fixo, não uma por
// conversa: as mensagens vêm em UM bloco por tabela e são agrupadas em memória
// numa passada. Nenhuma consulta dentro de `map`.
//
// ----------------------------------------------------------------------------
// CONVERSAS-03 — período e legibilidade
// AUTORIZADO: Emerson Gomes dos Santos — 11/08/2026:
//   "melhor filtro por dia, não deixar confuso, melhorar painel"
//
// O DEFEITO QUE ESTA FATIA CONSERTA JÁ ESTAVA EM PRODUÇÃO, NESTE ARQUIVO. As
// linhas do bloco dos números faziam:
//
//     const inicioDoDia = new Date();
//     inicioDoDia.setHours(0, 0, 0, 0);
//
// `setHours` usa o fuso do PROCESSO, e a Vercel roda em UTC. Das 21h à
// meia-noite de Brasília, "conversas hoje" já tinha virado o dia seguinte no
// servidor: o número zerava três horas antes da virada, todo dia, justamente na
// faixa da noite em que o WhatsApp mais fala. Ninguém ia notar — um contador em
// 0 parece um dia parado, não um dia errado. Agora quem decide o dia é
// `inicioDoDiaMs` de `lib/whatsapp/sala.ts`, que pergunta o fuso ao Intl e tem
// teste para as 22h de Brasília.
//
// DUAS SEÇÕES, NÃO UMA — DESVIO DECLARADO A EMERSON. Separador por dia (item 2)
// e a ordenação da CONVERSAS-02 ("quem esperou mais vem no topo") se
// contradizem: agrupar por dia jogaria a fila para dentro do histórico. Quem
// espera resposta humana sai da linha do tempo e vira um bloco fixo no topo,
// sem cabeçalho de dia; o RESTO, que é histórico, é o que ganha os separadores.
// Ver `separarSala`.
//
// NADA SOME CALADO. O que o filtro de período escondeu é CONTADO e IMPRESSO, e
// conversa sem data aparece sob "Sem data" em vez de evaporar.
// ============================================================================
import Link from "next/link";
import { IBM_Plex_Mono } from "next/font/google";
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConversasSubNav } from "./ConversasSubNav";
import { ConversaAcoes } from "./ConversaAcoes";
import { FilaSentinela } from "./FilaSentinela";
import {
  formatarContato,
  iniciais,
  identidadeCard,
  previaComContexto,
  resumirConversa,
  tempoRelativo,
  esperandoHumano,
  esperaMs,
  separarSala,
  mediana,
  duracaoCurta,
  inicioDoDiaMs,
  lerPeriodo,
  janelaPeriodo,
  dentroDoPeriodo,
  agruparPorDia,
  PERIODOS,
  PERIODO_PADRAO,
  type CanalSala,
  type ConversaSala,
  type MensagemCrua,
  type Papel,
} from "@/lib/whatsapp/sala";
import areaStyles from "@/components/area.module.css";
import styles from "./conversas.module.css";

export const dynamic = "force-dynamic";

// Padrão da casa para números (ver app/minha-carta/page.tsx). A fonte é
// carregada na página, não no layout: o layout não carrega fonte nenhuma hoje,
// e puxar Plex Mono para o topo do app o faria baixar em telas que não têm
// número para exibir.
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-mono" });

/**
 * Teto de mensagens lidas por tabela.
 *
 * Herdado do PAINEL-WA-01 e mantido, agora com o custo medido: hoje são 328
 * mensagens de WhatsApp (55 kB de conteúdo) e 426 do site (100 kB). No teto,
 * o pior caso é da ordem de 1 MB por tabela — pesado, mas limitado, que é o
 * ponto de haver um teto. Conversa antiga o bastante para cair fora dele fica
 * sem derivação, e a tela DIZ isso em vez de exibir um carimbo errado com cara
 * de hora da última mensagem.
 *
 * A razão original do teto continua valendo: `wa_conversas.atualizado_em` NÃO
 * avança com mensagem nova (medido em pg_trigger — `conversas` tem o trigger
 * `conversas_touch`, `wa_conversas` não tem trigger nenhum). Em 04/08 a
 * conversa 9eb5f278 carimbava 15/07 23:44 tendo mensagem de 04/08 09:43: 19,42
 * dias de mentira, em 64 mensagens. Por isso a última atividade é DERIVADA das
 * mensagens, nunca lida do campo.
 */
const LIMITE_MSGS = 5000;

/** Data em que o detector de cedente nasceu. Antes disso `tags` é vazio por
 *  construção — e o número de cedentes precisa dizer isso, não fingir zero. */
const DETECTOR_CEDENTE_DESDE = "2026-08-09";

const ROTULO_CANAL: Record<CanalSala, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  site: "Site",
};
const CLASSE_CANAL: Record<CanalSala, string> = {
  whatsapp: styles.canalWhatsapp,
  instagram: styles.canalInstagram,
  site: styles.canalSite,
};

function statusInfo(status: string): { label: string; tone: "ok" | "amber" | "muted" } {
  if (status === "humano") return { label: "Humano no comando", tone: "amber" };
  if (status === "encerrado" || status === "fechada") return { label: "Encerrada", tone: "muted" };
  return { label: "Bot ativo", tone: "ok" };
}

/** Agrupa mensagens por conversa numa passada. */
function agrupar<T>(linhas: T[], chave: (l: T) => string, valor: (l: T) => MensagemCrua) {
  const mapa = new Map<string, MensagemCrua[]>();
  for (const l of linhas) {
    const k = chave(l);
    const atual = mapa.get(k);
    if (atual) atual.push(valor(l));
    else mapa.set(k, [valor(l)]);
  }
  return mapa;
}

export default async function AdminConversas({
  searchParams,
}: {
  searchParams: { canal?: string; foco?: string; q?: string; periodo?: string };
}) {
  const { nome } = await exigirAdminConsolePagina();
  const supabase = createXtvClient();
  const agoraMs = Date.now();

  const [{ data: waConversas }, { data: conversasSite }, { data: waMsgs }, { data: siteMsgs }] =
    await Promise.all([
      supabase
        .from("wa_conversas")
        .select("id, telefone, nome, status, canal, tags, criado_em, atualizado_em"),
      supabase.from("conversas").select("id, interesse_id, status, canal, criado_em, atualizado_em"),
      supabase
        .from("wa_mensagens")
        .select("conversa_id, papel, conteudo, criado_em, media_id")
        .order("criado_em", { ascending: false })
        .limit(LIMITE_MSGS),
      supabase
        .from("mensagens")
        .select("conversa_id, papel, conteudo, criado_em, anexo")
        .order("criado_em", { ascending: false })
        .limit(LIMITE_MSGS),
    ]);

  // A identidade do site não mora em `conversas` — a tabela não tem nome nem
  // telefone (medido). Ela vem de `interesses`, pelo formulário.
  const interesseIds = [
    ...new Set((conversasSite ?? []).map((c) => c.interesse_id).filter(Boolean)),
  ] as string[];
  const { data: interesses } = interesseIds.length
    ? await supabase.from("interesses").select("id, nome, telefone").in("id", interesseIds)
    : { data: [] as { id: string; nome: string | null; telefone: string | null }[] };
  const interesseMap = new Map((interesses ?? []).map((i) => [i.id as string, i]));

  const msgsWa = agrupar(
    waMsgs ?? [],
    (m) => m.conversa_id as string,
    (m) => ({
      papel: m.papel as Papel,
      conteudo: (m.conteudo as string | null) ?? null,
      criado_em: m.criado_em as string,
      temAnexo: m.media_id != null,
    })
  );

  // TRADUÇÃO DE VOCABULÁRIO. `mensagens.papel` (site) só tem 'cliente' e
  // 'agente' (medido: 213 e 213); `wa_mensagens.papel` é um enum de quatro
  // valores. 'agente' vira 'prosperito' porque, para a única pergunta que a
  // sala faz — "quem falou por último foi o cliente?" —, os dois dizem a mesma
  // coisa: o robô respondeu. Qualquer valor inesperado cai em 'prosperito' e
  // não em 'cliente': errar para "já foi respondido" tira alguém da fila
  // indevidamente uma vez; errar para "cliente" criaria uma espera fantasma que
  // fica no topo para sempre.
  const msgsSite = agrupar(
    siteMsgs ?? [],
    (m) => m.conversa_id as string,
    (m) => ({
      papel: (m.papel === "cliente" ? "cliente" : "prosperito") as Papel,
      conteudo: (m.conteudo as string | null) ?? null,
      criado_em: m.criado_em as string,
      temAnexo: m.anexo != null,
    })
  );

  type Linha = ConversaSala & {
    href: string;
    criadoEm: string | null;
    cedente: boolean;
    /** A última atividade veio das mensagens ou do carimbo do registro? As duas
     *  fontes não sabem a mesma coisa, e o card diz qual está exibindo. */
    fonteAtividade: "mensagem" | "registro";
  };

  const linhasWa: Linha[] = (waConversas ?? []).map((c) => {
    const resumo = resumirConversa(msgsWa.get(c.id as string) ?? []);
    const tags = (c.tags as string[] | null) ?? [];
    // Canal lido da COLUNA. O fallback é 'whatsapp' porque a tabela é do
    // WhatsApp — mas ele agora é fallback, não a regra.
    const canal: CanalSala = c.canal === "instagram" ? "instagram" : "whatsapp";
    return {
      id: c.id as string,
      canal,
      nome: (c.nome as string | null) ?? null,
      telefone: (c.telefone as string | null) ?? null,
      status: c.status as string,
      ...resumo,
      ultimaEm: resumo.ultimaEm ?? ((c.atualizado_em as string | null) ?? null),
      fonteAtividade: resumo.ultimaEm ? "mensagem" : "registro",
      href: `/admin/conversas/whatsapp/${c.id}`,
      criadoEm: (c.criado_em as string | null) ?? null,
      cedente: tags.includes("cedente"),
    };
  });

  const linhasSite: Linha[] = (conversasSite ?? []).map((c) => {
    const resumo = resumirConversa(msgsSite.get(c.id as string) ?? []);
    const interesse = c.interesse_id ? interesseMap.get(c.interesse_id as string) : null;
    return {
      id: c.id as string,
      canal: "site" as const,
      nome: (interesse?.nome as string | null) ?? null,
      telefone: (interesse?.telefone as string | null) ?? null,
      status: c.status as string,
      ...resumo,
      ultimaEm: resumo.ultimaEm ?? ((c.atualizado_em as string | null) ?? null),
      fonteAtividade: resumo.ultimaEm ? "mensagem" : "registro",
      href: `/admin/conversas/site/${c.id}`,
      criadoEm: (c.criado_em as string | null) ?? null,
      // `conversas`/`interesses` não têm coluna de tags — o detector de cedente
      // hoje só roda no webhook do WhatsApp. Marcar 'false' aqui é o estado
      // honesto: ausência de detecção, não ausência de cedente.
      cedente: false,
    };
  });

  const todas = [...linhasWa, ...linhasSite];

  // ---------------------------------------------------------------------
  // Os quatro números do topo (Entrega 3 da CONVERSAS-02)
  // ---------------------------------------------------------------------
  // ITEM 6 DA CONVERSAS-03, MEDIDO ANTES DE MEXER: estes quatro já liam `todas`,
  // que é a lista ANTES de qualquer filtro. Eles nunca dependeram do canal, do
  // foco nem da busca — e não passam a depender do período. Ou seja: o que a OS
  // pediu ("ficam fixos") já era verdade na aritmética. O que faltava era a
  // tela DIZER isso, porque um número que não se move quando o filtro muda
  // parece quebrado. A correção do item 6 é, portanto, de legenda, não de
  // cálculo — e está declarada assim para Emerson em vez de virar um "corrigi".
  //
  // O dia é o dia civil de BRASÍLIA. Ver o cabeçalho do arquivo: aqui havia um
  // `new Date().setHours(0,0,0,0)`, que usa o fuso do processo — UTC na Vercel.
  const inicioHojeMs = inicioDoDiaMs(agoraMs);
  const seteDiasMs = agoraMs - 7 * 24 * 60 * 60 * 1000;

  // "Conversas hoje" conta ATIVIDADE de hoje, não conversas criadas hoje: a
  // pergunta do operador é "quanto entrou na sala hoje", e uma conversa de
  // ontem que voltou a falar entrou na sala hoje.
  const conversasHoje = todas.filter((l) => {
    const t = l.ultimaEm ? new Date(l.ultimaEm).getTime() : NaN;
    return Number.isFinite(t) && t >= inicioHojeMs;
  }).length;

  const aguardando = todas.filter((l) => esperandoHumano(l));

  const cedentesSemana = todas.filter((l) => {
    if (!l.cedente) return false;
    const t = l.ultimaEm ? new Date(l.ultimaEm).getTime() : NaN;
    return Number.isFinite(t) && t >= seteDiasMs;
  }).length;

  // Mediana, não média — uma conversa esquecida arruinaria a média. Só entram
  // medições ENCERRADAS: quem ainda não foi respondido está no número de cima,
  // não neste (ver `resumirConversa`).
  //
  // JANELA DE 7 DIAS — DESVIO DECLARADO. A OS pediu "tempo mediano até a
  // primeira resposta" sem janela. Uma mediana vitalícia é dominada pelo
  // histórico e praticamente não se move: ela descreveria o passado com cara de
  // presente, e o operador não teria como ver uma piora. Sete dias alinha este
  // número com os outros três, que já são recortados. Emerson pode derrubar.
  const temposResposta = todas
    .filter((l) => {
      const t = l.ultimaEm ? new Date(l.ultimaEm).getTime() : NaN;
      return Number.isFinite(t) && t >= seteDiasMs;
    })
    .map((l) => l.msPrimeiraResposta)
    .filter((n): n is number => n !== null);
  const medianaResposta = mediana(temposResposta);

  // ---------------------------------------------------------------------
  // Filtros e busca
  // ---------------------------------------------------------------------
  const filtroCanal: CanalSala | null =
    searchParams.canal === "whatsapp" ||
    searchParams.canal === "instagram" ||
    searchParams.canal === "site"
      ? searchParams.canal
      : null;
  const foco = searchParams.foco;
  const busca = (searchParams.q ?? "").trim();

  // ITEM 1 — o período. `lerPeriodo` cai no padrão de 7 dias diante de qualquer
  // coisa que não reconheça, então `?periodo=banana` mostra a sala em vez de uma
  // tela vazia inexplicável. O link é deep-linkável porque o valor vive só na
  // URL: sem estado de cliente, sem cookie, e o operador pode mandar o endereço
  // para outra pessoa e os dois verem a MESMA lista.
  const periodo = lerPeriodo(searchParams.periodo);
  const janela = janelaPeriodo(periodo, agoraMs);

  // Busca por nome OU telefone. Compara também o telefone só-dígitos, para que
  // quem digita "(19) 99756" ou "19997561909" encontre a mesma pessoa que quem
  // digita o número como o banco o guardou.
  const buscaDigitos = busca.replace(/\D/g, "");
  const casaBusca = (l: Linha) => {
    if (!busca) return true;
    const alvo = `${l.nome ?? ""}`.toLowerCase();
    if (alvo.includes(busca.toLowerCase())) return true;
    if (!buscaDigitos) return false;
    return (l.telefone ?? "").replace(/\D/g, "").includes(buscaDigitos);
  };

  let lista = todas.filter(casaBusca);
  if (filtroCanal) lista = lista.filter((l) => l.canal === filtroCanal);
  if (foco === "atencao") lista = lista.filter((l) => esperandoHumano(l));
  if (foco === "cedente") lista = lista.filter((l) => l.cedente);
  if (foco === "anexo") lista = lista.filter((l) => l.temAnexo);

  // O PERÍODO É O ÚLTIMO FILTRO, e a diferença é guardada. Não porque a OS
  // pediu, mas porque um filtro que esconde sem dizer quanto escondeu faz o
  // operador concluir "não tem nada" quando a resposta certa é "não tem nada
  // NESTA janela". As duas frases levam a decisões opostas.
  const antesDoPeriodo = lista.length;
  lista = lista.filter((l) => dentroDoPeriodo(l.ultimaEm, janela));
  const ocultasPeriodo = antesDoPeriodo - lista.length;

  // ITEM 2 — a fila sai da linha do tempo (ver o desvio no cabeçalho), e só o
  // histórico é agrupado por dia.
  const { fila, resto } = separarSala(lista, agoraMs);
  const historico = agruparPorDia(resto, (l) => l.ultimaEm, agoraMs);

  const qtdAtencao = aguardando.length;
  const qtdCedente = todas.filter((l) => l.cedente).length;
  const qtdAnexo = todas.filter((l) => l.temAnexo).length;

  // Todo link de filtro CARREGA os outros filtros. É o que faz "combinável" da
  // OS ser verdade: trocar o período não apaga o canal, nem a busca, nem o foco.
  // O período só entra na URL quando não é o padrão — assim o endereço limpo
  // continua sendo `/admin/conversas`, e um `?periodo=7d` explícito só aparece
  // se alguém o escreveu.
  function href(over: {
    canal?: string | null;
    foco?: string | null;
    periodo?: string | null;
  }): string {
    const p = new URLSearchParams();
    const c = over.canal === undefined ? filtroCanal : over.canal;
    const f = over.foco === undefined ? foco : over.foco;
    const d = over.periodo === undefined ? periodo : over.periodo;
    if (c) p.set("canal", c);
    if (f) p.set("foco", f);
    if (d && d !== PERIODO_PADRAO) p.set("periodo", d);
    if (busca) p.set("q", busca);
    const qs = p.toString();
    return qs ? `/admin/conversas?${qs}` : "/admin/conversas";
  }

  // UM desenhista de card, três blocos (fila, dias, sem data). Duplicar esta
  // marcação três vezes seria a receita para os três divergirem na primeira
  // manutenção — e divergirem em silêncio, porque nada aqui é testado.
  const cartao = (l: Linha) => {
    const info = statusInfo(l.status);
    const contato = formatarContato(l.telefone, l.canal);
    const ident = identidadeCard(l);
    const sigla = iniciais(l.nome);
    const espera = esperaMs(l, agoraMs);
    const previa = previaComContexto(l.ultimaFalaCliente, l.ultimaPerguntaBot);
    return (
      <Card key={`${l.canal}-${l.id}`} as="li">
        <div className={styles.topo}>
          <div className={styles.identidade}>
            <span className={styles.avatar} aria-hidden="true">
              {sigla ?? "—"}
            </span>
            {/* ITEM 3 — sem nome, o TELEFONE vira o título e a segunda linha
                desaparece, em vez de repetir o mesmo dado duas vezes. A pastilha
                "sem nome" saiu junto: o título já diz que não há nome, e pastilha
                que repete o título é ruído com cara de informação. */}
            <span className={styles.nomes}>
              <span
                className={`${styles.nomeLead} ${ident.tituloEhContato ? styles.nomeLeadContato : ""}`}
              >
                {ident.titulo}
              </span>
              {ident.subtitulo ? (
                <span className={styles.contato}>{ident.subtitulo}</span>
              ) : null}
            </span>
          </div>
          <div className={styles.etiquetas}>
            <span className={`${styles.canal} ${CLASSE_CANAL[l.canal]}`}>
              <span className={styles.canalPonto} aria-hidden="true" />
              {ROTULO_CANAL[l.canal]}
            </span>
            <Badge tone={info.tone}>{info.label}</Badge>
            {l.cedente ? <Badge tone="amber">cedente</Badge> : null}
            {l.temAnexo ? <Badge tone="info">com anexo</Badge> : null}
          </div>
        </div>

        {/* ITEM 4 — resposta curta ganha a pergunta ao lado. "2" sozinho é
            ruído; "Bot: Quantas parcelas restam? · Cliente: 2" é informação. */}
        {previa ? (
          <p className={styles.fala}>
            {previa.pergunta ? (
              <span className={styles.falaPergunta}>Bot: {previa.pergunta} · </span>
            ) : null}
            <span className={styles.falaAutor}>Cliente: </span>
            {previa.resposta}
          </p>
        ) : (
          <p className={styles.semFala}>
            {l.totalMensagens === 0
              ? "Sem mensagens carregadas — conversa antiga demais para o teto de leitura, ou registro sem thread."
              : "O cliente ainda não escreveu nada nesta conversa."}
          </p>
        )}

        <div className={styles.rodape}>
          <span className={styles.tempo}>
            <span className={espera !== null ? styles.tempoEsperando : ""}>
              {espera !== null
                ? `esperando há ${duracaoCurta(espera)}`
                : l.fonteAtividade === "mensagem"
                  ? `última mensagem ${tempoRelativo(l.ultimaEm, agoraMs)}`
                  : `registro de ${tempoRelativo(l.ultimaEm, agoraMs)} · sem mensagem lida`}
            </span>
            <span className={styles.sinais}>
              {" · "}
              {l.totalMensagens} {l.totalMensagens === 1 ? "mensagem" : "mensagens"}
            </span>
          </span>
          {/* O canal da ROTA não é o canal do CARD: Instagram vive em
              `wa_conversas` e é atendido pelas rotas /whatsapp/. Por isso a
              confirmação recebe `contato` já formatado — ver o bloco de
              comentário em ConversaAcoes.tsx. */}
          <ConversaAcoes
            canal={l.canal === "site" ? "site" : "whatsapp"}
            conversaId={l.id}
            status={l.status}
            telefone={l.telefone ?? undefined}
            nome={l.nome}
            contato={l.telefone ? contato.texto : null}
            href={l.href}
            compacto
          />
        </div>
      </Card>
    );
  };

  return (
    <AppShell nome={nome} equipeAdminConsole>
      <PageHeader
        title="Conversas"
        subtitle="Quem precisa de você agora vem primeiro. Assuma uma conversa pra pausar o bot e responder."
      />
      <ConversasSubNav />

      <section className={`${styles.numeros} ${mono.variable}`} aria-label="Resumo do atendimento">
        <div className={styles.numero}>
          <span className={styles.numeroValor}>{conversasHoje}</span>
          <span className={styles.numeroRotulo}>conversas hoje</span>
          <span className={styles.numeroNota}>
            hoje · com atividade desde a meia-noite de Brasília
          </span>
        </div>
        <div className={styles.numero}>
          <span
            className={`${styles.numeroValor} ${qtdAtencao > 0 ? styles.numeroValorAtencao : ""}`}
          >
            {qtdAtencao}
          </span>
          <span className={styles.numeroRotulo}>aguardando resposta</span>
          <span className={styles.numeroNota}>
            agora, sem janela · o cliente falou e ninguém respondeu depois
          </span>
        </div>
        <div className={styles.numero}>
          <span className={styles.numeroValor}>{cedentesSemana}</span>
          <span className={styles.numeroRotulo}>cedentes na semana</span>
          <span className={styles.numeroNota}>
            {qtdCedente === 0
              ? `últimos 7 dias · zero porque o detector nasceu em ${DETECTOR_CEDENTE_DESDE} — nenhuma conversa anterior foi marcada`
              : "últimos 7 dias · pela etiqueta gravada em wa_conversas.tags"}
          </span>
        </div>
        <div className={styles.numero}>
          <span className={styles.numeroValor}>{duracaoCurta(medianaResposta)}</span>
          <span className={styles.numeroRotulo}>mediana até a 1ª resposta</span>
          <span className={styles.numeroNota}>
            {medianaResposta === null
              ? "últimos 7 dias · sem conversa respondida na janela"
              : `últimos 7 dias · ${temposResposta.length} ${temposResposta.length === 1 ? "conversa" : "conversas"} · quem ainda não foi respondido não entra`}
          </span>
        </div>
      </section>

      {/* ITEM 6. Estes quatro números nunca dependeram de filtro nenhum — leem a
          sala inteira. A legenda existe porque um número que não se move quando
          o filtro muda parece quebrado, e a suspeita de painel quebrado custa
          mais caro do que a linha de texto que a desfaz. */}
      <p className={styles.numerosLegenda}>
        Os quatro números acima têm janela própria, escrita em cada um, e{" "}
        <strong>não mudam</strong> com os filtros abaixo — nem com o período. Eles medem a sala
        inteira; os filtros mudam só a lista.
      </p>

      {/* A fila do Sentinela fica ACIMA da busca, junto dos números que não
          dependem de filtro, porque ela também não depende: é a sala inteira.
          E fica visível sem ninguém procurar — foi a invisibilidade dela que
          deixou 21 pessoas onze dias esperando sem que nenhuma tela dissesse. */}
      <FilaSentinela />

      <form className={styles.busca} method="get" action="/admin/conversas" role="search">
        <label className="sr-only" htmlFor="q">
          Buscar por nome ou telefone
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={busca}
          placeholder="Buscar por nome ou telefone…"
          className={styles.buscaCampo}
          autoComplete="off"
        />
        {filtroCanal ? <input type="hidden" name="canal" value={filtroCanal} /> : null}
        {foco ? <input type="hidden" name="foco" value={foco} /> : null}
        {/* Sem este campo, buscar jogaria o período de volta ao padrão sem
            avisar — o formulário faz GET e só manda o que ele mesmo carrega. */}
        {periodo !== PERIODO_PADRAO ? (
          <input type="hidden" name="periodo" value={periodo} />
        ) : null}
        <Button type="submit" variant="ghost" size="sm">
          Buscar
        </Button>
        {busca ? (
          <Button href={`/admin/conversas`} variant="link" size="sm">
            Limpar
          </Button>
        ) : null}
      </form>

      {/* ITEM 1 — o período, em fileira PRÓPRIA. Período é um eixo diferente de
          canal e de foco: misturar os três numa fileira só é a confusão que a
          OS mandou desfazer ("não deixar confuso"). Separados, cada fileira
          responde a uma pergunta, e o `aria-label` diz qual. */}
      <nav className={styles.periodos} aria-label="Filtrar por período">
        <span className={styles.periodosRotulo}>Período</span>
        {PERIODOS.map((p) => (
          <Button
            key={p.valor}
            href={href({ periodo: p.valor })}
            variant={periodo === p.valor ? "primary" : "ghost"}
            size="sm"
            aria-current={periodo === p.valor ? "true" : undefined}
          >
            {p.rotulo}
          </Button>
        ))}
      </nav>

      <nav className={areaStyles.filtros} aria-label="Filtrar conversas">
        <Button href={href({ canal: null })} variant={!filtroCanal ? "primary" : "ghost"} size="sm">
          Todos os canais
        </Button>
        <Button
          href={href({ canal: "whatsapp" })}
          variant={filtroCanal === "whatsapp" ? "primary" : "ghost"}
          size="sm"
        >
          WhatsApp
        </Button>
        <Button
          href={href({ canal: "instagram" })}
          variant={filtroCanal === "instagram" ? "primary" : "ghost"}
          size="sm"
        >
          Instagram
        </Button>
        <Button
          href={href({ canal: "site" })}
          variant={filtroCanal === "site" ? "primary" : "ghost"}
          size="sm"
        >
          Site
        </Button>
        <Button
          href={href({ foco: foco === "atencao" ? null : "atencao" })}
          variant={foco === "atencao" ? "primary" : "ghost"}
          size="sm"
        >
          Sem resposta{qtdAtencao ? ` (${qtdAtencao})` : ""}
        </Button>
        <Button
          href={href({ foco: foco === "cedente" ? null : "cedente" })}
          variant={foco === "cedente" ? "primary" : "ghost"}
          size="sm"
        >
          Cedente{qtdCedente ? ` (${qtdCedente})` : ""}
        </Button>
        <Button
          href={href({ foco: foco === "anexo" ? null : "anexo" })}
          variant={foco === "anexo" ? "primary" : "ghost"}
          size="sm"
        >
          Com anexo{qtdAnexo ? ` (${qtdAnexo})` : ""}
        </Button>
      </nav>

      {lista.length === 0 ? (
        <EmptyState
          icon="💬"
          title="Nenhuma conversa"
          description={
            /* A ORDEM DAS RAZÕES IMPORTA. Vazio por período é a causa mais
               provável agora que o padrão é 7 dias, e é a única que tem
               conserto de um clique. Dizer "nenhuma conversa" sem dizer "nesta
               janela" seria mentir por omissão para quem acabou de chegar. */
            ocultasPeriodo > 0
              ? `Nada nesta janela de tempo — ${ocultasPeriodo} ${ocultasPeriodo === 1 ? "conversa está" : "conversas estão"} fora dela.`
              : busca
                ? `Nada encontrado para “${busca}”. A busca cobre nome e telefone.`
                : "Nenhuma conversa encontrada com este filtro."
          }
          action={
            ocultasPeriodo > 0 ? (
              <Button href={href({ periodo: "tudo" })} variant="ghost" size="sm">
                Ver tudo
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* BLOCO 1 — A FILA. Sem cabeçalho de dia, de propósito: ver o desvio
              declarado no cabeçalho do arquivo. Quem espera resposta humana não
              pertence à linha do tempo; pertence ao topo, ordenado por espera. */}
          {fila.length > 0 ? (
            <section className={styles.grupo}>
              <h2 className={`${styles.separador} ${styles.separadorFila}`}>
                <span className={styles.separadorRotulo}>Esperando resposta</span>
                <span className={styles.separadorConta}>
                  {fila.length} {fila.length === 1 ? "conversa" : "conversas"}
                </span>
              </h2>
              <p className={styles.separadorNota}>
                Fora da linha do tempo abaixo, em ordem de espera — quem espera há mais tempo vem
                primeiro.
              </p>
              <ul className={areaStyles.list}>{fila.map(cartao)}</ul>
            </section>
          ) : null}

          {/* BLOCO 2 — O HISTÓRICO, por dia civil de Brasília. */}
          {historico.grupos.map((g) => (
            <section key={g.chave} className={styles.grupo}>
              <h2 className={styles.separador}>
                <span className={styles.separadorRotulo}>{g.rotulo}</span>
                <span className={styles.separadorConta}>
                  {g.itens.length} {g.itens.length === 1 ? "conversa" : "conversas"}
                </span>
              </h2>
              <ul className={areaStyles.list}>{g.itens.map(cartao)}</ul>
            </section>
          ))}

          {/* BLOCO 3 — SEM DATA. Não deveria existir, e é exatamente por isso
              que aparece: registro sem `ultimaEm` é defeito de dado, e defeito
              de dado escondido continua defeito. `agruparPorDia` devolve estes
              itens em vez de engoli-los; a tela devolve o favor. */}
          {historico.semData.length > 0 ? (
            <section className={styles.grupo}>
              <h2 className={styles.separador}>
                <span className={styles.separadorRotulo}>Sem data</span>
                <span className={styles.separadorConta}>
                  {historico.semData.length}{" "}
                  {historico.semData.length === 1 ? "conversa" : "conversas"}
                </span>
              </h2>
              <p className={styles.separadorNota}>
                Registro sem data de atividade legível — aparece aqui em qualquer período, inclusive
                nos filtrados, para não sumir da tela.
              </p>
              <ul className={areaStyles.list}>{historico.semData.map(cartao)}</ul>
            </section>
          ) : null}

          {/* O QUE O PERÍODO ESCONDEU, DITO EM NÚMERO. Um filtro que corta em
              silêncio faz o operador concluir "não tem" quando a resposta certa
              é "não tem NESTA janela". */}
          {ocultasPeriodo > 0 ? (
            <p className={styles.ocultas}>
              {ocultasPeriodo} {ocultasPeriodo === 1 ? "conversa está" : "conversas estão"} fora
              deste período e não {ocultasPeriodo === 1 ? "aparece" : "aparecem"} acima.{" "}
              <Link href={href({ periodo: "tudo" })}>Ver tudo</Link>.
            </p>
          ) : null}
        </>
      )}

      {/* Estados vazios com o MOTIVO. A OS: "campo sem fonte aparece vazio com
          o motivo — nunca preencher com suposição." Estes três não têm fonte
          hoje, e é melhor a tela dizer isso do que a etiqueta sumir calada. */}
      <p className={styles.rodapeMotivos}>
        <strong>O que esta tela ainda não sabe.</strong>{" "}
        <em>pago/orgânico</em>: `interesses.origem` existe mas guarda `&apos;chat&apos;` nas 41
        linhas — é o canal do próprio formulário, não atribuição de anúncio; `wa_conversas.referral`
        está vazio nas 27. <em>tem áudio</em>: `wa_mensagens` não tem coluna de tipo, e áudio cai no
        fallback vazio do webhook — só voltará com PROSPERITO-ANEXO-01. <em>anexo no site</em>:
        `mensagens.anexo` é nulo nas 426; o sinal &quot;com anexo&quot; só existe no WhatsApp
        (`media_id`, 14 mensagens).
      </p>
    </AppShell>
  );
}
