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
  fonteAtual,
  comissaoAtual,
}: {
  cartaId: string;
  administradoras: Opcao[];
  fornecedores: Opcao[];
  administradoraAtual: string | null;
  fornecedorAtual: string | null;
  // metadados admin-only da carta (nunca vão ao payload de cliente/parceiro):
  fonteAtual: string | null;
  comissaoAtual: number | null;
}) {
  const router = useRouter();
  const [adminId, setAdminId] = useState<string>(administradoraAtual ?? "");
  const [fornId, setFornId] = useState<string>(fornecedorAtual ?? "");
  const [fonte, setFonte] = useState<string>(fonteAtual ?? "");
  // comissão como string no input (permite vazio = limpar); validação no server.
  const [comissao, setComissao] = useState<string>(
    comissaoAtual != null ? String(comissaoAtual) : ""
  );
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const mudou =
    adminId !== (administradoraAtual ?? "") ||
    fornId !== (fornecedorAtual ?? "") ||
    fonte.trim() !== (fonteAtual ?? "") ||
    comissao.trim() !== (comissaoAtual != null ? String(comissaoAtual) : "");

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
          // "" => o server normaliza para null (limpa). Comissão vai como string;
          // normalizarPercentual aceita string numérica ou "" (=> null).
          fonte: fonte.trim() === "" ? null : fonte.trim(),
          comissao_percentual: comissao.trim() === "" ? null : comissao.trim(),
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

        <label className={styles.campo}>
          <span className={styles.rotulo}>Origem / site (interno)</span>
          <input
            className={styles.select}
            type="text"
            value={fonte}
            maxLength={120}
            placeholder="— não definida —"
            onChange={(e) => {
              setFonte(e.target.value);
              setOk(false);
            }}
            disabled={enviando}
          />
        </label>

        <label className={styles.campo}>
          <span className={styles.rotulo}>Comissão da carta (%)</span>
          <input
            className={styles.select}
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.01"
            value={comissao}
            placeholder="— não definida —"
            onChange={(e) => {
              setComissao(e.target.value);
              setOk(false);
            }}
            disabled={enviando}
          />
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
