"use client";
// ============================================================================
// DiagContainer — DIAG-CONTAINER-01 · o A/B na tela, lado a lado
// AUTORIZADO: Emerson Gomes dos Santos — 11/08/2026:
//   "3. GET ?conferir devolve status_code + copyright_check_status literais dos
//    dois. Bloco mínimo no painel com o botão e os dois status lado a lado."
// ----------------------------------------------------------------------------
// NENHUM SEGREDO CHEGA AQUI, e era esse o motivo de a medição ter saído do
// terminal: IG_ACCESS_TOKEN e IG_USER_ID são Sensitive sem Reveal. Este
// componente sabe dizer "cria os dois" e "lê os dois"; quem tem a chave é o
// servidor.
//
// ----------------------------------------------------------------------------
// TRÊS ESCOLHAS DE TELA QUE SÃO SOBRE NÃO ENGANAR QUEM LÊ
// ----------------------------------------------------------------------------
// 1. OS LITERAIS APARECEM CRUS. `status_code` e `copyright_check_status` são
//    impressos como a Meta os devolveu, sem tradução para "ok"/"erro". Este
//    bloco existe para virar anexo de ticket; um rótulo amigável apagaria
//    exatamente a string que a HeyGen ou a Meta vão querer ver.
//
// 2. `null` VIRA "a Meta não devolveu este campo", nunca célula vazia. Campo
//    ausente e campo vazio são fatos diferentes, e é a diferença entre eles que
//    decide para quem se abre o ticket.
//
// 3. OS IDS SÃO EDITÁVEIS. A rota não grava nada no banco (escolha declarada
//    lá), então recarregar a página perderia os dois container_id. Os campos
//    ficam abertos: o operador cola os ids da resposta anterior e confere de
//    novo, sem precisar criar containers outra vez. É o conserto barato do
//    custo que a rota assumiu.
//
// SEM CONFIRMAÇÃO NOMINAL, e o desvio está declarado ao Emerson: este POST não
// publica, não gasta crédito e não altera linha nenhuma — os containers expiram
// sozinhos em 24h. Exigir a palavra aqui treinaria o dedo a digitá-la por
// reflexo, que é como se enfraquece a trava onde ela importa de verdade.
// ============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./farol.module.css";

type LadoCriado = {
  rotulo: string;
  url: string;
  bytes?: number;
  bytes_esperados: number;
  bytes_conferem?: boolean;
  container_id: string | null;
  erro: string | null;
};

type Criado = {
  carimbo: string;
  criado_em: string;
  a: LadoCriado;
  b: LadoCriado;
  nota_resumable: string;
  heygen: string;
};

type LadoConferido = {
  rotulo: string;
  container_id: string;
  status_code: string | null;
  copyright_check_status: string | null;
  erro: string | null;
};

type Conferencia = {
  idade_min: number | null;
  a: LadoConferido;
  b: LadoConferido;
  leitura: {
    veredito: string;
    frase: string;
    proximo: string;
    conclusivo: boolean;
  };
};

/** Copiar o container_id: 17 dígitos sem separador não se transcrevem a olho. */
function BotaoCopiar({ texto }: { texto: string }) {
  const [estado, setEstado] = useState<"parado" | "copiado" | "falhou">("parado");
  return (
    <button
      type="button"
      className={styles.copiar}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setEstado("copiado");
        } catch {
          setEstado("falhou");
        }
        setTimeout(() => setEstado("parado"), 1500);
      }}
    >
      {estado === "copiado" ? "copiado" : estado === "falhou" ? "falhou" : "copiar"}
    </button>
  );
}

/** Um campo literal. `null` fala; célula vazia mente. */
function Campo({ nome, valor }: { nome: string; valor: string | null }) {
  return (
    <p className={styles.diagCampo}>
      <span className={styles.diagNome}>{nome}</span>
      {valor === null ? (
        <span className={styles.diagAusente}>a Meta não devolveu este campo</span>
      ) : (
        <code className={styles.invId}>{valor}</code>
      )}
    </p>
  );
}

export default function DiagContainer() {
  const [criando, setCriando] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [conf, setConf] = useState<Conferencia | null>(null);

  // Os três parâmetros da conferência, editáveis (ver escolha 3 no cabeçalho).
  const [idA, setIdA] = useState("");
  const [idB, setIdB] = useState("");
  const [desde, setDesde] = useState("");

  async function pedir<T>(url: string, metodo: "GET" | "POST"): Promise<T> {
    const resp = await fetch(url, { method: metodo, cache: "no-store" });
    const j = (await resp.json().catch(() => ({}))) as {
      erro?: string;
      detalhe?: string;
    };
    if (!resp.ok) {
      throw new Error(
        [j.erro ?? `HTTP ${resp.status}`, j.detalhe].filter(Boolean).join(" — ")
      );
    }
    return j as T;
  }

  async function criar() {
    setCriando(true);
    setErro(null);
    setConf(null);
    try {
      const j = await pedir<Criado>("/api/admin/farol/diag-container", "POST");
      setCriado(j);
      setIdA(j.a.container_id ?? "");
      setIdB(j.b.container_id ?? "");
      setDesde(j.criado_em);
    } catch (e) {
      setCriado(null);
      setErro(e instanceof Error ? e.message : "falha ao criar os containers.");
    } finally {
      setCriando(false);
    }
  }

  async function conferir() {
    setConferindo(true);
    setErro(null);
    try {
      const q = new URLSearchParams({ conferir: "1", a: idA.trim(), b: idB.trim() });
      if (desde.trim()) q.set("desde", desde.trim());
      const j = await pedir<Conferencia>(
        `/api/admin/farol/diag-container?${q.toString()}`,
        "GET"
      );
      setConf(j);
    } catch (e) {
      setConf(null);
      setErro(e instanceof Error ? e.message : "falha ao conferir os containers.");
    } finally {
      setConferindo(false);
    }
  }

  const podeConferir = idA.trim().length > 0 && idB.trim().length > 0;

  return (
    <div className={styles.acoesWrap}>
      <div className={styles.botoes}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={criando || conferindo}
          onClick={criar}
        >
          {criando ? "criando…" : "Criar os dois containers (A/B)"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={criando || conferindo || !podeConferir}
          onClick={conferir}
        >
          {conferindo ? "conferindo…" : "Conferir status dos dois"}
        </Button>
      </div>

      {erro ? (
        <p className={styles.erroAcao} role="alert">
          {erro}
        </p>
      ) : null}

      {/* --- os parâmetros da conferência, sempre à vista ------------------- */}
      <div className={styles.diagIds}>
        <label className={styles.diagCampoIn}>
          <span className={styles.diagNome}>container A</span>
          <input
            className={styles.invFiltro}
            value={idA}
            onChange={(e) => setIdA(e.target.value)}
            placeholder="id do container A"
            spellCheck={false}
          />
        </label>
        <label className={styles.diagCampoIn}>
          <span className={styles.diagNome}>container B</span>
          <input
            className={styles.invFiltro}
            value={idB}
            onChange={(e) => setIdB(e.target.value)}
            placeholder="id do container B"
            spellCheck={false}
          />
        </label>
        <label className={styles.diagCampoIn}>
          <span className={styles.diagNome}>criados em (ISO)</span>
          <input
            className={styles.invFiltro}
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            placeholder="2026-08-11T14:00:00.000Z"
            spellCheck={false}
          />
        </label>
        <p className={styles.aviso}>
          Sem o instante de criação não há relógio, e sem relógio a leitura nunca
          diz “travado” — ela fica em “aguardando” para sempre. O campo é
          preenchido sozinho ao criar; ao recarregar a página, cole-o de volta.
        </p>
      </div>

      {/* --- o que a criação devolveu -------------------------------------- */}
      {criado ? (
        <div className={styles.inventario}>
          <p className={styles.invResumo}>
            Criados em <code className={styles.invId}>{criado.criado_em}</code> ·
            carimbo <code className={styles.invId}>{criado.carimbo}</code>
          </p>

          {criado.a.bytes_conferem === false ? (
            <p className={styles.invParcial} role="alert">
              ATENÇÃO: a origem de A tem {criado.a.bytes ?? "?"} bytes, e o
              esperado eram {criado.a.bytes_esperados}. O objeto no bucket não é
              o mp4 medido de 07/08 — esta rodada não prova o que foi desenhada
              para provar.
            </p>
          ) : (
            <p className={styles.invControleOk}>
              Controle ok: a origem de A tem os {criado.a.bytes_esperados} bytes
              medidos do mp4 de 07/08.
            </p>
          )}

          <div className={styles.diagLados}>
            {[criado.a, criado.b].map((l) => (
              <div key={l.rotulo} className={styles.diagLado}>
                <p className={styles.diagRotulo}>{l.rotulo}</p>
                <p className={styles.diagCampo}>
                  <span className={styles.diagNome}>container_id</span>
                  {l.container_id ? (
                    <>
                      <code className={styles.invId}>{l.container_id}</code>
                      <BotaoCopiar texto={l.container_id} />
                    </>
                  ) : (
                    <span className={styles.diagAusente}>não foi criado</span>
                  )}
                </p>
                {l.erro ? (
                  <p className={styles.erroAcao} role="alert">
                    {l.erro}
                  </p>
                ) : null}
                <p className={styles.diagUrl}>
                  <code className={styles.invId}>{l.url}</code>
                </p>
              </div>
            ))}
          </div>

          <p className={styles.aviso}>{criado.nota_resumable}</p>
          <p className={styles.aviso}>{criado.heygen}</p>
        </div>
      ) : null}

      {/* --- os dois status, lado a lado ------------------------------------ */}
      {conf ? (
        <div className={styles.inventario}>
          <p className={styles.invResumo}>
            {conf.idade_min === null
              ? "Sem instante de criação — a idade não pôde ser calculada."
              : `${conf.idade_min} min desde a criação (o limiar de "travado" é 15 min).`}
          </p>

          <div className={styles.diagLados}>
            {[conf.a, conf.b].map((l) => (
              <div key={l.container_id} className={styles.diagLado}>
                <p className={styles.diagRotulo}>{l.rotulo}</p>
                <Campo nome="container_id" valor={l.container_id} />
                <Campo nome="status_code" valor={l.status_code} />
                <Campo
                  nome="copyright_check_status"
                  valor={l.copyright_check_status}
                />
                {l.erro ? (
                  <p className={styles.erroAcao} role="alert">
                    {l.erro}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <p
            className={
              conf.leitura.conclusivo ? styles.invControleOk : styles.invControleRuim
            }
          >
            {conf.leitura.veredito.toUpperCase()} — {conf.leitura.frase}
          </p>
          <p className={styles.diagProximo}>{conf.leitura.proximo}</p>
          {!conf.leitura.conclusivo ? (
            <p className={styles.aviso}>
              Leitura NÃO conclusiva: nada deve ser decidido, escrito em ticket
              nem aplicado no render a partir destes números.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
