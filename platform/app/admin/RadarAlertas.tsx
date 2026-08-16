// ============================================================================
// Bloco do RADAR no painel — SENTINELA-RADAR-01, Parte 2
// AUTORIZADO: Emerson, 15/08/2026.
// ----------------------------------------------------------------------------
// Server Component. Lê `radar_alertas` em XTV por service_role, coluna a
// coluna. A guarda é a da página: `/admin/page.tsx` já chamou
// `exigirPapel("admin")` antes de montar isto.
//
// ----------------------------------------------------------------------------
// TRÊS SILÊNCIOS DIFERENTES, E O BLOCO PRECISA SABER QUAL É QUAL
//
// Este é o ponto inteiro do componente, e é o mesmo defeito que criou o RADAR:
// tela vazia parece boa notícia.
//
//   1. "Nada aberto"      — o RADAR mediu e não achou nada. BOA notícia.
//   2. "Tabela não existe" — a migração 0082 não foi aplicada. O RADAR não
//                            existe ainda. NÃO é boa notícia, e é o estado de
//                            hoje enquanto o Emerson não autoriza o apply.
//   3. "Erro ao ler"       — o banco respondeu outra coisa. Também não é boa
//                            notícia.
//
// Os três produziriam a MESMA tela num componente descuidado: nenhum alerta
// listado. Aqui cada um tem sua frase. Se algum dia esta distinção for
// removida "para simplificar", o painel volta a mentir por omissão.
//
// ----------------------------------------------------------------------------
// POR QUE ESTE BLOCO NÃO PODE DERRUBAR /admin
//
// `/admin` é a página que o Emerson abre primeiro. Um `throw` aqui apagaria os
// cartões, a balança e o ranking por causa de uma tabela de alertas. Seria
// trocar um problema pequeno e visível por um grande e mudo. Por isso toda
// falha vira texto na tela, nunca exceção.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import styles from "./painel.module.css";

/** Teto de linhas mostradas. Se passar disso, o painel diz quantas sobraram. */
const TETO_LINHAS = 12;

type LinhaAlerta = {
  id: string;
  tipo: string;
  chave: string;
  severidade: string;
  titulo: string;
  ocorrencias: number;
  primeira_vez: string;
  ultima_vez: string;
};

/** Postgres 42P01 = undefined_table. É como a ausência da 0082 se apresenta. */
function tabelaAusente(codigo: string | undefined, mensagem: string): boolean {
  if (codigo === "42P01") return true;
  return /does not exist|could not find the table/i.test(mensagem);
}

function desde(iso: string, agora: Date): string {
  const ms = agora.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "agora";
  const horas = Math.floor(ms / 3_600_000);
  if (horas < 1) return "há menos de 1h";
  if (horas < 48) return `há ${horas}h`;
  return `há ${Math.floor(horas / 24)} dias`;
}

export async function RadarAlertas() {
  const db = createXtvClient();
  const { data, error } = await db
    .from("radar_alertas")
    .select("id, tipo, chave, severidade, titulo, ocorrencias, primeira_vez, ultima_vez")
    .is("resolvido_em", null)
    // Grave antes de aviso: 'grave' < 'aviso' é falso alfabeticamente, então a
    // ordenação é explícita abaixo, na memória. Aqui só o recente primeiro.
    .order("ultima_vez", { ascending: false })
    .limit(TETO_LINHAS + 1);

  if (error) {
    const ausente = tabelaAusente(error.code, error.message ?? "");
    return (
      <Card as="section">
        <div className={styles.alerta}>
          <Badge tone="muted">RADAR</Badge>
          <span className={styles.alertaTexto}>
            {ausente ? (
              <>
                A tabela <code>radar_alertas</code> ainda não existe neste banco — a
                migração <code>0082</code> não foi aplicada. <b>Isto não quer dizer que
                está tudo bem:</b> quer dizer que ninguém está vigiando.
              </>
            ) : (
              <>
                Não consegui ler os alertas do RADAR. <b>Ausência de alerta aqui não é
                ausência de problema.</b> Motivo: {error.message}
              </>
            )}
          </span>
        </div>
      </Card>
    );
  }

  const linhas = (data ?? []) as LinhaAlerta[];
  if (linhas.length === 0) {
    return (
      <Card as="section">
        <div className={styles.alerta} aria-live="polite">
          <Badge tone="ok">RADAR</Badge>
          <span className={styles.alertaTexto}>
            Nenhum alerta aberto. As cinco condições foram medidas e nenhuma disparou.
          </span>
        </div>
      </Card>
    );
  }

  const graves = linhas.filter((l) => l.severidade === "grave");
  const avisos = linhas.filter((l) => l.severidade !== "grave");
  const ordenadas = [...graves, ...avisos].slice(0, TETO_LINHAS);
  const sobrando = linhas.length - ordenadas.length;
  const agora = new Date();

  return (
    <Card as="section">
      <div className={styles.vizHead}>
        <h2 className={styles.vizTitulo}>
          RADAR — {linhas.length} condição(ões) aberta(s)
          {graves.length > 0 ? `, ${graves.length} grave(s)` : ""}
        </h2>
      </div>
      <ul className={styles.radarLista}>
        {ordenadas.map((l) => (
          <li key={l.id} className={styles.radarItem}>
            <Badge tone={l.severidade === "grave" ? "amber" : "muted"}>
              {l.severidade === "grave" ? "Grave" : "Aviso"}
            </Badge>
            <div className={styles.radarCorpo}>
              <span className={styles.radarTitulo}>{l.titulo}</span>
              <span className={styles.radarMeta}>
                <code>
                  {l.tipo}/{l.chave}
                </code>
                {" · aberta "}
                {desde(l.primeira_vez, agora)}
                {/* Ocorrências é o que separa "aconteceu uma vez" de "acontece
                    toda varredura há dias" — sem isso, um alerta por condição
                    esconderia justamente a insistência. */}
                {l.ocorrencias > 1 ? ` · ${l.ocorrencias} varreduras` : ""}
                {" · vista "}
                {desde(l.ultima_vez, agora)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {sobrando > 0 ? (
        <p className={styles.radarMeta}>
          e mais {sobrando} — o corte é em {TETO_LINHAS}, não é o total.
        </p>
      ) : null}
    </Card>
  );
}
