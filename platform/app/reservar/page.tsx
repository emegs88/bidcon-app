// /reservar — fluxo logado de reserva de uma carta contemplada.
// Server Component: identifica o cliente (RLS), checa o status de KYC e lê as
// cartas disponíveis (policy 0005). A reserva em si é feita pelo wizard client
// (ReservarWizard), que chama POST /api/reservar -> RPC reservar_carta.
//
// Gate de identidade: só cliente com KYC 'verificado' reserva. Os demais
// estados (pendente/em_analise/rejeitado/bloqueado) veem um aviso e o caminho
// para o onboarding de KYC — sem prometer nada.
//
// Compliance: mostra só valor da carta / recursos próprios. Nada de
// administradora/taxa/fundo. Não promete contemplação.
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LABEL_STATUS_KYC, TONE_STATUS_KYC, type StatusKYC } from "@/lib/status";
import { ReservarWizard, type CartaReserva } from "./ReservarWizard";
import styles from "./reservar.module.css";

const WA = "5511973202967";

export const dynamic = "force-dynamic";

export default async function ReservarPage({
  searchParams,
}: {
  searchParams: { carta?: string };
}) {
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

  // Status de KYC do chamador (pode não ter linha ainda => 'pendente').
  const { data: kyc } = await supabase
    .from("kyc_perfis")
    .select("status_kyc")
    .eq("user_id", user.id)
    .maybeSingle();
  const statusKyc = (kyc?.status_kyc ?? "pendente") as StatusKYC;
  const verificado = statusKyc === "verificado";

  // Cartas disponíveis (mesma leitura da vitrine).
  const { data: cartas } = await supabase
    .from("cartas")
    .select("id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas")
    .eq("status", "disponivel")
    .order("valor_credito", { ascending: true });
  const lista = (cartas ?? []) as CartaReserva[];

  const header = (
    <PageHeader
      title="Reservar uma carta"
      backHref="/cartas"
      backLabel="Cartas"
      subtitle="Escolha uma cota já contemplada e inicie a reserva. A transferência da cota é feita pela administradora do consórcio; nenhuma contemplação é prometida."
    />
  );

  // ----- Gate de KYC: sem verificação, não reserva -----
  if (!verificado) {
    const emAndamento = statusKyc === "em_analise";
    const bloqueado = statusKyc === "bloqueado";
    return (
      <AppShell nome={nome} tipo={tipo}>
        {header}
        <Card>
          <div className={styles.kycHead}>
            <span>Sua verificação:</span>
            <Badge tone={TONE_STATUS_KYC[statusKyc]}>{LABEL_STATUS_KYC[statusKyc]}</Badge>
          </div>
          <EmptyState
            icon={bloqueado ? "🚫" : emAndamento ? "⏳" : "🪪"}
            title={
              bloqueado
                ? "Reserva indisponível"
                : emAndamento
                ? "Verificação em análise"
                : "Verifique sua identidade primeiro"
            }
            description={
              bloqueado
                ? "Não é possível iniciar uma reserva neste momento. Fale com o atendimento para entender os próximos passos."
                : emAndamento
                ? "Recebemos seus dados e estamos analisando. Assim que sua identidade for verificada, você poderá reservar uma carta."
                : "Para reservar uma carta, primeiro conclua a verificação de identidade. É rápido e mantém seus dados protegidos."
            }
            action={
              bloqueado ? (
                <Button href={`https://wa.me/${WA}`}>Falar com o atendimento</Button>
              ) : emAndamento ? (
                <Button href="/meu-processo" variant="ghost">
                  Acompanhar
                </Button>
              ) : (
                <Button href="/kyc">Verificar identidade</Button>
              )
            }
          />
        </Card>
      </AppShell>
    );
  }

  // ----- Cliente verificado: wizard de reserva -----
  if (lista.length === 0) {
    return (
      <AppShell nome={nome} tipo={tipo}>
        {header}
        <EmptyState
          icon="🔎"
          title="Nenhuma carta disponível agora"
          description="No momento não há cartas disponíveis para reserva. Fale com o atendimento para receber novas oportunidades."
          action={<Button href={`https://wa.me/${WA}`}>Falar com o atendimento</Button>}
        />
      </AppShell>
    );
  }

  return (
    <AppShell nome={nome} tipo={tipo}>
      {header}
      <ReservarWizard cartas={lista} cartaInicial={searchParams.carta ?? null} />
    </AppShell>
  );
}
