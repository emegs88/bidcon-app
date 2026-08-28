// ============================================================================
// /reservar — fluxo logado de reserva de uma carta contemplada.
// ----------------------------------------------------------------------------
// CATALOGO-UNIFICA-01 · FASE 2.1 — esta tela tinha o defeito na forma mais
// crua que ele podia tomar, e por isso saiu da fatia geral e ganhou uma só.
//
// O código antigo era, em duas linhas:
//     const { data: cartas } = await supabase.from("cartas")...   // nnv
//     const lista = (cartas ?? []) as CartaReserva[];             // Regra 19
// `supabase` aqui é o cliente de SESSÃO do nnv. Medido: `nnv.cartas` tem 2
// linhas e ZERO disponíveis. Ou seja: todo cliente que concluía o KYC —
// justamente o que a casa mais quer atender — chegava na página chamada
// "Reservar" e lia "Nenhuma carta disponível agora", com 2.308 cartas vivas no
// xtv. E se a leitura FALHASSE, o `?? []` produzia exatamente a mesma tela.
//
// Agora: lê `xtv.vw_vitrine_viva` pela mesma torneira das outras telas
// (`lerCartasVitrine`), e os três estados da Regra 19 são distintos.
//
// A RESERVA É PONTE, NÃO WIZARD (decisão 2 do Emerson). `ReservarWizard` chama
// POST /api/reservar -> RPC `reservar_carta`, que grava em `nnv.reservas` com
// FK para `nnv.cartas`. Carta do xtv não existe lá: o wizard falharia SEMPRE,
// e falharia depois de o cliente escolher — o pior lugar para falhar. Então a
// escolha leva a `/cartas/[id]`, onde mora o botão que abre o WhatsApp da WABA
// viva com os números da carta no prefill. `ReservarWizard.tsx` FICA no disco,
// intocado: a FASE 3 (copy-on-reserve) o liga de volta, e apagá-lo agora só
// criaria trabalho de arqueologia depois.
//
// O GATE DE KYC CONTINUA como estava — só cliente 'verificado' passa. Ele não
// foi afrouxado nem endurecido nesta fatia. Fica REGISTRADO um efeito colateral
// que o Emerson pode querer decidir: como a ação agora é a mesma ponte que
// `/cartas` oferece a qualquer pessoa logada, o gate aqui deixou de proteger
// algo que já não está protegido ao lado. Ou `/reservar` para de exigir KYC
// para VER, ou `/cartas` passa a exigir — as duas são defensáveis, e nenhuma
// das duas é decisão minha. Mexer nisso caladamente seria mudar política de
// acesso dentro de um PR de leitura.
//
// Compliance: mostra só valor da carta / recursos próprios. Nada de
// administradora/taxa/fundo. Não promete contemplação.
// ============================================================================
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CartasExplorer } from "@/components/CartasExplorer";
import { LABEL_STATUS_KYC, TONE_STATUS_KYC, type StatusKYC } from "@/lib/status";
import { lerCartasVitrine } from "@/lib/vitrine-fonte";
import {
  MSG_FALHA_VITRINE,
  MSG_VAZIO_VITRINE,
  NOTA_RESERVA_PONTE,
  WA_PROSPERITO,
} from "@/lib/vitrine";
import styles from "./reservar.module.css";

const WA = WA_PROSPERITO;

// `/reservar?carta=<uuid>` era o atalho que abria o wizard já na carta certa.
// Com a ponte, o lugar equivalente é a página da carta. Medido: NENHUM arquivo
// do repo gera esse link hoje (só a nav aponta para `/reservar` puro), então
// isto atende link antigo colado em conversa — e é exatamente quem não pode
// levar 404. Só redireciona se for uuid: valor estranho segue para a lista, em
// vez de virar uma URL inventada.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Antes de qualquer leitura: se veio com carta na URL, o destino é a página
  // dela. (`redirect` lança — nada abaixo executa.)
  const cartaAlvo = searchParams.carta ?? null;
  if (cartaAlvo && UUID.test(cartaAlvo)) redirect(`/cartas/${cartaAlvo}`);

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

  // Cartas disponíveis — MESMA torneira de `/cartas` e da home: xtv,
  // `vw_vitrine_viva`, via `lerCartasVitrine`. `leitura.ok` distingue os três
  // estados da Regra 19; o `?? []` que existia aqui apagava justamente essa
  // diferença. `lista` só é povoada quando a leitura VOLTOU.
  const leitura = await lerCartasVitrine();
  const lista = leitura.ok ? leitura.dados : [];

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

  // ----- Cliente verificado: os três estados da Regra 19 -----
  // Falha e vazio real NÃO são a mesma tela, e nenhuma das duas mente sobre a
  // outra: "não consegui ler" fala de nós, "não há carta" fala do estoque.
  return (
    <AppShell nome={nome} tipo={tipo}>
      {header}
      {!leitura.ok ? (
        <div role="alert">
          <EmptyState
            icon="⚠️"
            title={MSG_FALHA_VITRINE}
            description="O catálogo continua de pé — foi a leitura que não voltou. Se persistir, fale com o atendimento."
            action={<Button href={`https://wa.me/${WA}`}>Falar com o atendimento</Button>}
          />
        </div>
      ) : lista.length === 0 ? (
        <EmptyState
          icon="🔎"
          title={MSG_VAZIO_VITRINE}
          description="No momento não há cartas disponíveis para reserva. Fale com o atendimento para receber novas oportunidades."
          action={<Button href={`https://wa.me/${WA}`}>Falar com o atendimento</Button>}
        />
      ) : (
        <>
          {/* A ponte dita em uma linha, ANTES da escolha: quem escolhe aqui
              não cai num formulário — abre conversa com gente. Dizer isso
              depois do clique seria surpresa. */}
          <p className={styles.notaPonte}>
            {NOTA_RESERVA_PONTE}. Escolha a carta e continue pelo WhatsApp com os
            números dela já no texto.
          </p>
          <CartasExplorer cartas={lista} />
        </>
      )}
    </AppShell>
  );
}
