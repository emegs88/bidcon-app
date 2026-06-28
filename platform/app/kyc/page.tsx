// /kyc — onboarding de verificação de identidade do cliente (Server Component).
// Lê (via RLS) a linha de kyc_perfis do próprio usuário e decide o que mostrar:
//   - verificado  -> estado "tudo certo", sem form.
//   - em_analise  -> aviso de "em análise", sem form (não pode reenviar).
//   - bloqueado   -> aviso de bloqueio, sem form.
//   - pendente/rejeitado -> mostra o KycForm para (re)enviar.
// Nada aqui promete contemplação/crédito: a verificação é só de identidade.
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_STATUS_KYC,
  TONE_STATUS_KYC,
  type StatusKYC,
} from "@/lib/status";
import { KycForm } from "./KycForm";
import styles from "./kyc.module.css";

export const dynamic = "force-dynamic";

export default async function KycPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, tipo")
    .eq("id", user.id)
    .single();
  const nome = profile?.nome ?? user.email ?? null;
  const tipo = profile?.tipo as "cliente" | "parceiro" | "admin" | undefined;

  // RLS: só retorna a própria linha (kyc_select_self).
  const { data: kyc } = await supabase
    .from("kyc_perfis")
    .select("status_kyc, motivo_rejeicao, doc_tipo")
    .eq("user_id", user.id)
    .maybeSingle();

  const status = (kyc?.status_kyc ?? "pendente") as StatusKYC;
  const podeEnviar = status === "pendente" || status === "rejeitado";

  return (
    <AppShell nome={nome} tipo={tipo}>
      <PageHeader
        title="Verificação de identidade"
        backHref="/"
        subtitle="Confirme seus dados para liberar o acompanhamento do seu processo. Usamos isto só para verificar quem você é — não há análise de crédito aqui."
      />

      <div className={styles.stack}>
        <Card>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Status</span>
            <Badge tone={TONE_STATUS_KYC[status]}>{LABEL_STATUS_KYC[status]}</Badge>
          </div>

          {status === "verificado" && (
            <p className={styles.ok}>
              Sua identidade está verificada. Não é preciso enviar nada.
            </p>
          )}

          {status === "em_analise" && (
            <p className={styles.info}>
              Recebemos seus dados e estão em análise. Avisaremos assim que a
              verificação for concluída.
            </p>
          )}

          {status === "bloqueado" && (
            <p className={styles.aviso}>
              Não foi possível concluir a verificação.{" "}
              {kyc?.motivo_rejeicao
                ? `Motivo: ${kyc.motivo_rejeicao}.`
                : ""}{" "}
              Fale com o atendimento para entender os próximos passos.
            </p>
          )}

          {status === "rejeitado" && (
            <p className={styles.aviso}>
              Sua verificação foi recusada
              {kyc?.motivo_rejeicao ? `: ${kyc.motivo_rejeicao}` : ""}. Revise os
              dados e os arquivos e envie novamente.
            </p>
          )}
        </Card>

        {podeEnviar && <KycForm docTipoInicial={(kyc?.doc_tipo as "cnh" | "rg" | null) ?? null} />}
      </div>
    </AppShell>
  );
}
