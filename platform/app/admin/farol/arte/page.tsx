// ============================================================================
// /admin/farol/arte — FAROL-ARTE-01 passo 4 · curadoria do acervo de fundos
// AUTORIZADO: Emerson Gomes dos Santos — FAROL-ARTE-01, 09/08/2026:
//   "4. Painel de curadoria com confirmação nominal APROVAR."
// ----------------------------------------------------------------------------
// POR QUE ESTA TELA EXISTE. A migração 0076 grava no schema que `aprovada` é
// escrito só por um humano, e que NADA no código automatiza essa transição. Uma
// regra assim só é verdade se existir o lugar onde o humano cumpre a parte
// dele. Sem esta tela, "aprovada" viraria UPDATE manual no SQL editor — que é a
// forma mais barata de aprovar a arte errada às 23h.
//
// TELA SEPARADA, e não uma seção do /admin/farol. Duas medições sustentam isso:
// a página principal já tem 616 linhas e três blocos que competem por atenção;
// e curadoria é trabalho em lote, com imagem grande, feito de vez em quando —
// não é o "o que o FAROL fez hoje?" que a tela principal responde todo dia.
//
// GATE: `exigirAdminConsolePagina()` — o MESMO de /admin/farol, /admin/revisao
// e /admin/conversas. Os dados do FAROL moram no xtv, onde a barreira é a
// allowlist, não RLS por sessão.
//
// A FAIXA DO MIOLO DESENHADA POR CIMA DA PREVIEW é a parte não óbvia desta
// tela, e ela vem de uma medição de 09/08: montados os dois cards reais, a arte
// pagou no story e quase sumiu no feed, porque o quadrado só enxerga
// y=448…1600 de 2048. Quem cura olhando a imagem inteira aprova pelo topo — e
// o topo é exatamente o que o recorte descarta. Então a tela marca a área de
// sacrifício em vez de confiar que o curador lembre da aritmética.
//
// NOTA DE ESCOPO (decisão de 09/08): "ARTE É DO STORY. O feed fica no card de
// hoje até prova em contrário." Isso NÃO está travado no código — o card
// continua sabendo receber `?arte=` nos dois formatos, porque a decisão 3 da
// mesma ordem manda montar um feed de teste com uma das artes novas. Quem
// escolhe é o chamador, passando `?arte=` só no story. Se a prova em contrário
// não vier, o lugar de travar é o chamador, não esta tela.
// ============================================================================
import Link from "next/link";
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { BUCKET_ARTES } from "@/lib/farol-arte";
import { dataHoraBR } from "@/lib/data-br";
import { CuradoriaAcoes } from "./CuradoriaAcoes";
import styles from "../farol.module.css";
import arte from "./arte.module.css";

export const dynamic = "force-dynamic";

type Linha = {
  id: string;
  caminho: string;
  largura: number;
  altura: number;
  prompt: string | null;
  modelo: string | null;
  qualidade: string | null;
  custo_usd: string | number | null;
  status: string;
  aprovado_por: string | null;
  aprovado_em: string | null;
  motivo: string | null;
  usos: number;
  criado_em: string;
};

/** `$` só quando houver número MEDIDO. Nulo é "não medido", nunca "de graça". */
function custo(v: string | number | null): string {
  if (v === null || v === undefined) return "não medido";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? `US$ ${n.toFixed(4)}` : "não medido";
}

export default async function CuradoriaArte() {
  await exigirAdminConsolePagina();

  const db = createXtvClient();

  // Coluna a coluna, como manda a casa para service-role.
  const { data, error } = await db
    .from("farol_arte")
    .select(
      "id, caminho, largura, altura, prompt, modelo, qualidade, custo_usd, status, aprovado_por, aprovado_em, motivo, usos, criado_em"
    )
    .order("status", { ascending: true })
    .order("criado_em", { ascending: true })
    .limit(60);

  // A migração 0076 é file-first: a coordenação a aplica. Enquanto ela não for
  // aplicada, esta tela tem de DIZER isso, e não estourar 500 — um 500 aqui
  // pareceria bug do painel quando o fato é "a tabela ainda não existe".
  if (error) {
    return (
      <main className={styles.grid}>
        <h1 className={styles.cardTitulo}>Curadoria de arte</h1>
        <p className={styles.erroLeitura}>
          Não consegui ler <code>farol_arte</code>: {error.message}
        </p>
        <p className={styles.aviso}>
          Se a mensagem fala em relação inexistente, a migração{" "}
          <code>0076_farol_arte.sql</code> ainda não foi aplicada no xtv. Ela é
          file-first — a coordenação aplica.
        </p>
        <p>
          <Link className={styles.linkIrmao} href="/admin/farol">
            ← voltar ao painel do FAROL
          </Link>
        </p>
      </main>
    );
  }

  const linhas = (data ?? []) as Linha[];
  const pendentes = linhas.filter((l) => l.status === "pendente");
  const curadas = linhas.filter((l) => l.status !== "pendente");

  // `getPublicUrl` é montagem de string — não fala com a rede, então listar 60
  // artes não custa 60 requisições.
  const url = (caminho: string) =>
    db.storage.from(BUCKET_ARTES).getPublicUrl(caminho).data.publicUrl;

  return (
    <main className={styles.grid}>
      <div className={styles.cardHead}>
        <h1 className={styles.cardTitulo}>Curadoria de arte</h1>
        <p className={styles.subtitulo}>
          O modelo pinta fundo, textura e luz. Nenhum número, letra, percentual,
          logotipo ou nome de administradora pode aparecer — quem escreve número
          é o gerador determinístico, por cima do véu navy de 78%.
        </p>
        <p>
          <Link className={styles.linkIrmao} href="/admin/farol">
            ← painel do FAROL
          </Link>
        </p>
      </div>

      <section>
        <h2 className={styles.cardTitulo}>Pendentes ({pendentes.length})</h2>
        <p className={arte.legendaFaixa}>
          As tarjas marcam a área de sacrifício: o card quadrado só enxerga a
          faixa clara do meio (y 448–1600 de 2048). Julgue por ela.
        </p>

        {pendentes.length === 0 ? (
          <p className={styles.vazio}>Nada pendente. O acervo está curado.</p>
        ) : (
          <div className={arte.fila}>
            {pendentes.map((l) => (
              <article key={l.id} className={arte.item}>
                <div className={arte.moldura}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url(l.caminho)} alt="" />
                  <div className={`${arte.sacrificio} ${arte.sacrificioTopo}`} />
                  <div className={`${arte.sacrificio} ${arte.sacrificioBase}`} />
                </div>

                <p className={arte.meta}>
                  {l.largura}×{l.altura} · {l.modelo ?? "modelo?"} ·{" "}
                  {l.qualidade ?? "qualidade?"} · {custo(l.custo_usd)}
                  <br />
                  <code>{l.caminho}</code>
                  <br />
                  gerada em {dataHoraBR(l.criado_em)}
                </p>

                <CuradoriaAcoes id={l.id} />
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className={styles.cardTitulo}>Já curadas ({curadas.length})</h2>
        {curadas.length === 0 ? (
          <p className={styles.vazio}>Nenhuma arte curada ainda.</p>
        ) : (
          <div className={styles.tabelaWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Arquivo</th>
                  <th>Usos</th>
                  <th>Por</th>
                  <th>Quando</th>
                  <th className={styles.colMotivo}>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {curadas.map((l) => (
                  <tr key={l.id}>
                    <td>{l.status}</td>
                    <td className={styles.colMono}>{l.caminho}</td>
                    <td>{l.usos}</td>
                    <td>{l.aprovado_por ?? "—"}</td>
                    <td>{l.aprovado_em ? dataHoraBR(l.aprovado_em) : "—"}</td>
                    <td className={styles.colMotivo}>{l.motivo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
