"use client";
// Vínculo da carta com ADMINISTRADORA (marca pública do bem) e FORNECEDOR
// (de quem compramos — segredo admin-only). Client só para os selects + POST.
// Chama POST /api/admin/cartas/[id]/vinculo, que escreve via service_role após
// confirmar admin. As listas de opções vêm do servidor (a página já é admin).
//
// COMPLIANCE: este componente SÓ é renderizado em /admin/cartas (exigirPapel
//   "admin"). Os nomes de fornecedor aqui são internos — nunca vão para telas de
//   cliente/parceiro. Não exibir este bloco fora do admin.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import styles from "./acoes.module.css";

export type Opcao = { id: string; nome: string };

export function CartaVinculo({
  cartaId,
  administradoras,
  fornecedores,
  administradoraAtual,
  fornecedorAtual,
}: {
  cartaId: string;
  administradoras: Opcao[];
  fornecedores: Opcao[];
  administradoraAtual: string | null;
  fornecedorAtual: string | null;
}) {
  const router = useRouter();
  const [adminId, setAdminId] = useState<string>(administradoraAtual ?? "");
  const [fornId, setFornId] = useState<string>(fornecedorAtual ?? "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const mudou =
    adminId !== (administradoraAtual ?? "") || fornId !== (fornecedorAtual ?? "");

  async function salvar() {
    if (!mudou || enviando) return;
    setEnviando(true);
    setErro(null);
    setOk(false);
    try {
      const res = await fetch(`/api/admin/cartas/${cartaId}/vinculo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          administradora_id: adminId === "" ? null : adminId,
          fornecedor_id: fornId === "" ? null : fornId,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Falha ao salvar o vínculo.");
      }
      setOk(true);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.botoes} role="group" aria-label="Vínculo da carta">
        <label className={styles.campo}>
          <span className={styles.rotulo}>Administradora</span>
          <select
            className={styles.select}
            value={adminId}
            onChange={(e) => {
              setAdminId(e.target.value);
              setOk(false);
            }}
            disabled={enviando}
          >
            <option value="">— não definida —</option>
            {administradoras.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.campo}>
          <span className={styles.rotulo}>Fornecedor (interno)</span>
          <select
            className={styles.select}
            value={fornId}
            onChange={(e) => {
              setFornId(e.target.value);
              setOk(false);
            }}
            disabled={enviando}
          >
            <option value="">— não definido —</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>

        <Button size="sm" onClick={salvar} disabled={!mudou || enviando}>
          {enviando ? "Salvando…" : ok ? "Salvo ✓" : "Salvar vínculo"}
        </Button>
      </div>
      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
