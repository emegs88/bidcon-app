"use client";
// Form client da importação. Uma textarea recebe o JSON BRUTO do portal e faz
// POST para /api/prospere-ancora/importar. NÃO valida o JSON aqui (as 5 guardas
// vivem no parser server-side): a tela só envia e mostra o resultado/erro.
//
// O corpo vai como { texto } — a rota aceita tanto string crua quanto { texto }.
// Resultado de sucesso: { ok, recebidas, gravadas }. Erro: { erro, motivo? }.
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import styles from "./importar.module.css";

type Resultado =
  | { tipo: "ok"; recebidas: number; gravadas: number }
  | { tipo: "erro"; mensagem: string; motivo?: string };

export function ImportarForm() {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function enviar() {
    const bruto = texto.trim();
    if (!bruto) {
      setResultado({ tipo: "erro", mensagem: "Cole o JSON antes de importar." });
      return;
    }
    setEnviando(true);
    setResultado(null);
    try {
      const resp = await fetch("/api/prospere-ancora/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: bruto }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (resp.ok && dados?.ok) {
        setResultado({
          tipo: "ok",
          recebidas: Number(dados.recebidas ?? 0),
          gravadas: Number(dados.gravadas ?? 0),
        });
      } else {
        setResultado({
          tipo: "erro",
          mensagem: typeof dados?.erro === "string" ? dados.erro : "Falha na importação.",
          motivo: typeof dados?.motivo === "string" ? dados.motivo : undefined,
        });
      }
    } catch {
      setResultado({ tipo: "erro", mensagem: "Não foi possível contatar o servidor." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.stack}>
      <Card>
        <label className={styles.campo}>
          <span>JSON bruto do portal (cotas novas)</span>
          <textarea
            className={styles.textarea}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder='Cole aqui a resposta de /api/busca-tabela — ex.: [ { ... }, { ... } ]'
            spellCheck={false}
            rows={16}
          />
        </label>

        <div className={styles.acoes}>
          <span className={styles.hint}>
            {texto.trim().length > 0
              ? `${texto.trim().length.toLocaleString("pt-BR")} caracteres`
              : "Nada colado ainda"}
          </span>
          <div className={styles.botoes}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setTexto("");
                setResultado(null);
              }}
              disabled={enviando || texto.length === 0}
            >
              Limpar
            </Button>
            <Button type="button" size="sm" onClick={enviar} disabled={enviando}>
              {enviando ? "Importando…" : "Importar"}
            </Button>
          </div>
        </div>
      </Card>

      {resultado?.tipo === "ok" && (
        <Card>
          <div className={styles.ok}>
            <strong>Importação concluída.</strong>
            <span>
              {resultado.recebidas} {resultado.recebidas === 1 ? "linha lida" : "linhas lidas"} ·{" "}
              {resultado.gravadas} {resultado.gravadas === 1 ? "gravada" : "gravadas"}.
            </span>
            <a className={styles.voltar} href="/prospere-ancora">
              Ver no simulador →
            </a>
          </div>
        </Card>
      )}

      {resultado?.tipo === "erro" && (
        <Card>
          <div className={styles.erro}>
            <strong>{resultado.mensagem}</strong>
            {resultado.motivo && <span>Motivo: {resultado.motivo}</span>}
            <span className={styles.dica}>
              O estoque atual ficou intacto — nada foi gravado.
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
