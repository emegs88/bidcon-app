// /cartas/[id] — detalhe de uma carta contemplada.
// Server Component. PÚBLICA: não há redirect de login aqui, porque este é o
// destino do botão "Ver carta" do carrossel de marketing do WhatsApp e do gap
// chat→cadastro (auditoria 2026-07). A ação de RESERVAR continua exigindo
// login: o botão abaixo leva a /reservar, que mantém seu próprio redirect.
// CTA "Tenho interesse" abre o WhatsApp do atendimento com texto neutro citando a
// carta. Sem linguagem de promessa/contemplação garantida.
//
// DOIS BANCOS, de propósito (ver medição no comentário longo dentro da função):
//   • AUTH + `profiles` → createClient()   (projeto nnv, RLS, sessão do usuário)
//   • ESTOQUE (`cartas`) → createXtvClient() (projeto xtv, service-role)
// Como o client de estoque é service-role e IGNORA RLS numa página pública,
// TODA query de carta aqui carrega `.eq("status","disponivel")` explícito e
// lista as colunas uma a uma. `fornecedor_id` NUNCA entra em select algum.
import { createClient } from "@/lib/supabase-server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { type CartaVitrine } from "@/components/CartaCard";
import { CartaForaDaVitrine, VITRINE_PUBLICA } from "./CartaForaDaVitrine";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LABEL_TIPO_BEM } from "@/lib/status";
import { custoEfetivoCarta, fmtCustoEfetivo } from "@/lib/custo-efetivo";
import { brl, linkWhatsApp } from "@/lib/format";
import {
  linkReservaPonte,
  ordenarExclusivaPrimeiro,
  NOTA_RESERVA_PONTE,
  WA_PROSPERITO,
} from "@/lib/vitrine";
import styles from "./detalhe.module.css";

// Mesmo número que este arquivo já usava literalmente; agora vem de um lugar só,
// junto com os outros quatro arquivos do app logado. (O site público usa OUTRO
// número — divergência medida e reportada, resolvida fora desta fatia.)
const WA = WA_PROSPERITO;

type CartaDetalhe = {
  id: string;
  tipo: string;
  // no xtv esta coluna é `integer`; no nnv era texto. Aceita os dois: só é
  // interpolada como rótulo (`nº 1234`), nunca usada em cálculo.
  numero_externo: string | number | null;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
  status: string;
  // marca pública do bem (join administradoras, RLS p/ logado). NUNCA fornecedor.
  //
  // `aceita_assuncao` é `boolean | null` e não `boolean`: medido em 20/08/2026,
  // `xtv.administradoras` tem 37 linhas (35 true, 2 false, 0 null) — mas o join
  // pode não casar, e nesse caso o valor é NÃO SEI, não "não aceita". O `null`
  // é falsy, então a linha "Aceita assunção de cota" continua sumindo; a
  // diferença é que a casa não afirma o que não mediu.
  administradora: { nome: string; aceita_assuncao: boolean | null } | null;
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

  // CARROSSEL-OPS-01 Peça 4 (correção A, 06/08/2026) — DE ONDE VEM O ESTOQUE.
  // Medido em produção: `createClient()` aponta pro projeto de AUTH (nnv), cuja
  // tabela `cartas` tem 2 linhas de fixture (`1111…`/`2222…`, ambas
  // `reservada`) e ZERO `disponivel`. O estoque real — 2.584 vivas — mora no
  // projeto xtv, o mesmo lido por /api/vitrine, /api/atende e pelo montador do
  // carrossel, e os espaços de uuid são disjuntos. Resultado: TODO link
  // `/cartas/<uuid>` do carrossel caía em 404, viva ou morta a carta — este
  // ramo `disponivel` nunca foi alcançável em produção.
  // Auth e `profiles` continuam no nnv (é lá que eles moram); só a leitura de
  // ESTOQUE muda de banco.
  //
  // CUIDADO: service-role IGNORA RLS e esta página é PÚBLICA. Portanto:
  //  • `.eq("status","disponivel")` é explícito aqui e NUNCA herdado — sem RLS
  //    ele é a única coisa que impede servir carta fora da vitrine;
  //  • o select lista coluna a coluna. NUNCA incluir `fornecedor_id` (existe no
  //    xtv, com FK própria, e é segredo admin-only). Só `administradoras`, que
  //    é marca pública do bem.
  if (!UUID_RE.test(params.id)) notFound(); // id inválido nem chega ao banco.

  const db = createXtvClient();
  const { data: carta } = await db
    .from("cartas")
    .select(
      "id, tipo, numero_externo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, status, administradora:administradora_id ( nome, aceita_assuncao )"
    )
    .eq("id", params.id)
    .eq("status", "disponivel")
    .maybeSingle();

  // CARROSSEL-OPS-01 Peça 4 — a query acima devolve vazio em DOIS casos
  // distintos que o 404 seco confundia: id que nunca existiu e carta que saiu
  // da vitrine. O segundo é o caso majoritário dos links de carrossel em D+2 (a
  // vitrine é substituída inteira por rodada de sync). Só aqui, e nunca no
  // caminho `disponivel` acima, desempatamos com um lookup mínimo sem o filtro
  // de status.
  if (!carta) {
    const morta = await buscarCartaForaDaVitrine(db, params.id);
    if (!morta) notFound(); // id que nunca existiu: 404 real, como antes.
    const similares = await buscarSimilares(db, morta);
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

  // CARROSSEL-OPS-01 extensão (06/08/2026) — POR QUE ESTA LINHA EXISTE.
  // O card do WhatsApp anuncia "CUSTO AO MÊS 0,65% a.m." e leva pra cá; medido
  // no HTML de produção, esta página não tinha NENHUM campo de custo (nem
  // "custo", nem "% a.m.", nem "taxa"). O clique entregava menos do que a arte
  // prometia. Aqui fechamos isso.
  // NÚMERO IDÊNTICO AO DO CARD, por construção e não por coincidência: o card
  // (lib/carrossel-formato) chama esta MESMA `custoEfetivoCarta` sobre as MESMAS
  // 4 colunas, e seu `pctAoMes` é um re-export de `fmtCustoEfetivo`. Se um dia
  // alguém trocar a fórmula aqui, o card muda junto — é essa a intenção.
  // NÃO usamos a coluna `bidcon_custo_am`: ela é um valor gravado no sync e
  // diverge do calculado em 17 das 2.596 cartas vivas (0,01 p.p.), o que
  // reintroduziria exatamente a discrepância que esta linha veio corrigir.
  // `null` quando não há parcela/prazo — nesse caso a linha some, como as
  // vizinhas, em vez de exibir "—".
  const custoAm = custoEfetivoCarta(c);

  const mensagem =
    `Olá! Tenho interesse na carta de ${tipoLabel.toLowerCase()} (${ref}), ` +
    `crédito de ${brl(c.valor_credito)}. Pode me passar mais informações?`;

  // CATALOGO-UNIFICA-01 · FASE 2 (decisão 2 do Emerson) — A RESERVA VIRA PONTE.
  //
  // Esta carta veio do xtv. O fluxo `/reservar` grava em `nnv.reservas`, cuja FK
  // aponta para `nnv.cartas` — 2 linhas, nenhuma delas esta. Ou seja: o botão
  // "Reservar esta carta" levava, por construção, a um caminho que não podia
  // completar. A decisão foi ponte, não bloqueio: mandar para o canal que JÁ
  // funciona hoje, com os números da carta já escritos na mensagem.
  //
  // `ref` numérico para a mensagem: no xtv `numero_externo` é `integer` (o tipo
  // aceita string por herança do nnv, onde era texto). Quando não for número,
  // vai `null` e `refCarta` cai no prefixo do uuid — nunca "nº NaN".
  const refNumero =
    typeof c.numero_externo === "number"
      ? c.numero_externo
      : c.numero_externo != null && Number.isFinite(Number(c.numero_externo))
        ? Number(c.numero_externo)
        : null;

  const hrefReserva = linkReservaPonte({
    id: c.id,
    ref: refNumero,
    tipo: c.tipo,
    valor_credito: c.valor_credito,
    valor_entrada: c.valor_entrada,
    valor_parcela: c.valor_parcela,
    qtd_parcelas: c.qtd_parcelas,
  });

  return (
    <AppShell nome={nome}>
      <PageHeader
        title={`Carta de ${tipoLabel}`}
        backHref={VITRINE_PUBLICA}
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
            {custoAm != null && (
              <div className={styles.row}>
                <dt>Custo ao mês</dt>
                <dd>{fmtCustoEfetivo(custoAm)}</dd>
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
            {NOTA_RESERVA_PONTE}: o atendimento confere os valores com você e
            conduz a transferência da cota junto à administradora do consórcio.
            Nenhuma contemplação é prometida: trata-se de uma cota já
            contemplada sendo transferida.
          </p>
          <Button href={hrefReserva} block>
            Reservar esta carta
          </Button>
          <div className={styles.ctaSecundario}>
            <Button href={linkWhatsApp(WA, mensagem)} variant="ghost" block>
              Tirar dúvidas no WhatsApp
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

/** Lookup MÍNIMO por id, SEM o filtro de status — é o único jeito de
 *  distinguir "saiu da vitrine" de "nunca existiu", já que a query principal
 *  devolve vazio nos dois casos. Recebe o client de fora (mesmo `db` da query
 *  principal) pra não abrir uma segunda conexão service-role por request.
 *  Lê só 4 colunas: nada de entrada/parcela/custo, que estão vencidos e não
 *  vão à tela. */
async function buscarCartaForaDaVitrine(
  db: ReturnType<typeof createXtvClient>,
  id: string
): Promise<CartaMorta | null> {
  if (!UUID_RE.test(id)) return null; // uuid inválido nem chega ao banco.
  const { data } = await db
    .from("cartas")
    .select("id, tipo, valor_credito, status")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.status === "disponivel") return null;
  return { id: data.id, tipo: data.tipo, valor_credito: data.valor_credito };
}

/** 3–4 cartas vivas semelhantes, lidas do MESMO banco de estoque (xtv) que a
 *  query principal. `.eq("status","disponivel")` é explícito e obrigatório: o
 *  client é service-role, IGNORA RLS, e este é o único filtro que impede
 *  anunciar carta fora da vitrine numa página pública. Faixa ±30% do crédito
 *  da carta morta, mesmo tipo; sem semelhantes suficientes, completa com o
 *  topo geral. */
async function buscarSimilares(
  db: ReturnType<typeof createXtvClient>,
  morta: CartaMorta
): Promise<CartaVitrine[]> {
  const base = () =>
    db
      .from("cartas")
      .select(`${CAMPOS_CARD}, fonte`)
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

  // CATALOGO-UNIFICA-01 · FASE 2 (decisão 3 do Emerson) — O EIXO OFICIAL.
  //
  // Esta partição comparava a STRING `administradora_origem === "BIDCON_DIRETO"`.
  // O problema não é que estivesse errada — é que ela mora no campo errado:
  // `administradora_origem` guarda o FORNECEDOR do feed (medido hoje, entre as
  // 2.308 disponíveis: PLAYCONTEMPLADAS 921 · CBC 576 · PIFFER 469 · CARTAS 183
  // · LANCE 156 · BIDCON_DIRETO 3). Proveniência é identidade, e um rótulo
  // morando no namespace do fornecedor é o homônimo esperando acontecer.
  //
  // O eixo passa a ser `fonte = 'cliente_direto'`. CONTROLE da troca, medido
  // antes de trocar: so_fonte 0 · so_rotulo 0 · ambos 3 — os dois eixos
  // concordam hoje linha a linha, então esta mudança não move nenhum pixel; ela
  // só tira o código de cima de uma coincidência não amarrada por constraint.
  //
  // A ordenação vem de `ordenarExclusivaPrimeiro` (lib/vitrine, com teste): dois
  // baldes, ESTÁVEL — dentro de cada bloco a ordem do banco (ágio, depois
  // crédito) é preservada. E a partição acontece ANTES do corte em 4, como
  // antes: cortar primeiro poderia descartar uma exclusiva que tinha vaga.
  const cartas: CartaVitrine[] = brutas.map((c) => {
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
      exclusiva: c.fonte === "cliente_direto",
    };
  });

  return ordenarExclusivaPrimeiro(cartas).slice(0, 4);
}
