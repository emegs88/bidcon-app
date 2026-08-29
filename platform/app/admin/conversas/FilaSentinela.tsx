// ============================================================================
// Bloco da fila do Sentinela — SENTINELA-RADAR-01, item 1.4
// AUTORIZADO: Emerson, 15/08/2026: "quantas na fila, por status, a mais antiga
// e o motivo. Fila invisível é fila morta."
// ----------------------------------------------------------------------------
// Server Component. Lê `sentinela_fila` em XTV por service_role, coluna a
// coluna. A guarda é a da página: `/admin/conversas` já exigiu a sessão da
// equipe antes de montar isto.
//
// ----------------------------------------------------------------------------
// ESTE CABEÇALHO MENTIU POR TREZE DIAS — LEIA ISTO ANTES DE CONFIAR NELE
//
// Até 29/08/2026 estas linhas afirmavam, em caixa alta, que `sentinela_fila`
// tinha treze colunas, que `max_toques` NÃO estava entre elas e que "a migração
// 0081 existe em arquivo e NÃO foi aplicada".
//
// Medi a tabela em 29/08: são DEZESSETE colunas, e `max_toques` é uma delas
// (`smallint NOT NULL default 2`). A 0081 foi aplicada. As outras três que o
// cabeçalho não conhecia: `falhas_consecutivas`, `max_falhas`, `ultimo_erro`.
//
// Nada quebrou por causa disso, e é justamente esse o ponto: um comentário
// errado passa no `tsc` e passa na suíte inteira sem fazer barulho. O `select`
// abaixo pede quatro colunas nominais e sobreviveria a qualquer uma dessas
// mudanças — a defesa nunca foi o texto, foi o `select` estreito. Quem escrever
// aqui: comentário que afirma o estado do banco é comentário com data de
// validade. Datar não o torna verdadeiro; torna a mentira DATÁVEL.
//
// ----------------------------------------------------------------------------
// O QUE ESTE BLOCO EXISTE PARA DIZER
//
// Em 16/08 a fila tinha 30 linhas: 21 em `aguardando_template` desde 04/08 com
// `criado_em` idêntico (foi um lote só), 5 `pendente` entre 06/08 e 14/08, e 4
// `excluido` — e `sum(tentativas) = 0` na tabela inteira. Ninguém tocado nunca,
// onze dias. Nenhuma tela dizia isso; por isso esta existe.
//
// Em 29/08 a fila é outra: 52 linhas, 25 `encerrado_por_silencio`, 16 `enviado`,
// 7 `excluido`, 3 `respondeu`, 1 `duplicado_telefone`, e 54 toques dados. A fila
// ANDOU. Deixo os dois retratos porque a comparação é a informação: o valor
// desta tela não é o número de hoje, é o número de hoje ao lado do de ontem.
//
// Os números acima envelhecem sozinhos. O que NÃO envelhece é o alarme de
// `desconhecidas` mais abaixo — ele é lido do banco a cada visita.
//
// Os três silêncios de `RadarAlertas` valem igual aqui: fila vazia, tabela
// ausente e erro de leitura produziriam a MESMA tela num componente descuidado,
// e as três frases são diferentes de propósito.
//
// Nada de `throw`: `/admin/conversas` é tela de trabalho. Derrubar a lista de
// atendimento por causa do resumo da fila trocaria um problema pequeno e
// visível por um grande e mudo.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { resumirFila, type LinhaFila } from "@/lib/sentinela/fila-resumo";
import styles from "./conversas.module.css";

/** Teto de leitura. A fila tem 30 hoje; se crescer, o resumo continua honesto. */
const TETO_LINHAS = 500;

/** Postgres 42P01 = undefined_table. É como uma migração não aplicada aparece. */
function tabelaAusente(codigo: string | undefined, mensagem: string): boolean {
  if (codigo === "42P01") return true;
  return /does not exist|could not find the table/i.test(mensagem);
}

function plural(n: number, um: string, muitos: string): string {
  return n === 1 ? um : muitos;
}

export async function FilaSentinela() {
  const db = createXtvClient();
  const { data, error } = await db
    .from("sentinela_fila")
    .select("status, motivo, tentativas, criado_em")
    .limit(TETO_LINHAS);

  if (error) {
    const ausente = tabelaAusente(error.code, error.message ?? "");
    return (
      <Card as="section">
        <div className={styles.filaAviso}>
          <Badge tone="muted">Fila do Sentinela</Badge>
          <span>
            {ausente ? (
              <>
                A tabela <code>sentinela_fila</code> não existe neste banco.{" "}
                <b>Isto não quer dizer que a fila está vazia:</b> quer dizer que ninguém
                sabe o tamanho dela.
              </>
            ) : (
              <>
                Não consegui ler a fila do Sentinela. <b>Fila não lida não é fila
                vazia.</b> Motivo: {error.message}
              </>
            )}
          </span>
        </div>
      </Card>
    );
  }

  const linhas = (data ?? []) as LinhaFila[];
  const r = resumirFila(linhas, new Date());

  if (r.total === 0) {
    return (
      <Card as="section">
        <div className={styles.filaAviso}>
          <Badge tone="ok">Fila do Sentinela</Badge>
          <span>Nenhuma linha na fila. Ninguém esperando retomada.</span>
        </div>
      </Card>
    );
  }

  return (
    <Card as="section">
      <div className={styles.filaTopo}>
        <h2 className={styles.filaTitulo}>
          Fila do Sentinela — {r.esperando} {plural(r.esperando, "pessoa", "pessoas")}{" "}
          {plural(r.esperando, "esperando", "esperando")}
        </h2>
        <Badge tone={r.esperando > 0 ? "amber" : "ok"}>
          {r.total} {plural(r.total, "linha", "linhas")} no total
        </Badge>
      </div>

      {/* A frase mais importante da tela. `tentativas` somado entre quem espera:
          zero significa que a fila nunca foi trabalhada — não que ela é nova. */}
      <p className={styles.filaDestaque}>
        {r.diasMaisAntigaEsperando === null ? (
          <>Há gente esperando, mas não consegui calcular há quanto tempo.</>
        ) : (
          <>
            A mais antiga espera há <strong>{r.diasMaisAntigaEsperando}</strong>{" "}
            {plural(r.diasMaisAntigaEsperando, "dia", "dias")}.
          </>
        )}{" "}
        {r.toquesDados === 0 ? (
          <strong>Nenhum toque foi dado até agora.</strong>
        ) : (
          <>
            {r.toquesDados} {plural(r.toquesDados, "toque dado", "toques dados")} até agora.
          </>
        )}
      </p>

      {r.desconhecidas > 0 ? (
        <p className={styles.filaAlarme} role="alert">
          {r.desconhecidas} {plural(r.desconhecidas, "linha", "linhas")} com status fora
          das listas conhecidas. Não sei classificar — e por isso não conto como
          espera nem como encerrada.
        </p>
      ) : null}

      <ul className={styles.filaStatus}>
        {r.porStatus.map((g) => (
          <li key={g.status} className={styles.filaStatusItem}>
            <Badge tone={g.esperando ? "amber" : "muted"}>{g.n}</Badge>
            <span className={styles.filaStatusNome}>
              <code>{g.status}</code>
              {!g.conhecido ? " (desconhecido)" : ""}
            </span>
            <span className={styles.filaStatusMeta}>
              {g.esperando ? "esperando" : "encerrada"}
              {g.diasMaisAntiga === null
                ? ""
                : ` · mais antiga há ${g.diasMaisAntiga} ${plural(g.diasMaisAntiga, "dia", "dias")}`}
            </span>
          </li>
        ))}
      </ul>

      {r.porMotivo.length > 0 ? (
        <p className={styles.filaMotivos}>
          Motivo de quem espera:{" "}
          {r.porMotivo.map((m, i) => (
            <span key={m.motivo}>
              {i > 0 ? " · " : ""}
              <code>{m.motivo}</code> ({m.n})
            </span>
          ))}
        </p>
      ) : null}
    </Card>
  );
}
