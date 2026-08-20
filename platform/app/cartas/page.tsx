// ============================================================================
// /cartas — vitrine logada de cartas contempladas disponíveis.
// ----------------------------------------------------------------------------
// CATALOGO-UNIFICA-01 · FASE 2 — esta tela MUDOU DE FONTE, e só isso.
//
// Antes ela lia `nnv.cartas` sob RLS. Medido em 19/08/2026: 2 linhas, ZERO
// disponíveis. Quem logava via "Nenhuma carta disponível agora" — enquanto o
// site público, lendo o xtv, mostrava milhares. Duas fontes, uma verdade só.
// Agora lê `xtv.vw_vitrine_viva` pelo MESMO cliente do site (`createXtvClient`,
// server-side), via `lib/vitrine-fonte.ts`. Medido hoje: 2.295 linhas.
//
// A AUTENTICAÇÃO continua no nnv e continua acima de tudo: `createClient()`
// (sessão do usuário) decide se a página existe. A vitrine é catálogo público
// de produto — não há linha de cliente nela, não há `fornecedor_id` nela.
//
// A ORDENAÇÃO da lista é a mesma de sempre (ágio 150 desc, crédito asc) de
// propósito: se a ordem mudasse junto com a fonte, um resultado estranho na
// tela teria duas causas possíveis e nenhum jeito de separar as duas.
//
// REGRA 19 — o motivo real desta reescrita. O código antigo era:
//     const { data: cartas } = await query;      // o erro ia para o lixo
//     const lista = (cartas ?? []).map(...)      // e a falha virava lista vazia
// Falha de fonte e catálogo vazio ficavam IDÊNTICOS na tela, e o que o cliente
// lia era que a Bidcon não tem carta. Agora são três estados separados, e o
// terceiro (falha) tem mensagem própria e log próprio.
// ============================================================================
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { CartasExplorer } from "@/components/CartasExplorer";
import { lerCartasVitrine } from "@/lib/vitrine-fonte";
import { MSG_FALHA_VITRINE, MSG_VAZIO_VITRINE, WA_PROSPERITO } from "@/lib/vitrine";
import styles from "./cartas.module.css";

const TIPOS = ["imovel", "veiculo"] as const;

export default async function CartasPage({
  searchParams,
}: {
  searchParams: { tipo?: string };
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

  const tipoFiltro = TIPOS.includes(searchParams.tipo as (typeof TIPOS)[number])
    ? (searchParams.tipo as string)
    : null;

  // A leitura da vitrine (xtv) e a partição por `exclusiva` moram em
  // `lib/vitrine-fonte.ts`. Aqui só sobra o que é de TELA. O log da falha já
  // saiu lá dentro, com o motivo cru; o que chega aqui é a decisão.
  const leitura = await lerCartasVitrine({ tipo: tipoFiltro });
  const lista = leitura.ok ? leitura.dados : [];

  return (
    <AppShell nome={nome} tipo={tipo}>
      <div data-print="hide">
        <PageHeader
          title="Cartas disponíveis"
          backHref="/"
          subtitle="Cotas de consórcio já contempladas. Os valores são da carta; a transferência é feita pela administradora do consórcio."
        />
      </div>

      <nav className={styles.filtros} aria-label="Filtrar por tipo de bem" data-print="hide">
        <Button href="/cartas" variant={!tipoFiltro ? "primary" : "ghost"} size="sm">
          Todas
        </Button>
        <Button
          href="/cartas?tipo=imovel"
          variant={tipoFiltro === "imovel" ? "primary" : "ghost"}
          size="sm"
        >
          Imóvel
        </Button>
        <Button
          href="/cartas?tipo=veiculo"
          variant={tipoFiltro === "veiculo" ? "primary" : "ghost"}
          size="sm"
        >
          Veículo
        </Button>
      </nav>

      {/* Os TRÊS estados da Regra 19, nesta ordem — a falha primeiro, porque é
          ela que o `?? []` engolia. `EmptyState` não aceita `role`, então o
          alerta vem no invólucro: leitor de tela precisa saber que isto é um
          problema do sistema, e não uma resposta sobre o catálogo. */}
      {!leitura.ok ? (
        <div role="alert">
          <EmptyState
            icon="⚠️"
            title={MSG_FALHA_VITRINE}
            description="O catálogo continua de pé — foi a leitura que não voltou. Se persistir, fale com o atendimento."
            action={
              <Button href={`https://wa.me/${WA_PROSPERITO}`}>Falar com o atendimento</Button>
            }
          />
        </div>
      ) : lista.length === 0 ? (
        <EmptyState
          icon="🔎"
          title={MSG_VAZIO_VITRINE}
          description="No momento não há cartas que atendam a este filtro. Fale com o atendimento para receber novas oportunidades."
          action={
            <Button href={`https://wa.me/${WA_PROSPERITO}`}>Falar com o atendimento</Button>
          }
        />
      ) : (
        <CartasExplorer cartas={lista} />
      )}
    </AppShell>
  );
}
