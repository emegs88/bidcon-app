// ============================================================================
// /admin/farol — PAINEL-FAROL-01 · painel de conteúdo dentro do portal
// AUTORIZADO: Emerson Gomes dos Santos — OS "PAINEL-FAROL-01", 08/08/2026:
// "painel de vídeos virais dentro da Bidcon, sendo disparado de lá".
// ----------------------------------------------------------------------------
// POR QUE ESTA TELA EXISTE: hoje toda operação do FAROL é curl com Bearer. Isso
// não delega (o segredo é a credencial, e credencial não se empresta) e não
// escala (o estado real mora em três tabelas que ninguém lê sem SQL). Aqui o
// operador vê o dia e age com a PRÓPRIA sessão — o segredo continua no
// servidor, onde sempre esteve.
//
// GATE: `exigirAdminConsolePagina()` (allowlist BIDCON_ADMIN_EMAILS), o MESMO
// de /admin/revisao, /admin/importar e /admin/conversas. NÃO é
// `exigirPapel("admin")`, e a diferença não é estilo: aquele vale para dados no
// nnv, onde a RLS por sessão é a barreira real. Os dados do FAROL moram no xtv,
// alcançados por service_role — ali a RLS não barra ninguém (service_role passa
// por cima), então a única barreira é esta, na aplicação. Usar o gate errado
// aqui seria trocar a barreira de verdade por uma que não se aplica.
//
// SERVER COMPONENT DE PONTA A PONTA. Nada do que esta tela lê passa pelo
// browser por conta própria: as três tabelas do FAROL têm RLS ligada e ZERO
// policy, então não existe caminho de chave anônima até elas. O HTML já sai
// pronto do servidor; o cliente só carrega os botões.
//
// ---------------------------------------------------------------------------
// DESVIO DECLARADO NO ITEM 5 DA OS (visual). A OS diz: "seguir o design system
// do portal (navy #0A0E1A, IBM Plex Mono nos números, Space Grotesk nos
// títulos)". MEDI as duas superfícies antes de escrever, e a parte entre
// parênteses descreve OUTRA:
//
//   portal (app.bidcon.com.br, esta tela)   site estático (bidcon.com.br)
//   -------------------------------------   ------------------------------
//   --bg #080b14 / --surface #10182b        navy #0A0E1A
//   --font: system-ui (app/globals.css)     Space Grotesk + IBM Plex Mono
//   --brand #36c5f0, tokens por [data-theme] paleta fixa
//
// Os três valores do parêntese são os tokens da landing — nenhum deles existe
// em `app/globals.css`, e nenhuma fonte web é carregada na área logada. Segui a
// ORDEM da OS ("seguir o design system do portal") e não o parêntese: usar
// #0A0E1A aqui deixaria esta tela com um fundo que nenhuma outra tela do admin
// tem, e importar duas fontes web na área logada custaria render-blocking numa
// área que hoje não paga esse preço — e quebraria o tema claro, que o portal
// suporta e a landing não.
//
// O QUE HONREI DO ESPÍRITO: número e identificador em monoespaçada, via
// `--mono-painel` (pilha do sistema, ui-monospace…), sem baixar webfont. Era o
// ponto real do "IBM Plex Mono nos números" — id de vídeo, container e post são
// para conferir caractere a caractere, e proporcional atrapalha isso.
// ============================================================================
import Link from "next/link";
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { reais, pctAoMes } from "@/lib/carrossel-formato";
import { dataHoraBR, diaBR } from "@/lib/data-br";
import { LABEL_TIPO_BEM } from "@/lib/status";
import {
  lerEstadoFarol,
  postDoDia,
  reelDoDia,
  pautaDoDia,
  reelTravado,
  JANELA_PAINEL_DIAS,
  type LinhaPauta,
  type LinhaPost,
  type LinhaReel,
} from "@/lib/farol/painel";
import { DisparosManuais, DestravarReel, PautaAcoes } from "./FarolAcoes";
import areaStyles from "@/components/area.module.css";
import styles from "./farol.module.css";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

// A `dataHora` local que ficava aqui foi APAGADA, não corrigida. Ela era
// `toLocaleString("pt-BR", {...})` sem `timeZone`, o que formata no fuso do
// PROCESSO — BRT na máquina de quem desenvolve, UTC na Vercel. A tela mostrava
// 14:00 num post das 11h00 (medido pelo Emerson em 09/08). Apagar em vez de
// corrigir é de propósito: enquanto existisse uma função de data local nesta
// tela, a próxima linha de tabela poderia chamá-la. Agora só existe
// `dataHoraBR`, e ela carrega o fuso junto. Ver lib/data-br.ts.

/** Régua de status do reel — as cinco do 0069, mais o desconhecido. */
function toneReel(status: string): { tone: "ok" | "info" | "amber" | "muted"; label: string } {
  if (status === "publicado") return { tone: "ok", label: "Publicado" };
  if (status === "falhou") return { tone: "amber", label: "Falhou" };
  if (status === "publicando") return { tone: "info", label: "Publicando" };
  if (status === "pronto") return { tone: "info", label: "Pronto" };
  if (status === "renderizando") return { tone: "muted", label: "Renderizando" };
  return { tone: "muted", label: status };
}

function tonePauta(status: string): { tone: "ok" | "info" | "amber" | "muted"; label: string } {
  if (status === "aprovada") return { tone: "ok", label: "Aprovada" };
  if (status === "usada") return { tone: "ok", label: "Usada no reel" };
  if (status === "aguardando_aprovacao") return { tone: "info", label: "Aguardando aprovação" };
  if (status === "nova") return { tone: "info", label: "Pronta (fluxo autônomo)" };
  if (status === "reprovada") return { tone: "amber", label: "Reprovada pelo linter" };
  if (status === "reprovada_humano") return { tone: "amber", label: "Reprovada por humano" };
  return { tone: "muted", label: status };
}

/** Campo de identificador: monoespaçado e quebrável, para conferência visual. */
function Id({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div className={styles.campo}>
      <span className={styles.campoRotulo}>{rotulo}</span>
      <span className={styles.campoValorMono}>{valor || "—"}</span>
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className={styles.campo}>
      <span className={styles.campoRotulo}>{rotulo}</span>
      <span className={styles.campoValor}>{valor ?? "—"}</span>
    </div>
  );
}

function AvisoLeitura({ erro }: { erro: string | null }) {
  if (!erro) return null;
  return (
    <p className={styles.erroLeitura} role="alert">
      Leitura falhou — {erro}
    </p>
  );
}

/** Descrição da carta, a partir do `detalhe` que a própria rota gravou. */
function descreverCarta(det: { tipo?: string; credito?: number; administradora?: string } | null) {
  if (!det) return "—";
  const label = LABEL_TIPO_BEM[det.tipo ?? ""] ?? "Carta";
  const partes = [label];
  if (typeof det.credito === "number") partes.push(reais(det.credito));
  if (det.administradora) partes.push(det.administradora);
  return partes.join(" · ");
}

// ---------------------------------------------------------------------------
// Cards do dia
// ---------------------------------------------------------------------------

function CardPost({ linha, erro }: { linha: LinhaPost | null; erro: string | null }) {
  const det = linha?.detalhe ?? null;
  const publicado = linha?.acao === "post_publicado";
  return (
    <Card>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitulo}>Post do dia</h2>
        {linha ? (
          <Badge tone={publicado ? "ok" : "amber"}>{publicado ? "Publicado" : "Falhou"}</Badge>
        ) : (
          <Badge tone="muted">Sem registro hoje</Badge>
        )}
      </div>
      <AvisoLeitura erro={erro} />
      {!linha ? (
        <p className={styles.vazio}>Nenhuma tentativa de post registrada para hoje.</p>
      ) : (
        <div className={styles.campos}>
          <Campo rotulo="Carta" valor={descreverCarta(det)} />
          <Campo rotulo="Custo" valor={pctAoMes(det?.custo_am ?? null)} />
          <Campo rotulo="Escolha" valor={det?.escolha ?? "—"} />
          <Id rotulo="post_id" valor={linha.post_id} />
          <Campo rotulo="Quando" valor={dataHoraBR(linha.criado_em)} />
          {det?.erro && <Campo rotulo="Erro" valor={<span className={styles.textoErro}>{det.erro}</span>} />}
          {linha.post_id && (
            <div className={styles.campo}>
              <span className={styles.campoRotulo}>No Instagram</span>
              <Button
                href={`https://www.instagram.com/p/${linha.post_id}/`}
                variant="link"
                size="sm"
                target="_blank"
                rel="noopener noreferrer"
              >
                abrir post
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function CardReel({ linha, erro }: { linha: LinhaReel | null; erro: string | null }) {
  const det = linha?.detalhe ?? null;
  const t = linha ? toneReel(linha.status) : null;
  const travado = linha ? reelTravado(linha) : false;

  return (
    <Card>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitulo}>Reel do dia</h2>
        {t ? <Badge tone={t.tone}>{t.label}</Badge> : <Badge tone="muted">Sem registro hoje</Badge>}
      </div>
      <AvisoLeitura erro={erro} />
      {!linha ? (
        <p className={styles.vazio}>Nenhum render registrado para hoje.</p>
      ) : (
        <>
          {/* O mp4 hospedado é a prova visual mais barata de que o vídeo existe
              e não está corrompido — vale mais que qualquer campo desta lista.
              `preload="metadata"` para a tela não baixar dezenas de MB só por
              ser aberta. */}
          {det?.url_hospedada && (
            <video className={styles.preview} src={det.url_hospedada} controls preload="metadata" />
          )}
          <div className={styles.campos}>
            <Campo rotulo="Carta" valor={descreverCarta(det)} />
            <Campo rotulo="Custo" valor={pctAoMes(det?.custo_am ?? null)} />
            <Campo
              rotulo="Texto"
              valor={det?.formula ? `pauta · fôrma ${det.formula}` : (det?.fonte_texto ?? "—")}
            />
            <Id rotulo="video_id (HeyGen)" valor={linha.video_id} />
            <Id rotulo="container_id (Meta)" valor={linha.container_id} />
            <Id rotulo="post_id (Instagram)" valor={linha.post_id} />
            <Id rotulo="yt_video_id (YouTube)" valor={det?.yt_video_id} />
            <Id rotulo="tt_publish_id (TikTok)" valor={det?.tt_publish_id} />
            <Campo rotulo="Criada" valor={dataHoraBR(linha.criado_em)} />
            <Campo rotulo="Última mexida" valor={dataHoraBR(linha.atualizado_em)} />
            {linha.erro && (
              <Campo rotulo="Erro" valor={<span className={styles.textoErro}>{linha.erro}</span>} />
            )}
          </div>

          {/* "Destravar" só aparece para linha que está mesmo parada e presa a
              um container. Oferecer o botão numa linha saudável convidaria a
              jogar fora um container que ia publicar. */}
          {travado && linha.container_id && (
            <>
              <p className={styles.aviso}>
                Esta linha está em <strong>{linha.status}</strong> e não se move há mais de 30
                minutos.
              </p>
              <DestravarReel reelId={linha.id} containerId={linha.container_id} />
            </>
          )}
        </>
      )}
    </Card>
  );
}

function CardPauta({
  linha,
  erro,
  aprovacaoLigada,
}: {
  linha: LinhaPauta | null;
  erro: string | null;
  aprovacaoLigada: boolean;
}) {
  const t = linha ? tonePauta(linha.status) : null;
  // A decisão humana só faz sentido enquanto a pauta está esperando. Depois de
  // 'usada' o reel já foi renderizado com aquele texto — ver as transições
  // legais no header da rota.
  const decidivel =
    !!linha && (linha.status === "aguardando_aprovacao" || linha.status === "nova");

  return (
    <Card>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitulo}>Pauta do dia</h2>
        {t ? <Badge tone={t.tone}>{t.label}</Badge> : <Badge tone="muted">Sem pauta hoje</Badge>}
      </div>
      <AvisoLeitura erro={erro} />

      {!aprovacaoLigada && (
        <p className={styles.aviso}>
          Aprovação humana <strong>desarmada</strong> (<code>FAROL_PAUTA_APROVA</code> ≠{" "}
          <code>on</code>): a pauta nasce pronta e o reel a consome sozinho. Os botões abaixo
          continuam valendo para decidir uma pauta manualmente.
        </p>
      )}

      {!linha ? (
        <p className={styles.vazio}>
          Nenhuma pauta escrita para hoje. Sem pauta, o reel usa o texto de template.
        </p>
      ) : (
        <>
          <div className={styles.campos}>
            <Campo rotulo="Fôrma" valor={linha.formula} />
            <Campo rotulo="Gancho" valor={linha.gancho ?? "—"} />
            {linha.motivo_linter && (
              <Campo
                rotulo="Motivo"
                valor={<span className={styles.textoErro}>{linha.motivo_linter}</span>}
              />
            )}
          </div>

          <div className={styles.texto}>
            <h3 className={styles.subtitulo}>Roteiro falado</h3>
            <p className={styles.corpoTexto}>{linha.roteiro ?? "—"}</p>
            <h3 className={styles.subtitulo}>Legenda escrita</h3>
            <p className={styles.corpoTexto}>{linha.legenda ?? "—"}</p>
            {linha.hashtags && linha.hashtags.length > 0 && (
              <p className={styles.hashtags}>{linha.hashtags.join(" ")}</p>
            )}
          </div>

          {/* FONTES: a auditoria de ORIGEM que a 0071 existe para permitir. O
              agente extrai estrutura e nunca copia texto; guardar o que ele leu
              é o que torna essa afirmação verificável meses depois. */}
          <div className={styles.texto}>
            <h3 className={styles.subtitulo}>
              Fontes da pesquisa ({linha.fontes?.length ?? 0})
            </h3>
            {!linha.fontes || linha.fontes.length === 0 ? (
              <p className={styles.vazio}>Nenhuma fonte registrada.</p>
            ) : (
              <ul className={styles.fontes}>
                {linha.fontes.map((f, i) => (
                  <li key={i}>
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noopener noreferrer">
                        {f.titulo || f.url}
                      </a>
                    ) : (
                      (f.titulo ?? "(sem título)")
                    )}
                    {f.tema && <span className={styles.tema}> · {f.tema}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {decidivel && (
            <PautaAcoes
              pautaId={linha.id}
              roteiroAtual={linha.roteiro ?? ""}
              legendaAtual={linha.legenda ?? ""}
            />
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

type LinhaHistorico = {
  chave: string;
  dia: string;
  quando: string;
  o_que: string;
  estado: { tone: "ok" | "info" | "amber" | "muted"; label: string };
  detalhe: string;
  motivo: string | null;
};

/**
 * Funde as três tabelas numa linha do tempo só. O operador pergunta "o que
 * aconteceu no dia 6?", não "o que a tabela farol_reels diz sobre o dia 6" —
 * três tabelas lado a lado obrigariam ele a fazer o join com o olho.
 */
function montarHistorico(
  posts: LinhaPost[],
  reels: LinhaReel[],
  pautas: LinhaPauta[]
): LinhaHistorico[] {
  const linhas: LinhaHistorico[] = [];

  for (const p of posts) {
    // 'disparo_manual' e as decisões de pauta também vivem em farol_posts: são
    // eventos de operação, e o histórico é justamente o lugar de vê-los ao lado
    // do que a máquina fez sozinha.
    const manual = p.acao.startsWith("disparo_") || p.acao.startsWith("pauta_") || p.acao === "reel_destravado";
    const ok = p.acao.endsWith("_publicado") || p.acao === "pauta_escrita" || p.acao.endsWith("_aprovada");
    linhas.push({
      chave: `post-${p.id}`,
      // `detalhe.data` já vem em data civil de São Paulo (a rotina grava com
      // `hojeSP()`). A QUEDA é que estava em outro fuso: `criado_em.slice(0,10)`
      // corta o ISO, que é UTC. As duas metades da mesma coluna discordavam
      // entre 21h e meia-noite — a linha com `detalhe.data` caía no dia certo e
      // a linha sem ele caía no dia seguinte. `diaBR` põe as duas na mesma régua.
      dia: p.detalhe?.data ?? diaBR(p.criado_em) ?? "—",
      quando: p.criado_em,
      o_que: manual ? "Operação" : "Post",
      estado: {
        tone: ok ? "ok" : p.acao.endsWith("_falhou") ? "amber" : "muted",
        label: p.acao,
      },
      detalhe: descreverCarta(p.detalhe),
      motivo: p.detalhe?.erro ?? p.detalhe?.motivo ?? null,
    });
  }

  for (const r of reels) {
    const t = toneReel(r.status);
    linhas.push({
      chave: `reel-${r.id}`,
      dia: r.detalhe?.data ?? diaBR(r.criado_em) ?? "—",
      quando: r.atualizado_em ?? r.criado_em,
      o_que: "Reel",
      estado: t,
      detalhe: descreverCarta(r.detalhe),
      motivo: r.erro,
    });
  }

  for (const pa of pautas) {
    const t = tonePauta(pa.status);
    linhas.push({
      chave: `pauta-${pa.id}`,
      dia: pa.dia,
      quando: pa.criado_em,
      o_que: "Pauta",
      estado: t,
      detalhe: `fôrma ${pa.formula}`,
      motivo: pa.motivo_linter,
    });
  }

  return linhas.sort((a, b) => (a.quando < b.quando ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default async function AdminFarol() {
  const sessao = await exigirAdminConsolePagina();
  const db = createXtvClient();
  const estado = await lerEstadoFarol(db);

  const post = postDoDia(estado.posts.dados, estado.hoje);
  const reel = reelDoDia(estado.reels.dados, estado.hoje);
  const pauta = pautaDoDia(estado.pautas.dados, estado.hoje);

  const historico = montarHistorico(
    estado.posts.dados,
    estado.reels.dados,
    estado.pautas.dados
  );

  // Fila de pautas esperando decisão — inclusive de dias anteriores. Pauta
  // esquecida de anteontem é exatamente o que este bloco existe para mostrar.
  const aguardando = estado.pautas.dados.filter(
    (p) => p.status === "aguardando_aprovacao" && p.dia !== estado.hoje
  );

  // TODA linha travada da janela, não só a de hoje. O card "Reel do dia" mostra
  // uma linha só — a de hoje —, e foi exatamente uma linha PRESA DE ONTEM que o
  // operador destravou à mão. Se o botão só existisse no card do dia, a fatia
  // teria entregue o gesto errado: o caso que motivou a OS ficaria de fora.
  // Ainda dentro das 24h, essas linhas continuam sendo varridas pela fase 2 e
  // podem publicar; passadas as 24h elas viram 'falhou' sozinhas e saem daqui.
  const travadas = estado.reels.dados.filter((r) => reelTravado(r) && r.container_id);

  const armado = process.env.FAROL_REEL === "on";

  return (
    <AppShell nome={sessao.nome} tipo="admin">
      <PageHeader
        title="FAROL — conteúdo"
        subtitle={`Post, reel e pauta do dia, disparos manuais e os últimos ${JANELA_PAINEL_DIAS} dias. Tudo roda com a sua sessão: nenhum segredo passa pelo navegador.`}
      />

      <div className={areaStyles.stack}>
        <section className={areaStyles.section}>
          <div className={areaStyles.sectionHead}>
            <h2 className={areaStyles.sectionTitle}>Hoje · {estado.hoje}</h2>
            <span className={areaStyles.count}>
              {armado ? "FAROL armado" : "FAROL desarmado"}
            </span>
          </div>
          {/* O link recíproco pedido pela OS. Fica JUNTO dos cards de hoje, e
              não perdido no rodapé, porque a pergunta "e no mês, como foi?"
              nasce exatamente aqui — olhando o dia e querendo o contexto. */}
          <p className={styles.linkIrmao}>
            <Link href="/admin/farol/dashboard">
              sala de controle — leitura de 30 dias, gráficos e custo →
            </Link>
          </p>
          <div className={styles.grid3}>
            <CardPost linha={post} erro={estado.posts.erro} />
            <CardReel linha={reel} erro={estado.reels.erro} />
            <CardPauta
              linha={pauta}
              erro={estado.pautas.erro}
              aprovacaoLigada={estado.aprovacaoLigada}
            />
          </div>
        </section>

        {aguardando.length > 0 && (
          <section className={areaStyles.section}>
            <div className={areaStyles.sectionHead}>
              <h2 className={areaStyles.sectionTitle}>Pautas de outros dias aguardando decisão</h2>
              <span className={areaStyles.count}>{aguardando.length}</span>
            </div>
            <div className={styles.grid3}>
              {aguardando.map((p) => (
                <CardPauta
                  key={p.id}
                  linha={p}
                  erro={null}
                  aprovacaoLigada={estado.aprovacaoLigada}
                />
              ))}
            </div>
          </section>
        )}

        {travadas.length > 0 && (
          <section className={areaStyles.section}>
            <div className={areaStyles.sectionHead}>
              <h2 className={areaStyles.sectionTitle}>Linhas travadas</h2>
              <span className={areaStyles.count}>{travadas.length}</span>
            </div>
            <Card>
              <p className={styles.aviso}>
                Linhas em estado vivo, presas a um container e sem movimento há mais de 30
                minutos. Destravar abandona o container e devolve a linha ao fluxo
                automático — não apaga nada e não publica.
              </p>
              <div className={styles.campos}>
                {travadas.map((r) => (
                  <div key={r.id} className={styles.travada}>
                    <div className={styles.campos}>
                      <Campo rotulo="Estado" valor={toneReel(r.status).label} />
                      <Campo rotulo="Dia" valor={r.detalhe?.data ?? diaBR(r.criado_em) ?? "—"} />
                      <Id rotulo="video_id" valor={r.video_id} />
                      <Id rotulo="container_id" valor={r.container_id} />
                      <Campo rotulo="Última mexida" valor={dataHoraBR(r.atualizado_em)} />
                    </div>
                    <DestravarReel reelId={r.id} containerId={r.container_id as string} />
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        <section className={areaStyles.section}>
          <div className={areaStyles.sectionHead}>
            <h2 className={areaStyles.sectionTitle}>Disparos manuais</h2>
          </div>
          <Card>
            <p className={styles.aviso}>
              Cada disparo executa exatamente o mesmo código do cron — não uma versão
              paralela dele. O segredo do FAROL é injetado no servidor; o navegador nunca o
              vê. Todo disparo fica registrado com o seu e-mail e o horário.
            </p>
            <DisparosManuais armado={armado} />
          </Card>
        </section>

        <section className={areaStyles.section}>
          <div className={areaStyles.sectionHead}>
            <h2 className={areaStyles.sectionTitle}>
              Últimos {JANELA_PAINEL_DIAS} dias
            </h2>
            <span className={areaStyles.count}>{historico.length} eventos</span>
          </div>
          {historico.length === 0 ? (
            <EmptyState
              title="Nada registrado na janela"
              description="Nenhum post, reel ou pauta nos últimos dias."
            />
          ) : (
            <div className={styles.tabelaWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th scope="col">Dia</th>
                    <th scope="col">Hora</th>
                    <th scope="col">O quê</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Detalhe</th>
                    <th scope="col">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((l) => (
                    <tr key={l.chave}>
                      <td className={styles.colMono}>{l.dia}</td>
                      <td className={styles.colMono}>{dataHoraBR(l.quando)}</td>
                      <td>{l.o_que}</td>
                      <td>
                        <Badge tone={l.estado.tone}>{l.estado.label}</Badge>
                      </td>
                      <td>{l.detalhe}</td>
                      <td className={styles.colMotivo}>
                        {l.motivo ? <span className={styles.textoErro}>{l.motivo}</span> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
