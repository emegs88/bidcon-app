"use client";
// Formulário de cadastro de carta própria do parceiro (client component).
// Envia para o Route Handler POST /api/parceiro/cartas, que valida o papel e
// insere com parceiro_id = usuário logado (cabe na policy cartas_parceiro_insert).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, SelectField } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import styles from "./nova.module.css";

export function NovaCartaForm() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      tipo: String(fd.get("tipo") ?? ""),
      valor_credito: Number(fd.get("valor_credito") ?? 0),
      valor_entrada: fd.get("valor_entrada") ? Number(fd.get("valor_entrada")) : null,
      valor_parcela: fd.get("valor_parcela") ? Number(fd.get("valor_parcela")) : null,
      qtd_parcelas: fd.get("qtd_parcelas") ? Number(fd.get("qtd_parcelas")) : null,
    };

    try {
      const res = await fetch("/api/parceiro/cartas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.erro ?? "Não foi possível cadastrar a carta.");
      }
      router.push("/parceiro/carteira");
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado.");
      setEnviando(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <SelectField label="Tipo de bem" id="tipo" name="tipo" defaultValue="imovel" required>
        <option value="imovel">Imóvel</option>
        <option value="veiculo">Veículo</option>
      </SelectField>

      <Field
        label="Crédito da carta (R$)"
        id="valor_credito"
        name="valor_credito"
        type="number"
        min={1}
        step="0.01"
        required
        inputMode="decimal"
      />
      <Field
        label="Entrada (R$)"
        id="valor_entrada"
        name="valor_entrada"
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        hint="Opcional."
      />
      <Field
        label="Parcela (R$)"
        id="valor_parcela"
        name="valor_parcela"
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        hint="Opcional."
      />
      <Field
        label="Quantidade de parcelas"
        id="qtd_parcelas"
        name="qtd_parcelas"
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        hint="Opcional."
      />

      {erro && <p className={styles.erro}>{erro}</p>}

      <div className={styles.acoes}>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Cadastrando…" : "Cadastrar carta"}
        </Button>
        <Button href="/parceiro/carteira" variant="ghost" type="button">
          Cancelar
        </Button>
      </div>
    </form>
  );
}
