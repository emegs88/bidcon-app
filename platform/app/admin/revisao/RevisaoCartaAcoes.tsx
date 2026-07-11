"use client";
// Ações por carta na fila de revisão (FATIA F1): "corrigir e republicar"
// (form inline com os 4 campos, POST /api/admin/cartas/[id]/republicar — a
// rota recusa se a TIR corrigida ainda ficar abaixo do piso) e "descartar"
// (confirm simples, POST /api/admin/cartas/[id]/descartar — remove
// permanentemente da fila, sem tentar corrigir).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import styles from "./revisao.module.css";

export function RevisaoCartaAcoes({
  cartaId,
  tipoAtual,
  creditoAtual,
  entradaAtual,
  parcelaAtual,
  parcelasAtual,
}: {
  cartaId: string;
  tipoAtual: "imovel" | "veiculo";
  creditoAtual: number | null;
  entradaAtual: number | null;
  parcelaAtual: number | null;
  parcelasAtual: number | null;
}) {
  const router = useRouter();
  const [corrigindo, setCorrigindo] = useState(false);
  const [tipo, setTipo] = useState<"imovel" | "veiculo">(tipoAtual);
  const [credito, setCredito] = useState(creditoAtual != null ? String(creditoAtual) : "");
  const [entrada, setEntrada] = useState(entradaAtual != null ? String(entradaAtual) : "");
  const [parcela, setParcela] = useState(parcelaAtual != null ? String(parcelaAtual) : "");
  const [parcelas, setParcelas] = useState(parcelasAtual != null ? String(parcelasAtual) : "");

  const [enviando, setEnviando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function republicar() {
    setErro(null);
    setEnviando(true);
    try {
      const resp = await fetch(`/api/admin/cartas/${cartaId}/republicar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipo,
          valor_credito: Number(credito.replace(",", ".")),
          valor_entrada: Number(entrada.replace(",", ".")),
          valor_parcela: Number(parcela.replace(",", ".")),
          qtd_parcelas: Number(parcelas.replace(",", ".")),
        }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados?.ok) {
        throw new Error(typeof dados?.erro === "string" ? dados.erro : "Falha ao republicar.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setEnviando(false);
    }
  }

  async function descartar() {
    if (!window.confirm("Descartar esta carta permanentemente? Ela sai da fila e não volta a aparecer na vitrine.")) {
      return;
    }
    setErro(null);
    setDescartando(true);
    try {
      const resp = await fetch(`/api/admin/cartas/${cartaId}/descartar`, { method: "POST" });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados?.ok) {
        throw new Error(typeof dados?.erro === "string" ? dados.erro : "Falha ao descartar.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setDescartando(false);
    }
  }

  return (
    <div className={styles.acoesWrap}>
      {!corrigindo ? (
        <div className={styles.botoes}>
          <Button type="button" size="sm" onClick={() => setCorrigindo(true)}>
            Corrigir e republicar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={descartar} disabled={descartando}>
            {descartando ? "Descartando…" : "Descartar"}
          </Button>
        </div>
      ) : (
        <div className={styles.formCorrigir}>
          <div className={styles.grid4}>
            <SelectField
              label="Tipo"
              id={`tipo-${cartaId}`}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "imovel" | "veiculo")}
            >
              <option value="veiculo">Veículo</option>
              <option value="imovel">Imóvel</option>
            </SelectField>
            <Field label="Crédito" id={`credito-${cartaId}`} value={credito} onChange={(e) => setCredito(e.target.value)} />
            <Field label="Entrada" id={`entrada-${cartaId}`} value={entrada} onChange={(e) => setEntrada(e.target.value)} />
            <Field label="Parcela" id={`parcela-${cartaId}`} value={parcela} onChange={(e) => setParcela(e.target.value)} />
            <Field
              label="Nº parcelas"
              id={`parcelas-${cartaId}`}
              value={parcelas}
              onChange={(e) => setParcelas(e.target.value)}
            />
          </div>
          <div className={styles.botoes}>
            <Button type="button" size="sm" onClick={republicar} disabled={enviando}>
              {enviando ? "Republicando…" : "Confirmar e republicar"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCorrigindo(false)} disabled={enviando}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {erro && <p className={styles.erro}>{erro}</p>}
    </div>
  );
}
