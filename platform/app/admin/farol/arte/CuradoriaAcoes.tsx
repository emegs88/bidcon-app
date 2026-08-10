"use client";
// ============================================================================
// Ações da curadoria de arte (FAROL-ARTE-01 passo 4) — o interativo desta tela.
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO **NÃO** É: a trava. A palavra APROVAR, o motivo mínimo, a
// sessão admin e a transição legal (só de 'pendente') são conferidos no
// servidor, em /api/admin/farol/arte. Aqui é conforto: desabilitar o botão
// antes do clique e mostrar o motivo depois.
//
// DUAS PORTAS DE PESO DIFERENTE, DE PROPÓSITO. Aprovar pede a palavra nominal —
// é o movimento que põe a arte no sorteio e, dali, num perfil público. Rejeitar
// não pede palavra, mas pede MOTIVO, porque a 0076 registra que é o motivo que
// ensina o acervo seguinte. Simetria aqui seria burocracia no lado errado.
//
// `router.refresh()` DEPOIS DE CADA AÇÃO: a página é Server Component e volta
// do banco com o estado real. Estado otimista mentiria exatamente no caso que
// importa — a curadoria que o servidor recusou com 409 porque outra aba já
// tinha curado a mesma arte.
// ============================================================================
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PALAVRA_APROVAR as PALAVRA } from "@/lib/farol/confirmacao";
import styles from "../farol.module.css";
/** Tem de bater com MOTIVO_MIN da rota. */
const MOTIVO_MIN = 8;

type Aberto = "aprovar" | "rejeitar" | null;

export function CuradoriaAcoes({ id }: { id: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState<Aberto>(null);
  const [palavra, setPalavra] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function fechar() {
    setAberto(null);
    setPalavra("");
    setMotivo("");
    setErro(null);
  }

  async function enviar(acao: "aprovar" | "rejeitar") {
    setErro(null);
    setEnviando(true);
    try {
      const resp = await fetch("/api/admin/farol/arte", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, acao, confirmacao: palavra, motivo }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados?.ok) {
        throw new Error(
          typeof dados?.erro === "string" ? dados.erro : "Falha na curadoria."
        );
      }
      fechar();
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.acoesWrap}>
      <div className={styles.botoes}>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setErro(null);
            setAberto(aberto === "aprovar" ? null : "aprovar");
          }}
        >
          Aprovar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setErro(null);
            setAberto(aberto === "rejeitar" ? null : "rejeitar");
          }}
        >
          Rejeitar
        </Button>
      </div>

      {aberto === "aprovar" && (
        <div className={styles.confirmacao}>
          <p className={styles.aviso}>
            Aprovar põe esta arte no sorteio do FAROL. A partir daqui ela pode ir
            a um perfil público sem passar por mais ninguém. Confira antes: a arte
            não pode conter nenhum número, letra, percentual, logotipo ou nome de
            administradora — quem escreve número é o gerador determinístico, por
            cima do véu.
          </p>
          <Field
            label={`Digite ${PALAVRA} para confirmar`}
            id={`aprovar-${id}`}
            value={palavra}
            autoComplete="off"
            onChange={(e) => setPalavra(e.target.value)}
          />
          <div className={styles.botoes}>
            <Button
              type="button"
              size="sm"
              disabled={palavra !== PALAVRA || enviando}
              onClick={() => enviar("aprovar")}
            >
              {enviando ? "Executando…" : "Aprovar esta arte"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={fechar}
              disabled={enviando}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {aberto === "rejeitar" && (
        <div className={styles.confirmacao}>
          <p className={styles.aviso}>
            Rejeitar não publica nada, mas o motivo fica no acervo e ensina o
            próximo lote. Se saiu algo parecido com texto, dígito ou marca,
            escreva isso — é a rejeição que mais importa registrar, porque é a
            que testa a regra inegociável.
          </p>
          <label className={styles.rotuloCampo} htmlFor={`motivo-${id}`}>
            Motivo (mínimo {MOTIVO_MIN} caracteres)
          </label>
          <textarea
            id={`motivo-${id}`}
            className={styles.textarea}
            value={motivo}
            rows={3}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className={styles.botoes}>
            <Button
              type="button"
              size="sm"
              disabled={motivo.trim().length < MOTIVO_MIN || enviando}
              onClick={() => enviar("rejeitar")}
            >
              {enviando ? "Executando…" : "Rejeitar esta arte"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={fechar}
              disabled={enviando}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {erro && (
        <p className={styles.erroAcao} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
