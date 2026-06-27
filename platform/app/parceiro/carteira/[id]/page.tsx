// /parceiro/carteira/[id] — detalhe de uma carta da carteira do parceiro.
// RLS já restringe o SELECT ao dono (parceiro_id = uid) ou admin; ainda assim
// usamos notFound() quando a carta não pertence ao parceiro. A ação de status
// (CartaStatusForm) chama a RPC definir_status_carta via Route Handler.
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_TIPO_BEM,
  LABEL_STATUS_CARTA,
  TONE_STATUS_CARTA,
  type StatusCarta,
} from "@/lib/status";
import { brl } from "@/lib/format";
import { CartaStatusForm } from "./CartaStatusForm";
import det from "@/app/cartas/[id]/detalhe.module.css";

export const dynamic = "force-dynamic";

export default async function CartaDetalheParceiro({
  params,
}: {
  params: { id: string };
}) {
  const sessao = await exigirPapel("parceiro", "admin");
  const supabase = createClient();

  const { data: carta } = await supabase
    .from("cartas")
    .select(
      "id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, status, parceiro_id, fonte"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!carta) notFound();

  // Cinto de segurança além da RLS: parceiro só gerencia o que é dele. Admin vê tudo.
  const ehDono = carta.parceiro_id === sessao.userId;
  const ehAdmin = sessao.perfil?.tipo === "admin";
  if (!ehDono && !ehAdmin) notFound();

  const status = carta.status as StatusCarta;
  const podeAlterar = ehDono || ehAdmin;

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Detalhe da carta"
        backHref="/parceiro/carteira"
        backLabel="Carteira"
      />

      <div className={det.stack}>
        <Card>
          <div className={det.top}>
            <Badge>{LABEL_TIPO_BEM[carta.tipo] ?? carta.tipo}</Badge>
            <Badge tone={TONE_STATUS_CARTA[status]}>
              {LABEL_STATUS_CARTA[status] ?? carta.status}
            </Badge>
          </div>
          <div className={det.credito}>{brl(carta.valor_credito)}</div>
          <p className={det.creditoLbl}>Crédito da carta</p>

          <dl className={det.dl}>
            <div className={det.row}>
              <dt>Entrada</dt>
              <dd>{brl(carta.valor_entrada)}</dd>
            </div>
            <div className={det.row}>
              <dt>Parcela</dt>
              <dd>{brl(carta.valor_parcela)}</dd>
            </div>
            <div className={det.row}>
              <dt>Parcelas restantes</dt>
              <dd>{carta.qtd_parcelas != null ? `${carta.qtd_parcelas}x` : "—"}</dd>
            </div>
          </dl>
        </Card>

        {podeAlterar && (
          <Card>
            <h2 className={det.h2}>Status da carta</h2>
            <p className={det.texto}>
              Defina como a carta aparece na vitrine. &ldquo;Indisponível&rdquo; a
              remove temporariamente sem apagar o cadastro.
            </p>
            <CartaStatusForm cartaId={carta.id} atual={status} />
          </Card>
        )}
      </div>
    </AppShell>
  );
}
