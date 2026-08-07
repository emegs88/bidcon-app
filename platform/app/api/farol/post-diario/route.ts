// ============================================================================
// FAROL-POST — GET /api/farol/post-diario · o post diário autônomo
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-POST", 06/08/2026 ~22h15.
// NASCE DESARMADO. Sem FAROL_ATIVO=on, esta rota não publica nada.
// ----------------------------------------------------------------------------
// O QUE ELA FAZ, uma vez por dia: escolhe UMA carta por regra determinística
// (nenhuma IA nesta fatia), monta a legenda por template fixo, publica pela
// MESMA lib que a rota manual usa (lib/instagram/publicar.ts) e grava o que fez
// em `farol_posts`. Stories, reels e relatório estão FORA de escopo aqui.
//
// ---------------------------------------------------------------------------
// GUARD — desvio declarado, mínimo. A OS manda "mesmo padrão do cron do
// Sentinela (header CRON_SECRET — leia como a varredura valida e espelhe)".
// Lido em app/api/sentinela/varredura/route.ts:
//     const secret = process.env.SENTINELA_SECRET || process.env.CRON_SECRET;
//     if (!secret) return false;                       // sem secret => não roda
//     return req.headers.get("authorization") === `Bearer ${secret}`;
// Espelhei a FORMA exata, trocando só o nome do secret específico do módulo:
// `FAROL_SECRET || CRON_SECRET`. Reusar `SENTINELA_SECRET` faria a chave do
// radar de preço abrir também a publicação no perfil público — dois poderes
// bem diferentes atrás da mesma chave. O `CRON_SECRET` no fim da linha é o que
// o cron da Vercel manda sozinho no header, então o agendamento funciona sem
// env extra; `FAROL_SECRET` existe pra quem quiser disparar à mão.
// O "sem secret => não roda" foi mantido letra por letra: numa preview sem env
// configurada a rota fica fechada, e não aberta.
//
// ---------------------------------------------------------------------------
// SELEÇÃO DA CARTA DO DIA (determinística, sem IA — regra da OS):
//   1. fonte = `vw_vitrine_viva`, a MESMA que /api/card-image lê. Se a carta
//      não está nela, a arte devolveria 404 e a Meta recusaria o container.
//   2. exclui cartas publicadas nos últimos 14 dias (memória em farol_posts).
//   3. alterna tipo por dia: ímpar = imóvel, par = veículo. Sem estoque
//      daquele tipo, cai pro outro.
//   4. escolhe o MENOR custo ao mês.
//   5. exclusiva fura fila 1× por semana, na segunda.
//
// "DIA" É EM SÃO PAULO, NÃO EM UTC. O cron roda 14:00 UTC = 11:00 BRT, então
// hoje as duas datas coincidem — mas horário de verão, mudança de cron ou uma
// execução manual à noite fariam `new Date().getDate()` (que é UTC no runtime
// da Vercel) trocar de dia sozinho e inverter imóvel/veículo sem ninguém mexer
// em nada. Fixar o fuso é o que torna a regra "ímpar = imóvel" verdadeira.
//
// CUSTO: `custoEfetivoCarta` via `normalizarCarta` (lib/carrossel-formato.ts) —
// a MESMA função que a página /cartas/<uuid>, destino do clique, usa. A view
// tem uma coluna `custo_am` pronta, e ela é usada aqui APENAS no ORDER BY, pra
// puxar um punhado de candidatos baratos em vez das 2.573 linhas. O vencedor é
// decidido pelo cálculo canônico, sobre os candidatos. Isso é seguro porque a
// divergência medida entre os dois é de no máximo 0,01 p.p. (17 cartas em
// 2.596): nenhuma carta fora do topo-80 por `custo_am` pode ser a mais barata
// de verdade. Se um dia a view divergir mais, o pior caso é escolher a segunda
// carta mais barata — nunca uma carta errada ou indisponível.
//
// ---------------------------------------------------------------------------
// LEGENDA — PENDÊNCIA HONESTA. A OS pede "template fixo no padrão da legenda
// inaugural (mesma estrutura de parágrafos...)". Procurei o texto inaugural no
// repositório e no banco: NÃO EXISTE em lugar nenhum (ele foi escrito por
// Emerson direto no disparo do post 18132427570616550, e a rota manual não
// guarda a legenda). Então o template abaixo foi montado pela DESCRIÇÃO da
// própria OS — estrutura de parágrafos, números da carta, Conta Notarial, CTA
// link na bio + WhatsApp, hashtags — e não por cópia do original. Precisa do
// olho do Emerson antes de armar. Está isolado numa função só (`montarLegenda`)
// exatamente pra ser fácil de reescrever sem tocar em mais nada.
//
// COMPLIANCE (CLAUDE.md): custo SEMPRE como "% a.m."; nunca "investimento",
// "rendimento", "lucro", "CDI"; nenhuma promessa ou data de contemplação; a
// Conta Notarial descrita como ela é, sem "risco zero". O template abaixo
// cumpre isso — e `revisarLegenda()` verifica antes de publicar, para que uma
// edição futura no texto não vire um post irregular no perfil público.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { publicarCartaNoFeed } from "@/lib/instagram/publicar";
import {
  CAMPOS_VITRINE,
  normalizarCarta,
  reais,
  pctAoMes,
  type CartaCarrossel,
  type LinhaVitrine,
} from "@/lib/carrossel-formato";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const TZ = "America/Sao_Paulo";

/** Dias sem repetir a mesma carta. Regra da OS. */
const JANELA_REPETICAO_DIAS = 14;

/** Quantos candidatos mais baratos puxar da view antes do cálculo canônico. */
const LIMITE_CANDIDATOS = 80;

/** Espelha `autorizado()` de app/api/sentinela/varredura/route.ts — ver header. */
function autorizado(req: Request): boolean {
  const secret = process.env.FAROL_SECRET || process.env.CRON_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Dia do mês e "é segunda?" no fuso de São Paulo — ver header. */
function hojeSP(): { data: string; dia: number; segunda: boolean } {
  const agora = new Date();
  // en-CA devolve YYYY-MM-DD, que é ordenável e não ambíguo.
  const data = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  const semana = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(agora);
  return { data, dia: Number(data.slice(8, 10)), segunda: semana === "Mon" };
}

/** Cartas já publicadas na janela — a memória que impede repetir. */
async function publicadasRecentemente(
  db: ReturnType<typeof createXtvClient>
): Promise<Set<string>> {
  const desde = new Date(
    Date.now() - JANELA_REPETICAO_DIAS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await db
    .from("farol_posts")
    .select("carta_id")
    .eq("acao", "post_publicado")
    .gte("criado_em", desde);
  if (error) {
    // Falha de leitura NÃO pode virar "pode repetir tudo": sem a memória, o
    // FAROL poderia postar a mesma carta dois dias seguidos. Propaga.
    throw new Error(`farol_posts_ilegivel: ${error.message}`);
  }
  const ids = new Set<string>();
  for (const l of (data ?? []) as { carta_id: string | null }[]) {
    if (l.carta_id) ids.add(l.carta_id);
  }
  return ids;
}

/**
 * Busca candidatos na view (mais baratos primeiro pelo `custo_am` da view),
 * remove os repetidos, recalcula o custo pelo canônico e devolve ordenado.
 */
async function candidatos(
  db: ReturnType<typeof createXtvClient>,
  filtro: { tipo?: string; exclusiva?: boolean },
  excluidos: Set<string>
): Promise<CartaCarrossel[]> {
  let q = db
    .from("vw_vitrine_viva")
    .select(CAMPOS_VITRINE)
    .order("custo_am", { ascending: true, nullsFirst: false })
    .limit(LIMITE_CANDIDATOS);
  if (filtro.tipo) q = q.eq("tipo", filtro.tipo);
  if (filtro.exclusiva) q = q.eq("exclusiva", true);

  const { data, error } = await q;
  if (error) throw new Error(`vitrine_ilegivel: ${error.message}`);

  return ((data ?? []) as LinhaVitrine[])
    .map(normalizarCarta)
    .filter((c): c is CartaCarrossel => c !== null)
    .filter((c) => !excluidos.has(c.id))
    // custoAm null = a carta não tem parcela/prazo utilizáveis. O card e a
    // legenda mostrariam "—" no lugar do número principal. Fora.
    .filter((c) => c.custoAm != null)
    .sort((a, b) => (a.custoAm as number) - (b.custoAm as number));
}

// ---------------------------------------------------------------------------
// Legenda
// ---------------------------------------------------------------------------

const HASHTAGS: Record<string, string> = {
  imovel:
    "#consorcio #cartacontemplada #consorciodeimovel #casapropria #planejamento #patrimonio #bidcon",
  veiculo:
    "#consorcio #cartacontemplada #consorciodeveiculo #carronovo #planejamento #patrimonio #bidcon",
};

/**
 * Template fixo. Uma carta entra, a legenda sai — sem IA, sem variação.
 * PENDENTE DE REVISÃO DO EMERSON: a legenda inaugural não existe no repositório
 * nem no banco, então isto segue a DESCRIÇÃO da OS, não o original. Ver header.
 */
function montarLegenda(c: CartaCarrossel): string {
  const linhas: string[] = [];

  linhas.push(`Carta de crédito contemplada · ${c.tipoLabel}`);
  if (c.administradora) linhas.push(c.administradora);
  linhas.push("");

  linhas.push(`Crédito: ${reais(c.credito)}`);
  if (c.entrada > 0) linhas.push(`Entrada: ${reais(c.entrada)}`);
  if (c.parcelas > 0 && c.parcela > 0) {
    linhas.push(`Parcelas: ${c.parcelas}x de ${reais(c.parcela)}`);
  }
  linhas.push(`Custo: ${pctAoMes(c.custoAm)}`);
  linhas.push("");

  linhas.push(
    "Poder de compra disponível agora — a carta já está contemplada, então não depende de sorteio nem de lance."
  );
  linhas.push("");

  linhas.push(
    "Pagamento por Conta Notarial: o valor vai para uma conta vinculada no Banco Safra, atrelada exclusivamente ao negócio, com patrimônio segregado. O 5º Tabelionato de Notas de Campinas administra com fé pública e sem acesso ao valor — libera ao vendedor só depois que a administradora aprova a transferência; se não aprovar, o valor volta para o comprador."
  );
  linhas.push("");

  linhas.push(
    "Carta completa no link da bio. Prefere conversar? Chama no WhatsApp."
  );
  linhas.push("");

  linhas.push(HASHTAGS[c.tipo] ?? HASHTAGS.imovel);

  return linhas.join("\n");
}

/**
 * Trava determinística de compliance (NÃO é IA). Só pode disparar se alguém
 * editar o template acima — que é exatamente o ponto: o dia em que a legenda
 * for reescrita às pressas, o post não sai em vez de sair irregular.
 * Lista literal do CLAUDE.md.
 */
const TERMOS_PROIBIDOS = [
  "investimento",
  "investidor",
  "rendimento",
  "lucro",
  "cdi",
  "risco zero",
  "100% seguro",
  "garantido",
];

function revisarLegenda(texto: string): string | null {
  const t = texto.toLowerCase();
  for (const termo of TERMOS_PROIBIDOS) {
    if (t.includes(termo)) return `termo_proibido:${termo}`;
  }
  // Custo tem que aparecer como taxa ao mês, nunca como nominal simples.
  if (t.includes("%") && !t.includes("% a.m.")) return "percentual_sem_ao_mes";
  return null;
}

// ---------------------------------------------------------------------------

/** Grava no diário do FAROL. Nunca derruba a rota: log é log. */
async function registrar(
  db: ReturnType<typeof createXtvClient>,
  acao: string,
  carta_id: string | null,
  post_id: string | null,
  detalhe: Record<string, unknown>
): Promise<void> {
  const { error } = await db
    .from("farol_posts")
    .insert({ acao, carta_id, post_id, detalhe });
  if (error) console.error("[farol] falha gravando farol_posts:", error.message);
}

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // ---- Kill-switch, ANTES de qualquer leitura ou escrita ------------------
  if (process.env.FAROL_ATIVO !== "on") {
    console.log("[farol] represado (desarmado)");
    return NextResponse.json({ ok: true, publicado: false, motivo: "desarmado" });
  }

  const db = createXtvClient();
  const { data: hoje, dia, segunda } = hojeSP();

  try {
    const excluidos = await publicadasRecentemente(db);

    // ---- Escolha da carta -------------------------------------------------
    const tipoDoDia = dia % 2 === 1 ? "imovel" : "veiculo";
    const tipoAlternativo = tipoDoDia === "imovel" ? "veiculo" : "imovel";

    let escolhida: CartaCarrossel | null = null;
    let motivoEscolha = "";

    // Segunda: exclusiva fura fila (qualquer tipo). Se não houver exclusiva
    // elegível, o dia segue a regra normal — sem post especial, sem erro.
    if (segunda) {
      const exclusivas = await candidatos(db, { exclusiva: true }, excluidos);
      if (exclusivas.length > 0) {
        escolhida = exclusivas[0];
        motivoEscolha = "exclusiva_segunda";
      }
    }

    if (!escolhida) {
      const doTipo = await candidatos(db, { tipo: tipoDoDia }, excluidos);
      if (doTipo.length > 0) {
        escolhida = doTipo[0];
        motivoEscolha = `tipo_do_dia:${tipoDoDia}`;
      } else {
        const doOutro = await candidatos(db, { tipo: tipoAlternativo }, excluidos);
        if (doOutro.length > 0) {
          escolhida = doOutro[0];
          motivoEscolha = `tipo_alternativo:${tipoAlternativo}`;
        }
      }
    }

    if (!escolhida) {
      console.log("[farol] sem carta elegível hoje:", { data: hoje, tipoDoDia });
      await registrar(db, "sem_carta", null, null, { data: hoje, tipo_do_dia: tipoDoDia });
      return NextResponse.json({ ok: true, publicado: false, motivo: "sem_carta" });
    }

    // ---- Legenda ----------------------------------------------------------
    const legenda = montarLegenda(escolhida);
    const reprovada = revisarLegenda(legenda);
    if (reprovada) {
      console.error("[farol] legenda reprovada no compliance:", reprovada);
      await registrar(db, "post_falhou", escolhida.id, null, {
        data: hoje,
        erro: `legenda_reprovada:${reprovada}`,
      });
      return NextResponse.json(
        { ok: false, erro: `legenda_reprovada:${reprovada}` },
        { status: 500 }
      );
    }

    // ---- Publicação (mesma lib da rota manual) ----------------------------
    const r = await publicarCartaNoFeed({ cartaId: escolhida.id, legenda });

    if (!r.ok) {
      // Sem loop de retry: o cron de amanhã tenta de novo naturalmente, e a
      // carta continua elegível porque nada foi gravado como publicado.
      console.error("[farol] publicação falhou:", {
        data: hoje,
        carta_id: escolhida.id,
        motivo: r.motivo,
        erro: r.erro,
      });
      await registrar(db, "post_falhou", escolhida.id, null, {
        data: hoje,
        motivo: r.motivo,
        erro: r.erro,
      });
      return NextResponse.json({ ok: false, erro: r.erro, motivo: r.motivo });
    }

    console.log("[farol] post do dia publicado:", {
      data: hoje,
      post_id: r.postId,
      carta_id: escolhida.id,
      tipo: escolhida.tipo,
      custo_am: escolhida.custoAm,
      escolha: motivoEscolha,
    });
    await registrar(db, "post_publicado", escolhida.id, r.postId, {
      data: hoje,
      tipo: escolhida.tipo,
      administradora: escolhida.administradora,
      credito: escolhida.credito,
      custo_am: escolhida.custoAm,
      escolha: motivoEscolha,
    });

    return NextResponse.json({
      ok: true,
      publicado: true,
      post_id: r.postId,
      carta_id: escolhida.id,
      escolha: motivoEscolha,
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol] erro no post diário:", erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
