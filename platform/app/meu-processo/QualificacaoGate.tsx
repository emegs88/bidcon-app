"use client";
// Gate de qualificação do CONTRATANTE (nome completo + CPF) — pré-requisito
// para o aceite do contrato de serviço (lib/contratos.ts exige qualificação
// completa; ver comentário em ContratoServico.tsx). Aparece no lugar do botão
// "Li e aceito" enquanto profiles.nome/cpf não estiverem preenchidos e
// válidos. Independente do fluxo de KYC (documento/selfie), que segue à parte.
//
// cpfValido/soDigitos são reimplementados aqui (não importados de @/lib/kyc)
// de propósito: lib/kyc.ts importa lib/supabase-admin.ts (service_role),
// que não pode ir para o bundle do client — ver aviso no topo daquele arquivo.
// São funções puras e pequenas; duplicá-las é mais seguro que arriscar o
// build/bundle client incluir código server-only.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import styles from "./fluxo.module.css";

function soDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (fatorInicial: number, ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (fatorInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(10, 9) === Number(d[9]) && calc(11, 10) === Number(d[10]);
}

// máscara progressiva enquanto o usuário digita (000.000.000-00)
function mascaraCpfParcial(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

export function QualificacaoGate({
  nomeAtual,
  cpfAtual,
}: {
  nomeAtual: string;
  cpfAtual: string;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeAtual);
  const [cpf, setCpf] = useState(mascaraCpfParcial(cpfAtual));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (enviando) return;
    setErro(null);
    if (nome.trim().length < 2) {
      setErro("Informe seu nome completo.");
      return;
    }
    if (!cpfValido(cpf)) {
      setErro("CPF inválido.");
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/perfil/qualificacao", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), cpf: soDigitos(cpf) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Não foi possível salvar seus dados.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar seus dados.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.qualif}>
      <p className={styles.qualifAviso}>
        Confirme seu nome completo e CPF para liberar o aceite do contrato de
        serviço.
      </p>

      <div className={styles.qualifCampo}>
        <label className={styles.qualifLabel} htmlFor="qualif-nome">
          Nome completo
        </label>
        <input
          id="qualif-nome"
          className={styles.qualifInput}
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoComplete="name"
        />
      </div>

      <div className={styles.qualifCampo}>
        <label className={styles.qualifLabel} htmlFor="qualif-cpf">
          CPF
        </label>
        <input
          id="qualif-cpf"
          className={styles.qualifInput}
          type="text"
          inputMode="numeric"
          placeholder="000.000.000-00"
          value={cpf}
          onChange={(e) => setCpf(mascaraCpfParcial(e.target.value))}
          autoComplete="off"
        />
      </div>

      <Button size="sm" onClick={salvar} disabled={enviando}>
        {enviando ? "Salvando…" : "Salvar e continuar"}
      </Button>

      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
