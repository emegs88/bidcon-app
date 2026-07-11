// /cartas — vitrine logada de cartas contempladas disponíveis.
// Server Component. Lê via Supabase (RLS): a leitura pública das cartas
// 'disponivel' depende da policy da migration 0005 (cartas_vitrine_select).
// Filtro opcional por tipo via query param (?tipo=imovel|veiculo).
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { type CartaVitrine } from "@/components/CartaCard";
import { CartasExplorer } from "@/components/CartasExplorer";
import styles from "./cartas.module.css";

const WA = "5511973202967";
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

  // Join SÓ com administradoras (marca pública do bem; RLS libera p/ logado).
  // NUNCA selecionar fornecedor_id/fornecedores aqui — é segredo admin-only.
  // O embed do PostgREST devolve `administradora` como objeto (ou null).
  let query = supabase
    .from("cartas")
    .select(
      "id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, bidcon_agio_150, bidcon_agio_120, bidcon_custo_am, administradora:administradora_id ( nome, aceita_assuncao )"
    )
    .eq("status", "disponivel")
    .order("bidcon_agio_150", { ascending: false, nullsFirst: false })
    .order("valor_credito", { ascending: true });

  if (tipoFiltro) query = query.eq("tipo", tipoFiltro);

  const { data: cartas } = await query;
  // PostgREST tipa o embed como array; normalizamos para objeto | null.
  const lista: CartaVitrine[] = (cartas ?? []).map((c) => {
    const adm = (c as { administradora?: unknown }).administradora;
    const administradora = Array.isArray(adm) ? (adm[0] ?? null) : (adm ?? null);
    return {
      id: c.id,
      tipo: c.tipo,
      valor_credito: c.valor_credito,
      valor_entrada: c.valor_entrada,
      valor_parcela: c.valor_parcela,
      qtd_parcelas: c.qtd_parcelas,
      bidcon_agio_150: c.bidcon_agio_150,
      bidcon_agio_120: c.bidcon_agio_120,
      bidcon_custo_am: c.bidcon_custo_am,
      administradora: administradora as CartaVitrine["administradora"],
    };
  });

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

      {lista.length === 0 ? (
        <EmptyState
          icon="🔎"
          title="Nenhuma carta disponível agora"
          description="No momento não há cartas que atendam a este filtro. Fale com o atendimento para receber novas oportunidades."
          action={<Button href={`https://wa.me/${WA}`}>Falar com o atendimento</Button>}
        />
      ) : (
        <CartasExplorer cartas={lista} />
      )}
    </AppShell>
  );
}
