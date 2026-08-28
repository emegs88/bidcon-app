// Home da área logada. Server Component: lê a sessão (RLS), saúda o usuário e
// mostra o "próximo passo" do processo mais recente (se houver). Atalhos variam
// pelo papel: cliente vê o básico; parceiro/admin ganham acesso às suas áreas.
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CartasNovasFeed } from "@/components/CartasNovasFeed";
import { LABEL_STATUS, TONE_STATUS_PROCESSO, type StatusProcesso } from "@/lib/status";
import { cartasNovas, type CartaFluxo } from "@/lib/cartas-fluxo";
import { lerLinhasVitrine } from "@/lib/vitrine-fonte";
import { paraFluxo } from "@/lib/vitrine";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

// Mensagem curta de "próximo passo" por status — tom neutro, sem prometer prazo.
const PROXIMO_PASSO: Record<StatusProcesso, string> = {
  reservada: "Carta reservada. O atendimento dará os próximos passos da documentação.",
  documentacao: "Reúna e envie a documentação solicitada para seguir a análise.",
  analise_administradora: "Em análise pela administradora do consórcio. Acompanhe por aqui.",
  transferencia: "Transferência de titularidade em andamento na administradora.",
  concluido: "Processo concluído. Qualquer dúvida, fale com o atendimento.",
  cancelado: "Processo encerrado. Veja outras cartas disponíveis ou fale com o atendimento.",
};

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // perfil é protegido por RLS: só retorna a própria linha
  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, tipo")
    .eq("id", user.id)
    .single();

  const tipo = profile?.tipo as "cliente" | "parceiro" | "admin" | undefined;

  // processo mais recente do usuário (RLS: cliente vê só os próprios) e
  // vínculo de cedente (CEDENTE-01, RLS: só o próprio profile_id) em paralelo.
  const [{ data: processo }, { data: vinculoCedente }] = await Promise.all([
    supabase
      .from("processos")
      .select("status")
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("cedente_cartas").select("id").eq("profile_id", user.id).limit(1).maybeSingle(),
  ]);
  const status = processo?.status as StatusProcesso | undefined;
  const ehCedente = !!vinculoCedente;

  // Cedente sem processo: /minha-carta é o destino natural pós-login (ela não
  // tem nada pra ver em "Meu processo"). Com os dois, mostra os dois atalhos
  // na home em vez de redirecionar — ela escolhe.
  if (ehCedente && !status) {
    redirect("/minha-carta");
  }

  // Feed NEUTRO de cartas novas (client-safe): só cartas disponíveis, recorte
  // factual por janela de dias. Sem ranking/score/custo — compliance (ver
  // lib/cartas-fluxo.cartasNovas).
  //
  // CATALOGO-UNIFICA-01 · FASE 2: a fonte deixou de ser `nnv.cartas` (medido em
  // 19/08: 2 linhas, 0 disponíveis — este feed NUNCA teve o que mostrar) e passou
  // a ser `xtv.vw_vitrine_viva`, a mesma do site público. O `limit` continua
  // pequeno de propósito: a janela é de 7 dias e o corte é de 6 itens, então
  // pedir o catálogo inteiro para jogar fora 99% dele seria desperdício.
  //
  // REGRA 19: `lerLinhasVitrine` separa falha de zero. O `?? []` de antes
  // transformava fonte caída em "nenhuma carta nova" — e como o feed some
  // quando é zero, a falha era literalmente invisível. `falhou` conserta isso.
  const leituraFeed = await lerLinhasVitrine({ limite: 60, ordem: "novidade" });
  const listaCartas: (CartaFluxo & { tipo?: string })[] = leituraFeed.ok
    ? leituraFeed.dados.map((l) => ({ ...paraFluxo(l), tipo: l.tipo }))
    : [];
  const novas = cartasNovas(listaCartas, { dias: 7, limite: 6 });

  const nome = profile?.nome ?? user.email ?? "visitante";
  const primeiroNome = nome.split(" ")[0];

  return (
    <AppShell nome={nome} tipo={tipo}>
      <h1 className={styles.hi}>Olá, {primeiroNome} 👋</h1>
      <p className={styles.sub}>
        Bem-vindo à sua área Bidcon. Acompanhe seu processo e veja as cartas
        contempladas disponíveis.
      </p>

      {status && (
        <div className={styles.destaque}>
          <Card href="/meu-processo">
            <span className={styles.cardKicker}>
              Seu processo
              <Badge tone={TONE_STATUS_PROCESSO[status]}>{LABEL_STATUS[status]}</Badge>
            </span>
            <span className={styles.cardDesc}>{PROXIMO_PASSO[status]}</span>
          </Card>
        </div>
      )}

      <CartasNovasFeed novas={novas} falhou={!leituraFeed.ok} />

      <div className={styles.grid}>
        <Card href="/meu-processo">
          <span className={styles.cardTitle}>Meu processo</span>
          <span className={styles.cardDesc}>
            Acompanhe cada etapa da sua carta contemplada.
          </span>
        </Card>
        <Card href="/cartas">
          <span className={styles.cardTitle}>Cartas disponíveis</span>
          <span className={styles.cardDesc}>
            Explore cotas de consórcio já contempladas, de imóvel e veículo.
          </span>
        </Card>

        {ehCedente && (
          <Card href="/minha-carta">
            <span className={styles.cardTitle}>Minha carta</span>
            <span className={styles.cardDesc}>
              Acompanhe o anúncio da sua carta e envie atualizações de condições.
            </span>
          </Card>
        )}

        {(tipo === "parceiro" || tipo === "admin") && (
          <Card href="/parceiro">
            <span className={styles.cardTitle}>Painel do parceiro</span>
            <span className={styles.cardDesc}>
              Sua carteira, indicações e comissões em um só lugar.
            </span>
          </Card>
        )}
        {tipo === "admin" && (
          <Card href="/admin">
            <span className={styles.cardTitle}>Administração</span>
            <span className={styles.cardDesc}>
              Parceiros, processos, estoque de cartas e comissões.
            </span>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
