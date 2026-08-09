// ============================================================================
// /admin/farol/dashboard — a SALA DE CONTROLE do FAROL (PAINEL-DASHBOARD-01)
// AUTORIZADO: Emerson Gomes dos Santos — OS "PAINEL-DASHBOARD-01", 09/08/2026:
// "onde confiro tudo isso, colocar painel com dashboard e gráficos".
// ----------------------------------------------------------------------------
// DUAS TELAS, DE PROPÓSITO. `/admin/farol` é a tela de OPERAÇÃO: mostra hoje,
// tem botão, destrava reel, aprova pauta. Esta é a de LEITURA: janela de 30
// dias, nenhum botão, nenhuma ação. A OS separa as duas explicitamente ("o
// painel de hoje continua sendo a tela de operação; esta é a de leitura"), e a
// separação tem consequência prática: uma tela sem ação nenhuma pode ser olhada
// sem medo de clicar errado, e é a que se deixa aberta num monitor.
//
// O GATE É `exigirAdminConsolePagina()`, NÃO `exigirPapel("admin")`. Motivo
// escrito por extenso no header de lib/farol/painel.ts e vale igual aqui: os
// dados do FAROL moram no xtv, alcançados por service_role, onde a RLS não
// barra ninguém. A allowlist da aplicação (BIDCON_ADMIN_EMAILS) é a única
// barreira real desta tela.
//
// ZERO FETCH NO CLIENTE, por ordem da OS. Tudo é Server Component: as seis
// leituras acontecem no servidor, em paralelo, e o HTML chega pronto com o SVG
// dentro. Não há estado de carregamento porque não há carregamento.
//
// A REGRA DE HONESTIDADE NÃO É APLICADA AQUI — ELA JÁ VEIO PRONTA. Cada número
// desta tela chega como `Medida`, que ou tem valor ou tem o par
// (porque, destrava). A página não decide o que fazer com ausência: ela entrega
// a medida ao componente e o componente desenha o que a medida for. É por isso
// que não existe um `if` de "sem dados" em lugar nenhum deste arquivo.
//
// DESVIO VISUAL, declarado (o mesmo da fatia anterior, ver ../page.tsx item 5):
// a OS cita "navy #0A0E1A, IBM Plex Mono, Space Grotesk" — que são os tokens da
// LANDING, não os do portal logado. Esta tela usa os tokens do portal, que têm
// tema claro e tema de alto contraste. O ponto real do pedido ("Plex Mono nos
// números") está atendido por `--mono-painel` sem baixar webfont na área logada.
// ============================================================================
import Link from "next/link";
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  JANELA_DASHBOARD_DIAS,
  alertaRotacao,
  colunasPersona,
  funil,
  lerFontesDashboard,
  placarCusto,
  placarProducao,
  porPlataforma,
  precisaMostrarN,
  rankingFormulas,
  serieCanais,
  serieCusto,
  serieProducao,
} from "@/lib/farol/dashboard";
import {
  BarrasEmpilhadas,
  ComMedida,
  Funil,
  LinhaTemporal,
  Numerao,
  Vazio,
} from "./Graficos";
import s from "./dashboard.module.css";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Formatações
// ---------------------------------------------------------------------------
// Ficam aqui, e não em lib/, porque são decisões de APRESENTAÇÃO desta tela —
// quantas casas, qual símbolo. A régua de DATA, essa sim, vem de lib/data-br.ts
// (dentro de Graficos.tsx), porque fuso é verdade do sistema, não gosto de tela.

const inteiro = (v: number) => v.toLocaleString("pt-BR");
const porcento = (v: number) => `${(v * 100).toFixed(0)}%`;

/** US$ com 4 casas: o custo do mês medido é US$ 0,17 — 2 casas viraria "0,17". */
const dolar = (v: number) => `US$ ${v.toFixed(4)}`;

/**
 * Duração em linguagem de operador: "2h14", "18min", "42s".
 *
 * A mediana render→publicação medida hoje é de horas, mas o alvo são minutos.
 * Um formato só de minutos ("134min") esconde a ordem de grandeza justamente
 * no caso ruim, que é o caso que interessa.
 */
function duracao(ms: number): string {
  const seg = Math.round(ms / 1000);
  if (seg < 90) return `${seg}s`;
  const min = Math.round(seg / 60);
  if (min < 90) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Peças de layout
// ---------------------------------------------------------------------------

/**
 * O aviso de leitura falhada. Mesma peça do painel de operação: `role="alert"`
 * porque a falha de uma fonte muda o significado de tudo que está ao lado dela —
 * um gráfico zerado por erro de leitura é indistinguível de um gráfico zerado
 * por inatividade, e essa é a confusão que este aviso existe para evitar.
 */
function AvisoLeitura({ erro }: { erro: string | null }) {
  if (!erro) return null;
  return (
    <p className={s.erroLeitura} role="alert">
      Leitura falhou — {erro}
    </p>
  );
}

function Secao({
  titulo,
  fonte,
  children,
}: {
  titulo: string;
  fonte: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={s.secao}>
      <div className={s.secaoHead}>
        <h2 className={s.secaoTitulo}>{titulo}</h2>
        <p className={s.secaoFonte}>fonte: {fonte}</p>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

export default async function FarolDashboard() {
  const sessao = await exigirAdminConsolePagina();
  const db = createXtvClient();
  const dias = JANELA_DASHBOARD_DIAS;
  const agora = Date.now();

  const fontes = await lerFontesDashboard(db, dias);

  // --- Seção 1 — PRODUÇÃO ---------------------------------------------------
  const producao = serieProducao(fontes.posts.dados, fontes.reels.dados, dias, agora);
  const placar = placarProducao(producao, fontes.reels.dados, agora);
  const plataformas = porPlataforma(fontes.posts.dados, dias, agora);

  // --- Seção 2 — FUNIL ------------------------------------------------------
  const etapas = funil(fontes.conversas.dados, fontes.mensagens.dados);
  const canais = serieCanais(fontes.conversas.dados, dias, agora);

  // --- Seção 3 — FÔRMAS E PERSONAS -----------------------------------------
  const ranking = rankingFormulas(fontes.reels.dados, fontes.metricas.dados);
  const rotacao = alertaRotacao(ranking);
  const personas = colunasPersona(fontes.reels.dados, fontes.metricas.dados);

  // --- Seção 4 — CUSTO ------------------------------------------------------
  const custos = serieCusto(fontes.mensagens.dados, dias, agora);
  const pecasPublicadas = producao.reduce(
    (t, d) => t + d.postsPublicados + d.reelsPublicados,
    0
  );
  const placarDeCusto = placarCusto(
    custos,
    pecasPublicadas,
    fontes.conversas.dados.length,
    fontes.reels.dados
  );

  return (
    <AppShell nome={sessao.nome} tipo="admin">
      <PageHeader
        title="FAROL — sala de controle"
        subtitle={`Leitura de ${dias} dias. A máquina está ganhando?`}
      />

      <div className={s.pagina}>
        <div className={s.topo}>
          <p className={s.sub}>
            Esta tela só lê. Para disparar, destravar ou aprovar, use o painel de
            operação. Todo número traz o <code>n</code> ao lado quando é menor que
            10, e todo bloco sem fonte diz por que está vazio e o que o destrava.
          </p>
          <Link href="/admin/farol" className={s.linkIrmao}>
            ← painel de operação
          </Link>
        </div>

        {/* =================== 1 — PRODUÇÃO =================== */}
        <Secao
          titulo="1 · Produção"
          fonte={
            <>
              <code>farol_posts</code> + <code>farol_reels</code>, {dias} dias
            </>
          }
        >
          <AvisoLeitura erro={fontes.posts.erro} />
          <AvisoLeitura erro={fontes.reels.erro} />

          <BarrasEmpilhadas
            serie={producao}
            titulo="Publicações e falhas por dia"
            faixas={[
              { chave: "postsPublicados", rotulo: "posts publicados", cor: "var(--ok)" },
              { chave: "reelsPublicados", rotulo: "reels publicados", cor: "var(--brand)" },
              { chave: "falhas", rotulo: "falhas", cor: "var(--warn)" },
              { chave: "semInsumo", rotulo: "sem carta elegível", cor: "var(--border-strong)" },
            ]}
          />

          <div className={s.placar}>
            <Numerao rotulo="peças publicadas" medida={placar.publicadas} formata={inteiro} />
            <Numerao
              rotulo="taxa de sucesso"
              medida={placar.taxaSucesso}
              formata={porcento}
              rodape="publicado ÷ tentado"
            />
            <Numerao
              rotulo="mediana render→publicação"
              medida={placar.medianaRenderMs}
              formata={duracao}
              rodape="mediana, não média"
            />
            <Numerao
              rotulo="dias seguidos sem falha"
              medida={placar.diasSemFalha}
              formata={inteiro}
              rodape="dia sem produção não conta"
            />
          </div>

          <ComMedida medida={plataformas}>
            {(linhas, n) => (
              <div className={s.tabelaWrap}>
                <table className={s.tabela}>
                  <caption className={s.secaoFonte}>
                    O multiplicador da esteira: o mesmo mp4 em cada superfície.
                    {precisaMostrarN(n) && ` n=${n}`}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">plataforma</th>
                      <th scope="col" className={s.colNum}>
                        peças
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.plataforma}>
                        <td>{l.plataforma}</td>
                        <td className={s.colNum}>{inteiro(l.n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ComMedida>
        </Secao>

        {/* =================== 2 — FUNIL =================== */}
        <Secao
          titulo="2 · Funil — conteúdo vira negócio?"
          fonte={
            <>
              <code>wa_conversas</code> + <code>wa_mensagens</code>, {dias} dias
            </>
          }
        >
          <AvisoLeitura erro={fontes.conversas.erro} />
          <AvisoLeitura erro={fontes.mensagens.erro} />

          <Funil etapas={etapas} />

          <LinhaTemporal
            serie={canais}
            titulo="Conversas novas por dia, por canal"
            series={[
              { chave: "whatsapp", rotulo: "whatsapp", cor: "var(--ok)" },
              { chave: "instagram", rotulo: "instagram", cor: "var(--brand)" },
              { chave: "outro", rotulo: "outro canal", cor: "var(--text-muted)" },
            ]}
          />
        </Secao>

        {/* =================== 3 — FÔRMAS E PERSONAS =================== */}
        <Secao
          titulo="3 · Fôrmas e personas"
          fonte={
            <>
              <code>farol_reels.detalhe</code> (uso) + <code>farol_metricas</code>{" "}
              (desempenho)
            </>
          }
        >
          <AvisoLeitura erro={fontes.metricas.erro} />

          {ranking.length === 0 ? (
            <Vazio
              porque="nenhum reel tem `detalhe.formula` gravada"
              destrava="o reel-render já grava a fôrma quando há pauta ou FAROL_FORMULAS=on; os reels existentes nasceram antes disso"
            />
          ) : (
            <div className={s.tabelaWrap}>
              <table className={s.tabela}>
                <caption className={s.secaoFonte}>
                  Ordenado por índice. Sem métrica coletada, a ordem cai para o
                  número de peças.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">fôrma</th>
                    <th scope="col" className={s.colNum}>
                      peças
                    </th>
                    <th scope="col" className={s.colNum}>
                      retenção
                    </th>
                    <th scope="col" className={s.colNum}>
                      % não-seguidores
                    </th>
                    <th scope="col" className={s.colNum}>
                      índice
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r) => (
                    <tr key={r.formula}>
                      <td>{r.formula}</td>
                      <td className={s.colNum}>{inteiro(r.pecas)}</td>
                      <td className={s.colNum}>
                        {r.retencao.estado === "medido" ? porcento(r.retencao.valor) : "—"}
                      </td>
                      <td className={s.colNum}>
                        {r.pctNaoSeguidores.estado === "medido"
                          ? porcento(r.pctNaoSeguidores.valor)
                          : "—"}
                      </td>
                      <td className={s.colNum}>
                        {r.indice.estado === "medido" ? r.indice.valor.toFixed(2) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={s.secaoHead}>
            <h3 className={s.secaoTitulo}>Alerta de rotação</h3>
            <p className={s.secaoFonte}>
              As piores fôrmas com pelo menos 3 peças — candidatas a sair da
              rotação.
            </p>
          </div>
          <ComMedida medida={rotacao}>
            {(piores) => (
              <ul className={s.funil}>
                {piores.map((r) => (
                  <li key={r.formula} className={s.funilEtapa}>
                    <div className={s.funilCabeca}>
                      <span className={s.funilRotulo}>{r.formula}</span>
                      <span className={s.funilNumero}>
                        {r.indice.estado === "medido" ? r.indice.valor.toFixed(2) : "—"}
                        <span className={s.funilConversao}>{r.pecas} peças</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ComMedida>

          <div className={s.secaoHead}>
            <h3 className={s.secaoTitulo}>Porta-voz × Valentina</h3>
            <p className={s.secaoFonte}>
              O eixo é <code>detalhe.persona</code>. Atenção:{" "}
              <code>detalhe.avatar_tipo</code> não serve — seu único valor é{" "}
              <code>photo_avatar</code>, que é o tipo de avatar da HeyGen.
            </p>
          </div>
          <ComMedida medida={personas}>
            {(colunas) => (
              <div className={s.duasColunas}>
                {colunas.map((c) => (
                  <div key={c.persona} className={s.numeroBloco}>
                    <span className={s.numeroRotulo}>{c.persona}</span>
                    <span className={s.numeroValor}>
                      {inteiro(c.pecas)}
                      {precisaMostrarN(c.pecas) && (
                        <span className={s.numeroN}>peças</span>
                      )}
                    </span>
                    {c.indice.estado === "medido" ? (
                      <span className={s.numeroRodape}>
                        índice {c.indice.valor.toFixed(2)}
                      </span>
                    ) : (
                      <Vazio porque={c.indice.porque} destrava={c.indice.destrava} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </ComMedida>
        </Secao>

        {/* =================== 4 — CUSTO =================== */}
        <Secao
          titulo="4 · Custo"
          fonte={
            <>
              <code>wa_mensagens.tokens_in/out</code> × tabela de preço pública,{" "}
              {dias} dias
            </>
          }
        >
          <AvisoLeitura erro={fontes.mensagens.erro} />

          <BarrasEmpilhadas
            serie={custos}
            titulo="Custo estimado de IA por dia"
            faixas={[{ chave: "usd", rotulo: "US$ por dia", cor: "var(--brand)" }]}
          />

          <div className={s.placar}>
            <Numerao rotulo="custo do mês" medida={placarDeCusto.totalUsd} formata={dolar} />
            <Numerao
              rotulo="custo por peça"
              medida={placarDeCusto.porPeca}
              formata={dolar}
              rodape="custo do mês ÷ peças publicadas"
            />
            <Numerao
              rotulo="custo por lead"
              medida={placarDeCusto.porLead}
              formata={dolar}
              rodape="decide se a máquina se paga"
            />
            <Numerao
              rotulo="custo de render"
              medida={placarDeCusto.custoRender}
              formata={dolar}
            />
          </div>

          {/* Exigência explícita da OS: declarar que é estimativa, não fatura. */}
          <p className={s.rodapeEstimativa}>
            <strong>Isto é ESTIMATIVA, não fatura.</strong> O valor sai da
            contagem de tokens gravada em <code>wa_mensagens</code> multiplicada
            pela tabela de preço pública do <code>gpt-4o-mini</code> lida em
            09/08/2026 (US$ 0,15 por milhão de tokens de entrada, US$ 0,60 de
            saída). O <strong>custo de render</strong> é conta separada:
            duração medida do vídeo × US$ 0,05/s, com a duração gravada em{" "}
            <code>detalhe.duracao_s</code> desde 09/08/2026 — peças anteriores
            não têm e nunca terão, porque a duração era descartada na leitura.
            Os dois <em>não são somados</em>: o custo de token cobre a janela
            inteira e o de render começa no meio dela, e somar séries de
            coberturas diferentes daria um total que não descreve nem uma nem
            outra. Embeddings e pauta continuam sem medição alguma. Confira
            sempre contra a fatura do provedor.
          </p>
        </Secao>

        {/* =================== 5 — RADAR =================== */}
        <Secao
          titulo="5 · Radar de vídeos"
          fonte={
            <>
              <code>farol_videos</code>
            </>
          }
        >
          <AvisoLeitura erro={fontes.videosRadar.erro} />
          {fontes.videosRadar.dados > 0 ? (
            <p className={s.vazioDestrava}>
              {inteiro(fontes.videosRadar.dados)} vídeos no radar.{" "}
              <Link href="/admin/farol" className={s.linkIrmao}>
                ver no painel de operação
              </Link>
            </p>
          ) : (
            <Vazio
              porque="farol_videos está vazia: nada foi coletado ainda"
              destrava="depende do OLHEIRO-01 (varredura do YouTube por canal, com a flag FAROL_OLHEIRO); a tabela já existe, a coleta não"
            />
          )}
        </Secao>
      </div>
    </AppShell>
  );
}
