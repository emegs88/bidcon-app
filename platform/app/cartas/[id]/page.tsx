// /cartas/[id] — detalhe de uma carta contemplada disponível.
// Server Component. Leitura via Supabase (RLS): depende da policy da migration
// 0005 (cartas_vitrine_select) para o cliente enxergar estoque (parceiro_id null).
// CTA "Tenho interesse" abre o WhatsApp do atendimento com texto neutro citando a
// carta. Sem linguagem de promessa/contemplação garantida.
import { createClient } from "@/lib/supabase-server";
import { redirect, notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LABEL_TIPO_BEM } from "@/lib/status";
import { brl, linkWhatsApp } from "@/lib/format";
import styles from "./detalhe.module.css";

const WA = "5511973202967";

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
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome")
    .eq("id", user.id)
    .single();
  const nome = profile?.nome ?? user.email ?? null;

  // Join SÓ com administradoras (marca pública). NUNCA selecionar fornecedor.
  const { data: carta } = await supabase
    .from("cartas")
    .select(
      "id, tipo, numero_externo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, status, administradora:administradora_id ( nome, aceita_assuncao )"
    )
    .eq("id", params.id)
    .eq("status", "disponivel")
    .maybeSingle();

  if (!carta) notFound();
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
