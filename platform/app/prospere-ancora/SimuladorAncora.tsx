"use client";
// Simulador client da tabela Âncora. Filtra por produto/grupo/plano e exibe a 1ª
// parcela REAL (PF/PJ, com/sem seguro) lida do portal. NÃO recalcula nada: só
// formata e mostra os números já armazenados. Uso interno da equipe.
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { brl } from "@/lib/format";
import { PainelLance } from "./PainelLance";
import styles from "./prospere-ancora.module.css";

// Espelha as colunas snake_case lidas no server (page.tsx).
export type LinhaAncora = {
  id: string;
  produto: string;
  bem_codigo: string;
  bem_nome: string | null;
  valor_do_bem: number | null;
  grupo: string;
  plano: string;
  prazo_grupo: number | null;
  prazo_comercializacao: number | null;
  taxa_administracao: number | null;
  fundo_reserva: number | null;
  pf_com_seguro: number | null;
  pf_sem_seguro: number | null;
  pj_com_seguro: number | null;
  pj_sem_seguro: number | null;
  assembleia: string | null;
  cotas_ativas: number | null;
  cotas_vagas: number | null;
  status: string | null;
};

// Fração (0.18) -> "18,00%". Null => "—". NÃO deriva nada, só formata.
function pct(fracao: number | null): string {
  if (fracao == null) return "—";
  return (
    (fracao * 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "%"
  );
}

function valor(n: number | null): string {
  return n == null ? "—" : brl(n);
}

const TODOS = "Todos";

export function SimuladorAncora({ linhas }: { linhas: LinhaAncora[] }) {
  const [produto, setProduto] = useState<string>(TODOS);
  const [grupo, setGrupo] = useState<string>(TODOS);

  const produtos = useMemo(
    () => [TODOS, ...Array.from(new Set(linhas.map((l) => l.produto))).sort()],
    [linhas]
  );
  const grupos = useMemo(() => {
    const base = produto === TODOS ? linhas : linhas.filter((l) => l.produto === produto);
    return [TODOS, ...Array.from(new Set(base.map((l) => l.grupo))).sort()];
  }, [linhas, produto]);

  const filtradas = useMemo(
    () =>
      linhas.filter(
        (l) =>
          (produto === TODOS || l.produto === produto) &&
          (grupo === TODOS || l.grupo === grupo)
      ),
    [linhas, produto, grupo]
  );

  return (
    <div className={styles.stack}>
      <Card>
        <div className={styles.filtros}>
          <label className={styles.campo}>
            <span>Produto</span>
            <select
              value={produto}
              onChange={(e) => {
                setProduto(e.target.value);
                setGrupo(TODOS);
              }}
            >
              {produtos.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.campo}>
            <span>Grupo</span>
            <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>
              {grupos.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.contagem}>
            {filtradas.length} {filtradas.length === 1 ? "linha" : "linhas"}
          </div>
        </div>
      </Card>

      <div className={styles.grid}>
        {filtradas.map((l) => (
          <Card key={l.id}>
            <div className={styles.topo}>
              <Badge tone={l.produto.toLowerCase().includes("imó") || l.produto.toLowerCase().includes("imo") ? "info" : "amber"}>
                {l.produto}
              </Badge>
              <span className={styles.grupoTag}>
                grupo {l.grupo} · {l.plano}
              </span>
            </div>

            <div className={styles.bem}>
              {l.bem_nome ?? l.bem_codigo}
              {l.valor_do_bem != null && (
                <span className={styles.valorBem}> · {brl(l.valor_do_bem)}</span>
              )}
            </div>

            <dl className={styles.dl}>
              <div className={styles.row}>
                <dt>Taxa adm.</dt>
                <dd>{pct(l.taxa_administracao)}</dd>
              </div>
              <div className={styles.row}>
                <dt>Fundo reserva</dt>
                <dd>{pct(l.fundo_reserva)}</dd>
              </div>
              <div className={styles.row}>
                <dt>Prazo grupo</dt>
                <dd>{l.prazo_grupo != null ? `${l.prazo_grupo}m` : "—"}</dd>
              </div>
              <div className={styles.row}>
                <dt>Prazo comerc.</dt>
                <dd>{l.prazo_comercializacao != null ? `${l.prazo_comercializacao}m` : "—"}</dd>
              </div>
            </dl>

            <div className={styles.parcelasTitulo}>1ª parcela (real, do portal)</div>
            <dl className={styles.dl}>
              <div className={styles.row}>
                <dt>PF com seguro</dt>
                <dd>{valor(l.pf_com_seguro)}</dd>
              </div>
              <div className={styles.row}>
                <dt>PF sem seguro</dt>
                <dd>{valor(l.pf_sem_seguro)}</dd>
              </div>
              <div className={styles.row}>
                <dt>PJ com seguro</dt>
                <dd>{valor(l.pj_com_seguro)}</dd>
              </div>
              <div className={styles.row}>
                <dt>PJ sem seguro</dt>
                <dd>{valor(l.pj_sem_seguro)}</dd>
              </div>
            </dl>

            <div className={styles.rodape}>
              {l.assembleia && <span>assembleia {l.assembleia}</span>}
              {l.cotas_ativas != null && l.cotas_vagas != null && (
                <span>
                  {l.cotas_ativas} ativas · {l.cotas_vagas} vagas
                </span>
              )}
              {l.status && <span>{l.status}</span>}
            </div>

            <PainelLance creditoBase={l.valor_do_bem} />
          </Card>
        ))}
      </div>
    </div>
  );
}
