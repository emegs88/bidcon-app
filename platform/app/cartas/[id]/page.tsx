// /cartas/[id] — detalhe de uma carta contemplada disponível.
// Server Component. PÚBLICA (FATIA SYNC-ID, migration 0048): a query já filtra
// status='disponivel', e a policy cartas_vitrine_select_anon (RLS) libera esse
// mesmo recorte pro role anon — não há redirect de login aqui. Isso resolve o
// destino do botão "Ver carta" do carrossel de marketing do WhatsApp e o gap
// chat→cadastro (auditoria 2026-07). A ação de RESERVAR continua exigindo
// login: o botão abaixo leva a /reservar, que mantém seu próprio redirect.
// CTA "Tenho interesse" abre o WhatsApp do atendimento com texto neutro citando a
// carta. Sem linguagem de promessa/contemplação garantida.
import { createClient } from "@/lib/supabase-server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { type CartaVitrine } from "@/components/CartaCard";
import { CartaForaDaVitrine } from "./CartaForaDaVitrine";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LABEL_TIPO_BEM } from "@/lib/status";
import { brl, linkWhatsApp } from "@/lib/format";
import styles from "./detalhe.module.css";

const WA = "5519997561909";

type CartaDetalhe = {
  id: string;
  tipo: string;
  numero_externo: string | null;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
  status: string;
  // marca pública do bem (join administradoras, RLS p/ logado). NUNCA fornecedor.
  administradora: { nome: string; aceita_assuncao: boolean } | null;
};

export default async function CartaDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // sem login: visitante público (carrossel WhatsApp, chat sem cadastro etc.).
  // AppShell recebe nome=null e omite o botão "Sair" nesse caso.
  let nome: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("nome")
      .eq("id", user.id)
      .single();
    nome = profile?.nome ?? user.email ?? null;
  }

  // Join SÓ com administradoras (marca pública). NUNCA selecionar fornecedor.
  const { data: carta } = await supabase
    .from("cartas")
    .select(
      "id, tipo, numero_externo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, status, administradora:administradora_id ( nome, aceita_assuncao )"
    )
    .eq("id", params.id)
    .eq("status", "disponivel")
    .maybeSingle();

  // CARROSSEL-OPS-01 Peça 4 — a query acima (RLS anon + `.eq(status,
  // disponivel)`) devolve vazio em DOIS casos distintos que o 404 seco
  // confundia: id que nunca existiu e carta que saiu da vitrine. O segundo é o
  // caso majoritário dos links de carrossel em D+2 (a vitrine é substituída
  // inteira por rodada de sync). Só aqui, e nunca no caminho `disponivel`
  // acima, desempatamos com um lookup mínimo por service-role.
  if (!carta) {
    const morta = await buscarCartaForaDaVitrine(params.id);
    if (!morta) notFound(); // id inexistente/uuid inválido: 404 real, como antes.
    const similares = await buscarSimilares(supabase, morta);
    return (
      <AppShell nome={nome}>
        <CartaForaDaVitrine
          tipoLabel={LABEL_TIPO_BEM[morta.tipo] ?? morta.tipo}
          similares={similares}
        />
      </AppShell>
    );
  }

  // PostgREST tipa o embed como array; normalizamos para objeto | null.
  const adm = (carta as { administradora?: unknown }).administradora;
  const administradora = Array.isArray(adm) ? (adm[0] ?? null) : (adm ?? null);
  const c = { ...carta, administradora } as CartaDetalhe;

  const ref = c.numero_externo ? `nº ${c.numero_externo}` : `ref. ${c.id.slice(0, 8)}`;
  const tipoLabel = LABEL_TIPO_BEM[c.tipo] ?? c.tipo;

  // Saldo devedor do consórcio = parcela × parcelas restantes (a entrada/ágio
  // NÃO abate o saldo junto à administradora). Só exibe se houver os dois dados.
  const saldoDevedor =
    c.valor_parcela != null && c.qtd_parcelas != null
      ? c.valor_parcela * c.qtd_parcelas
      : null;

  const mensagem =
    `Olá! Tenho interesse na carta de ${tipoLabel.toLowerCase()} (${ref}), ` +
    `crédito de ${brl(c.valor_credito)}. Pode me passar mais informações?`;

  return (
    <AppShell nome={nome}>
      <PageHeader
        title={`Carta de ${tipoLabel}`}
        backHref="/cartas"
        backLabel="Cartas"
        subtitle="Cota de consórcio já contemplada. Os valores são da carta; a transferência da cota é feita pela administradora do consórcio."
      />

      <div className={styles.stack}>
        <Card>
          <div className={styles.top}>
            <Badge tone={c.tipo === "imovel" ? "info" : "amber"}>{tipoLabel}</Badge>
            <Badge tone="ok">Disponível</Badge>
          </div>

          <div className={styles.credito}>{brl(c.valor_credito)}</div>
          <div className={styles.creditoLbl}>crédito da carta · {ref}</div>

          <dl className={styles.dl}>
            <div className={styles.row}>
              <dt>Tipo de bem</dt>
              <dd>{tipoLabel}</dd>
            </div>
            {c.administradora?.nome && (
              <div className={styles.row}>
                <dt>Administradora</dt>
                <dd>{c.administradora.nome}</dd>
              </div>
            )}
            {c.administradora?.aceita_assuncao && (
              <div className={styles.row}>
                <dt>Transferência</dt>
                <dd>Aceita assunção de cota</dd>
              </div>
            )}
            <div className={styles.row}>
              <dt>Crédito da carta</dt>
              <dd>{brl(c.valor_credito)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Entrada</dt>
              <dd>{brl(c.valor_entrada)}</dd>
            </div>
            {c.valor_parcela != null && (
              <div className={styles.row}>
                <dt>Parcela</dt>
                <dd>{brl(c.valor_parcela)}</dd>
              </div>
            )}
            {c.qtd_parcelas != null && (
              <div className={styles.row}>
                <dt>Parcelas restantes</dt>
                <dd>{c.qtd_parcelas}x</dd>
              </div>
            )}
            {saldoDevedor != null && (
              <div className={styles.row}>
                <dt>Saldo devedor</dt>
                <dd>{brl(saldoDevedor)}</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <h2 className={styles.h2}>Tem interesse nesta carta?</h2>
          <p className={styles.texto}>
            Inicie a reserva pela plataforma ou fale com o atendimento pelo
            WhatsApp para tirar dúvidas sobre a transferência da cota junto à
            administradora do consórcio. Nenhuma contemplação é prometida:
            trata-se de uma cota já contemplada sendo transferida.
          </p>
          <Button href={`/reservar?carta=${c.id}`} block>
            Reservar esta carta
          </Button>
          <div className={styles.ctaSecundario}>
            <Button href={linkWhatsApp(WA, mensagem)} variant="ghost" block>
              Falar no WhatsApp
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

// ============================================================================
// CARROSSEL-OPS-01 Peça 4 — suporte do ramo "carta fora da vitrine".
// ============================================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Campos que a vitrine lê pro card. Mantido idêntico ao select de /cartas pra
// que o MESMO componente (CartaCard) receba exatamente a mesma forma de dado.
const CAMPOS_CARD =
  "id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, bidcon_agio_150, bidcon_agio_120, bidcon_custo_am, administradora:administradora_id ( nome, aceita_assuncao )";

type CartaMorta = { id: string; tipo: string; valor_credito: number };

/** Lookup MÍNIMO por id, ignorando RLS — a policy anon só enxerga
 *  `disponivel`, então sem service-role não há como distinguir "saiu da
 *  vitrine" de "nunca existiu". Servidor apenas (createXtvClient quebra o
 *  build se importado de Client Component). Lê só 4 colunas: nada de
 *  entrada/parcela/custo, que estão vencidos e não vão à tela. */
async function buscarCartaForaDaVitrine(id: string): Promise<CartaMorta | null> {
  if (!UUID_RE.test(id)) return null; // uuid inválido nem chega ao banco.
  const db = createXtvClient();
  const { data } = await db
    .from("cartas")
    .select("id, tipo, valor_credito, status")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.status === "disponivel") return null;
  return { id: data.id, tipo: data.tipo, valor_credito: data.valor_credito };
}

/** 3–4 cartas vivas semelhantes. Lidas pelo client COM RLS (mesmo caminho da
 *  vitrine) e ainda assim com `.eq("status","disponivel")` explícito — o
 *  filtro nunca é herdado. Faixa ±30% do crédito da carta morta, mesmo tipo;
 *  sem semelhantes suficientes, completa com o topo geral. */
async function buscarSimilares(
  supabase: ReturnType<typeof createClient>,
  morta: CartaMorta
): Promise<CartaVitrine[]> {
  const base = () =>
    supabase
      .from("cartas")
      .select(`${CAMPOS_CARD}, administradora_origem`)
      .eq("status", "disponivel")
      .neq("id", morta.id)
      // Mesma ordenação da vitrine (/cartas), copiada sem alteração.
      .order("bidcon_agio_150", { ascending: false, nullsFirst: false })
      .order("valor_credito", { ascending: true });

  const { data: faixa } = await base()
    .eq("tipo", morta.tipo)
    .gte("valor_credito", morta.valor_credito * 0.7)
    .lte("valor_credito", morta.valor_credito * 1.3)
    .limit(12);

  let brutas = faixa ?? [];
  if (brutas.length < 3) {
    const { data: topo } = await base().limit(12);
    const vistos = new Set(brutas.map((c) => c.id as string));
    brutas = [...brutas, ...(topo ?? []).filter((c) => !vistos.has(c.id as string))];
  }

  // Regra da casa: BIDCON_DIRETO primeiro. Partição ESTÁVEL — dentro de cada
  // bloco a ordem do banco (ágio, depois crédito) é preservada.
  const direto = brutas.filter((c) => c.administradora_origem === "BIDCON_DIRETO");
  const resto = brutas.filter((c) => c.administradora_origem !== "BIDCON_DIRETO");

  return [...direto, ...resto].slice(0, 4).map((c) => {
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
}
