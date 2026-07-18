// /minha-carta (CEDENTE-01) — Server Component.
// Portal da vendedora: lê o vínculo dela em `cedente_cartas` (nnv, RLS: só o
// próprio profile_id) e, se houver, busca os dados reais da carta no xtv via
// createXtvClient() (service_role, SÓ no servidor — nunca exposto ao client).
//
// Arquitetura (CEDENTE-01, decidida antes desta fatia): a carta em si mora no
// xtv (motor de sync + capturas cliente_direto/manual); auth/portal mora no
// nnv. `cedente_cartas.carta_xtv_id` é um uuid solto (sem FK — projetos
// Supabase distintos), resolvido em runtime aqui.
//
// Status exibido: se existir um `processo` no nnv referenciando esta carta
// (carta_id = carta_xtv_id — o mesmo uuid, arquitetura de promoção xtv->nnv
// da PONTE-01, ainda não implementada nesta fatia), mostramos "Em
// negociação"; senão espelhamos `cartas.status` do xtv ("No ar" pra
// disponivel). Nunca prometemos prazo de venda nem data de contemplação.
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createXtvClient } from "@/lib/supabase-xtv";
import { redirect } from "next/navigation";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { LABEL_TIPO_BEM } from "@/lib/status";
import { brl, linkWhatsApp } from "@/lib/format";
import styles from "./minha-carta.module.css";

// Fontes de marca (identidade visual da vitrine pública) escopadas só a esta
// página via CSS var — o resto da área logada continua em system-ui; não é
// uma mudança de tipografia global.
const titulo = Space_Grotesk({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-title" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-mono" });

const WA = "5519997561909";

type CartaXtv = {
  id: string;
  tipo: string;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
  bidcon_custo_am: number | null;
  bidcon_agio_150: number | null;
  status: "disponivel" | "reservada" | "vendida" | "indisponivel";
  fonte: string;
  administradora_raw: string | null;
  administradora: { nome: string } | { nome: string }[] | null;
};

function nomeAdministradora(carta: CartaXtv): string {
  const adm = Array.isArray(carta.administradora) ? carta.administradora[0] : carta.administradora;
  return adm?.nome ?? carta.administradora_raw ?? "—";
}

export default async function MinhaCarta() {
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

  // RLS garante que só vem o vínculo do próprio profile_id (ou tudo, se admin).
  // Pega o mais recente — hoje é sempre 1 vínculo por cedente; a tabela já
  // suporta mais de um pra quando existir um segundo cartão por cedente.
  const { data: vinculo } = await supabase
    .from("cedente_cartas")
    .select("carta_xtv_id")
    .eq("profile_id", user.id)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  const mensagemWA = `Olá! Aqui é ${nome ?? "a vendedora"}. Quero enviar o extrato atualizado da minha carta (cláusula 4ª) pra manter as condições certas no anúncio.`;

  // ----- estado vazio: sem vínculo em cedente_cartas -----
  if (!vinculo) {
    return (
      <AppShell nome={nome} tipo={tipo}>
        <PageHeader title="Minha carta" backHref="/" />
        <EmptyState
          title="Nenhuma carta vinculada"
          description="Ainda não encontramos uma carta associada ao seu cadastro. Se você é cedente e espera ver sua carta aqui, fale com o atendimento."
          action={<Button href={linkWhatsApp(WA, "Olá! Não estou vendo minha carta em Minha carta no portal.")}>Falar com o atendimento</Button>}
        />
      </AppShell>
    );
  }

  const xtvDb = createXtvClient();
  const { data: cartaRaw } = await xtvDb
    .from("cartas")
    .select(
      "id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, bidcon_custo_am, bidcon_agio_150, status, fonte, administradora_raw, administradora:administradora_id ( nome )"
    )
    .eq("id", vinculo.carta_xtv_id)
    .maybeSingle();
  const carta = cartaRaw as CartaXtv | null;

  // ----- estado vazio: vínculo existe mas a carta não foi encontrada no xtv -----
  if (!carta) {
    return (
      <AppShell nome={nome} tipo={tipo}>
        <PageHeader title="Minha carta" backHref="/" />
        <EmptyState
          title="Não encontramos os dados da carta"
          description="Seu vínculo existe, mas não conseguimos ler os dados da carta agora. Fale com o atendimento."
          action={<Button href={linkWhatsApp(WA, mensagemWA)}>Falar com o atendimento</Button>}
        />
      </AppShell>
    );
  }

  // Se existir processo formal (nnv) referenciando esta carta (mesmo uuid —
  // arquitetura PONTE-01, ainda não implementada), a negociação está em
  // andamento; senão espelha o status bruto da carta no xtv.
  // Usa createAdminClient() (service_role) de propósito: a policy de
  // `processos` só libera cliente_id/parceiro_id/is_admin(), e a cedente não
  // é nenhuma das duas partes do processo do comprador — com o client anon
  // (RLS) essa consulta sempre voltaria vazia pra ela, mesmo com processo
  // ativo. Leitura restrita a `id` (só existência), nunca exposta ao client.
  const { data: processo } = await createAdminClient()
    .from("processos")
    .select("id")
    .eq("carta_id", carta.id)
    .maybeSingle();

  const exclusiva = carta.fonte === "cliente_direto";
  const administradora = nomeAdministradora(carta);
  const tipoLabel = LABEL_TIPO_BEM[carta.tipo] ?? carta.tipo;

  const statusLabel = processo
    ? "Em negociação"
    : carta.status === "disponivel"
      ? "No ar"
      : carta.status === "reservada"
        ? "Reservada"
        : carta.status === "vendida"
          ? "Vendida"
          : "Indisponível";

  const custoAm =
    carta.bidcon_custo_am != null
      ? `${carta.bidcon_custo_am.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% a.m.`
      : "—";

  return (
    <AppShell nome={nome} tipo={tipo}>
      <div className={`${styles.wrap} ${titulo.variable} ${mono.variable}`}>
        <PageHeader title="Minha carta" backHref="/" />

        {/* 1. Card espelhando a vitrine */}
        <div className={exclusiva ? styles.ring : undefined}>
          <Card>
            <div className={styles.cardTop}>
              <span className={styles.administradora}>{administradora}</span>
              {exclusiva && <span className={styles.selo}>✓ Exclusiva Bidcon</span>}
            </div>
            <h2 className={styles.tipo}>{tipoLabel}</h2>
            <dl className={styles.grid}>
              <div>
                <dt>Crédito</dt>
                <dd className={styles.mono}>{brl(carta.valor_credito)}</dd>
              </div>
              <div>
                <dt>Entrada</dt>
                <dd className={styles.mono}>{brl(carta.valor_entrada)}</dd>
              </div>
              <div>
                <dt>Parcelas</dt>
                <dd className={styles.mono}>
                  {carta.qtd_parcelas ?? "—"}× {brl(carta.valor_parcela)}
                </dd>
              </div>
              <div>
                <dt>Custo efetivo</dt>
                <dd className={styles.mono}>{custoAm}</dd>
              </div>
            </dl>
            <div className={styles.statusRow}>
              <span className={styles.statusBadge} data-status={carta.status}>
                {statusLabel}
              </span>
            </div>
          </Card>
        </div>

        {/* 2. Seu anúncio em destaque */}
        <Card>
          <h2 className={styles.h2}>Seu anúncio em destaque</h2>
          <p className={styles.p}>
            Sua carta é uma captação direta e por isso aparece fixada no topo da vitrine pública da
            Bidcon, à frente das demais — inclusive nas buscas feitas por compradores em
            ferramentas como ChatGPT, Google e Bing, que leem o conteúdo público da vitrine.
          </p>
        </Card>

        {/* 3. Atualização de condições (Cláusula 4ª) */}
        <Card>
          <h2 className={styles.h2}>Atualização de condições (Cláusula 4ª)</h2>
          <p className={styles.p}>
            Se as condições da sua carta mudaram (saldo devedor, parcelas ou crédito), envie o
            extrato atualizado da administradora pra mantermos o anúncio correto.
          </p>
          <Button href={linkWhatsApp(WA, mensagemWA)}>Enviar extrato pelo WhatsApp</Button>
        </Card>

        {/* 4. Propostas (placeholder informativo — fluxo real fica pra CEDENTE-02) */}
        <Card>
          <h2 className={styles.h2}>Propostas</h2>
          <p className={styles.p}>
            Ainda não há propostas formalizadas aqui no portal. Assim que um comprador demonstrar
            interesse, o atendimento avisa você diretamente pelo WhatsApp.
          </p>
        </Card>

        {/* 5. Rodapé de compliance */}
        <p className={styles.compliance}>
          A Bidcon atua em planejamento e compra programada de bens via consórcio. Não há promessa
          de prazo de venda nem de data de contemplação; toda transferência de cota está sujeita à
          aprovação da administradora.
        </p>
      </div>
    </AppShell>
  );
}
