// ============================================================================
// FAROL-REEL-01 · rota 2 — GET /api/farol/reel-render · FASE 1 (dispara)
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-REEL-01", 06/08/2026:
// "cron 14:30 UTC no vercel.json, guard FAROL_SECRET||CRON_SECRET igual ao
//  post-diario; escolhe a carta do dia pela MESMA lib de seleção do FAROL-POST,
//  roteiro determinístico, dispara o render no HeyGen, grava video_id +
//  carta_id. SEM polling longo."
// NASCE DESARMADA: sem FAROL_REEL=on, esta rota não fala com o HeyGen.
// ----------------------------------------------------------------------------
// POR QUE DUAS FASES, e não uma só que espera. Um render de ~35s no HeyGen leva
// minutos. Segurar a invocação esperando é a forma mais cara e mais frágil de
// errar: a função da Vercel tem teto de tempo, e um timeout no meio deixaria o
// vídeo renderizado no HeyGen sem NINGUÉM sabendo o video_id — pago e perdido.
// Aqui a fase 1 dispara e ESCREVE o video_id no banco antes de responder. A
// partir daí o render é um fato registrado: mesmo que tudo mais falhe, a fase 2
// de 30 minutos depois (ou a do dia seguinte) o encontra.
//
// A ESCRITA VEM ANTES DA RESPOSTA, E É ELA QUE IMPORTA. Se o insert em
// `farol_reels` falhar, esta rota devolve ERRO mesmo com o render já disparado —
// e diz o video_id no corpo e no log. Não finjo sucesso: um render órfão é
// dinheiro gasto que precisa aparecer em algum lugar, nem que seja no log.
//
// ---------------------------------------------------------------------------
// A ORDEM DAS TRAVAS É DE PROPÓSITO, DA MAIS BARATA PRA MAIS CARA:
//   1. guard          (header)      — 401, nada acontece
//   2. FAROL_REEL     (env)         — "represado", nada acontece
//   3. envs do HeyGen (env)         — falta id/voz => sai ANTES de ler o banco
//   4. já rendeu hoje? (banco)      — teto diário, ANTES de gastar crédito
//   5. carta do dia   (banco)
//   6. compliance     (código)      — texto reprovado NÃO vira render
//   7. elenco         (código)      — quem fala; não custa e não pode falhar
//   8. render         (HeyGen, $$)  — a única linha que custa
// Nenhuma dessas travas é cara depois da que vem antes dela.
//
// ---------------------------------------------------------------------------
// A SEGUNDA PERSONA (FAROL-DUPLA-01, decisão 6 da coordenação de 08/08)
// ---------------------------------------------------------------------------
// AUTORIZADO: Emerson Gomes dos Santos — "persona por fôrma, kill-switch
// FAROL_DUPLA desarmado, persona gravada no detalhe, envs HEYGEN_AVATAR_ID_2 /
// HEYGEN_VOICE_ID_2".
//
// A persona é campo da FÔRMA (ver "A PERSONA" em lib/farol/formulas.ts), não
// desta rota. Aqui só se traduz fôrma -> par avatar/voz, em `escalar()`. Por
// isso o passo 7 é de graça: é leitura de um campo e de duas envs.
//
// O DIFF FUNCIONAL É ZERO ATÉ ALGUÉM ARMAR `FAROL_DUPLA`. Desarmada, `escalar()`
// devolve os mesmos `avatarId`/`voiceId`/`tipo` que a trava 3 leu, e o único
// resto desta fatia é uma chave a mais no jsonb `detalhe` (`persona:
// "porta_voz"`) — que é a descrição verdadeira do que já acontece hoje.
//
// E ELA DEPENDE DE OUTRA ENV: sem `FAROL_FORMULAS=on` não há fôrma, e sem fôrma
// não há persona. Ou seja, armar `FAROL_DUPLA` sozinha não muda nada. Isso é
// consequência, não descuido: o roteiro clássico se apresenta na primeira frase
// como "o porta-voz da Bidcon", então ele tem que sair na voz do Porta-voz.
//
// TETO DIÁRIO: uma carta por dia, uma linha por dia. `FAROL_REEL_QTD` existe no
// blueprint FAROL-CRIATIVO para subir isso com rampa medida (1/dia na semana 1,
// 2/dia na semana 2, 4/dia depois); aqui ele é LIDO e o padrão é 1. Sem esse
// teto, um cron que retenta sozinho vira uma fatura de HeyGen. A contagem é
// feita no banco, sobre `criado_em >= hoje 00:00 em São Paulo` — não em memória.
//
// COMPLIANCE ANTES DO RENDER, e não antes do publish: um roteiro irregular já
// renderizado é dinheiro gasto num vídeo que não pode sair. `revisarLegenda()`
// (a MESMA trava determinística do post de feed) mede o roteiro E a legenda
// aqui, e a fase 2 mede a legenda de novo antes de mandar pra Meta.
//
// O TEXTO PODE VIR DE FORA (FAROL-ESCUTA-01, 08/08/2026). Desde essa fatia,
// esta rota primeiro procura a pauta 'nova' do dia em `farol_pauta` — escrita
// às 10h por um modelo com pesquisa de tendências — e só cai nos
// `montarRoteiro()`/`montarLegendaReel()` determinísticos se não achar, se a
// carta divergir, ou se o linter reprovar. NADA no caminho do template mudou:
// sem pauta, este arquivo se comporta exatamente como antes. A pauta é
// acessório, não requisito — ver o bloco "Texto" mais abaixo.
//
// A LEGENDA É MONTADA E GUARDADA AGORA, não na fase 2. Meia hora depois a carta
// pode ter sido vendida e sumido da `vw_vitrine_viva` — e aí a fase 2 teria um
// vídeo pronto e nenhum número pra escrever embaixo. Guardando, o reel publica
// com os números que ele mesmo narra. (Se a carta sumir, o vídeo já gravado
// continua verdadeiro sobre o que era a oferta; o link da bio leva pra vitrine
// atual, não pra uma carta morta.)
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  autorizadoFarol,
  hojeSP,
  publicadasRecentemente,
  escolherCartaDoDia,
  revisarLegenda,
  registrar,
} from "@/lib/farol/selecao";
import {
  montarRoteiro,
  montarLegendaReel,
  formulaDoTemplate,
} from "@/lib/farol/reel-texto";
import { formulaPorId, type Formula, type Persona } from "@/lib/farol/formulas";
import { statusConsumivelDaPauta } from "@/lib/farol/painel";
import { dispararRender, tituloRender } from "@/lib/heygen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Quantos reels por dia. Rampa do blueprint FAROL-CRIATIVO; padrão 1. */
function tetoDiario(): number {
  const bruto = Number(process.env.FAROL_REEL_QTD ?? "1");
  if (!Number.isFinite(bruto) || bruto < 1) return 1;
  return Math.min(Math.floor(bruto), 4); // 4 é o teto do blueprint
}

/** Quem fala, e com que avatar/voz. Ver o bloco DUPLA-01 no header. */
type Elenco = {
  persona: Persona;
  avatarId: string;
  voiceId: string;
  tipo: string;
  /** A fôrma pedia Valentina, faltou env da 2ª persona e caiu no Porta-voz. */
  fallback: boolean;
};

/**
 * Escala a persona do render.
 *
 * TRÊS PORTAS FECHADAS, NESTA ORDEM — e qualquer uma delas devolve o Porta-voz
 * de sempre, com os MESMOS ids que esta rota já usava:
 *   1. `FAROL_DUPLA` desarmada  — a fatia inteira não existe;
 *   2. fôrma nula ou de Porta-voz — inclui TODO o caminho do roteiro clássico,
 *      que se apresenta como "o porta-voz da Bidcon" na primeira frase e
 *      portanto nunca pode sair na voz da Valentina;
 *   3. envs da 2ª persona ausentes.
 *
 * O CASO 3 É FALLBACK, NÃO ERRO — e isso é uma escolha, declarada. Faltar
 * `HEYGEN_AVATAR_ID_2` com a dupla armada poderia derrubar o reel do dia (é o
 * que a trava 3 faz com as envs do Porta-voz). Preferi o reel na voz certa da
 * casa a nenhum reel: o vídeo do dia vale mais que a persona dele. Para o erro
 * não virar silêncio, ele sai em `console.error` E fica gravado no `detalhe` da
 * linha como `persona_fallback` — ou seja, é auditável no banco, não só no log.
 */
function escalar(
  f: Formula | null,
  base: { avatarId: string; voiceId: string; tipo: string }
): Elenco {
  const portaVoz: Elenco = { persona: "porta_voz", ...base, fallback: false };

  if (process.env.FAROL_DUPLA !== "on") return portaVoz;
  if (f?.persona !== "valentina") return portaVoz;

  const avatarId = process.env.HEYGEN_AVATAR_ID_2;
  const voiceId = process.env.HEYGEN_VOICE_ID_2;
  if (!avatarId || !voiceId) {
    const faltando = [!avatarId && "HEYGEN_AVATAR_ID_2", !voiceId && "HEYGEN_VOICE_ID_2"]
      .filter(Boolean)
      .join(",");
    // Tag `persona_indisponivel` NOMEADA pelo Emerson em 09/08. É a mesma dos
    // dois casos de fallback (env ausente aqui, id recusado no render) de
    // propósito: quem for procurar "a persona caiu" faz UM grep, não dois.
    console.error("[farol-reel] persona_indisponivel:", {
      motivo: "env_2_ausente",
      formula: f.id,
      faltando,
      caiu_em: "porta_voz",
    });
    return { ...portaVoz, fallback: true };
  }

  // `HEYGEN_AVATAR_TIPO_2` NÃO herda o tipo do Porta-voz de propósito: o
  // primário pode estar em `talking_photo` (caminho v2 legado) e isso não diz
  // nada sobre a Valentina, que é photo avatar e vai pela v3. Padrão "avatar".
  return {
    persona: "valentina",
    avatarId,
    voiceId,
    tipo: process.env.HEYGEN_AVATAR_TIPO_2 ?? "avatar",
    fallback: false,
  };
}

/**
 * O erro do render foi RECUSA de pedido (4xx) ou incerteza (timeout/5xx)?
 *
 * Só a recusa autoriza repetir o render com outra persona. `lib/heygen.ts`
 * formata todo erro HTTP como `http_<status>[ code=...] <mensagem>`, e as outras
 * saídas têm nome próprio (`timeout_heygen(...)`, `resposta_sem_video_id`,
 * `env_ausente(...)`) — nenhuma delas casa com este padrão, que é o ponto: o
 * default desta função é NÃO repetir. Ver o bloco do fallback no corpo do GET.
 */
function recusaDeCadastro(erro: string): boolean {
  return /^http_4\d\d(\s|$)/.test(erro);
}

/** Início do dia de hoje em São Paulo, em ISO — a régua da contagem diária. */
function inicioDoDiaSP(dataSP: string): string {
  // -03:00 é o offset fixo do Brasil desde o fim do horário de verão (2019).
  // Escrito literal de propósito: `new Date("2026-08-06T00:00:00-03:00")` é
  // determinístico, enquanto reconstruir por Intl daria margem a erro de 1h.
  return new Date(`${dataSP}T00:00:00-03:00`).toISOString();
}

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // ---- Kill-switch, ANTES de qualquer leitura ou escrita ------------------
  if (process.env.FAROL_REEL !== "on") {
    console.log("[farol-reel] represado (desarmado)");
    return NextResponse.json({ ok: true, renderizou: false, motivo: "desarmado" });
  }

  // ---- Envs do HeyGen: falta id ou voz => nem chega no banco --------------
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;
  const tipoAvatar = process.env.HEYGEN_AVATAR_TIPO ?? "avatar";
  if (!avatarId || !voiceId) {
    const faltando = [!avatarId && "HEYGEN_AVATAR_ID", !voiceId && "HEYGEN_VOICE_ID"]
      .filter(Boolean)
      .join(",");
    console.error("[farol-reel] env ausente:", faltando);
    return NextResponse.json(
      { ok: false, erro: `env_ausente(${faltando})`, dica: "GET /api/farol/reel-opcoes" },
      { status: 500 }
    );
  }

  const db = createXtvClient();
  const { data: hoje, dia, segunda } = hojeSP();

  try {
    // ---- Teto diário, ANTES de gastar crédito -----------------------------
    const { count, error: errConta } = await db
      .from("farol_reels")
      .select("id", { count: "exact", head: true })
      .gte("criado_em", inicioDoDiaSP(hoje));
    if (errConta) throw new Error(`farol_reels_ilegivel: ${errConta.message}`);

    const teto = tetoDiario();
    if ((count ?? 0) >= teto) {
      console.log("[farol-reel] teto diário atingido:", { data: hoje, count, teto });
      return NextResponse.json({
        ok: true,
        renderizou: false,
        motivo: "teto_diario",
        hoje: count,
        teto,
      });
    }

    // ---- Carta do dia (MESMA lib do FAROL-POST) ---------------------------
    // A memória inclui `reel_publicado`: um reel não repete carta que já virou
    // reel. Inclui também `post_publicado` porque a carta do post de feed das
    // 14h já foi mostrada hoje — o reel das 14h30 mostra a PRÓXIMA da fila da
    // regra da casa, e o perfil ganha duas cartas por dia em vez da mesma duas
    // vezes. ("Próxima mais barata" até 09/08/2026; hoje a fila é ordenada por
    // alavancagem dentro do teto de custo — ver lib/farol/selecao.ts.)
    const memoria = await publicadasRecentemente(db, [
      "post_publicado",
      "reel_publicado",
    ]);
    const { carta, motivo: motivoEscolha, tipoDoDia } = await escolherCartaDoDia(db, {
      dia,
      segunda,
      memoria,
    });

    if (!carta) {
      console.log("[farol-reel] sem carta elegível hoje:", { data: hoje, tipoDoDia });
      await registrar(db, "reel_sem_carta", null, null, {
        data: hoje,
        tipo_do_dia: tipoDoDia,
      });
      return NextResponse.json({ ok: true, renderizou: false, motivo: "sem_carta" });
    }

    // ---- Texto: pauta do dia (FAROL-ESCUTA-01) ou template ----------------
    // A pauta é OPCIONAL POR CONSTRUÇÃO. Não achou linha 'nova' do dia — porque
    // FAROL_PAUTA está desarmado, porque o cron das 10h falhou, porque o linter
    // reprovou o texto do modelo, ou porque a carta divergiu — e este bloco
    // inteiro não faz nada: os dois `montar*()` de sempre escrevem o texto e o
    // caminho antigo é bit a bit o de hoje.
    //
    // `carta_id` NO FILTRO É A TRAVA QUE IMPORTA. A pauta das 10h narra os
    // números de uma carta específica. Entre lá e aqui o post-diario (11h)
    // queima uma carta e a vitrine pode ter mudado, então a carta escolhida
    // agora pode não ser a mesma. Usar a pauta nesse caso seria narrar crédito
    // e parcela de uma carta que não é a anunciada. Divergiu, cai no template —
    // e a pauta fica no estado em que estava, visível no banco como pauta
    // escrita e não usada. (Dizia "fica 'nova'"; com o PAINEL-FAROL-01 o estado
    // consumível passou a ser configurável, então o nome literal do estado
    // depende de `FAROL_PAUTA_APROVA`. O fato — pauta intacta e não consumida —
    // é o mesmo nos dois casos.)
    let roteiro = "";
    let legenda = "";
    let pautaUsada: { id: string; formula: string } | null = null;
    // Qual fôrma gerou este texto — vindo da pauta ou do template. É só ela que
    // sabe QUEM fala (FAROL-DUPLA-01). Fica `null` no roteiro clássico.
    let formulaUsada: Formula | null = null;

    // O ESTADO CONSUMÍVEL É CONFIGURÁVEL, e o default é o de sempre.
    // `statusConsumivelDaPauta()` devolve 'nova' — literalmente o filtro que
    // estava escrito aqui — enquanto `FAROL_PAUTA_APROVA` estiver desarmada.
    // Com ela on, passa a exigir 'aprovada', e uma pauta que ninguém aprovou
    // simplesmente não é encontrada: cai no template, que é o MESMO caminho de
    // degradação que este bloco já tinha para pauta ausente. Nenhum estado novo
    // de erro foi inventado — a ausência já era um caso previsto.
    const { data: pautas, error: errPauta } = await db
      .from("farol_pauta")
      .select("id,formula,roteiro,legenda,hashtags")
      .eq("dia", hoje)
      .eq("status", statusConsumivelDaPauta())
      .eq("carta_id", carta.id)
      .limit(1);

    if (errPauta) {
      // Pauta ilegível NÃO derruba o reel: ela é acessório, não requisito.
      // Loga e segue no template — o comportamento de antes desta fatia.
      console.error(
        "[farol-reel] farol_pauta ilegível (segue no template):",
        errPauta.message
      );
    }

    const pauta = pautas?.[0];
    if (pauta?.roteiro && pauta?.legenda) {
      const tags: string[] = Array.isArray(pauta.hashtags) ? pauta.hashtags : [];
      const legendaPauta =
        tags.length > 0 ? `${pauta.legenda}\n\n${tags.join(" ")}` : pauta.legenda;

      // Segunda medição, sobre o texto FINAL. A pauta já passou pelo linter às
      // 10h, mas o que sai daqui não é exatamente o que entrou lá (as hashtags
      // vêm coladas na legenda). Medir de novo é barato e determinístico.
      const ruim = revisarLegenda(pauta.roteiro) ?? revisarLegenda(legendaPauta);
      if (ruim) {
        // O show não para: marca a pauta e cai no template. Não devolvo erro,
        // porque um texto ruim do modelo não pode custar o reel do dia.
        console.error("[farol-reel] pauta reprovada na 2ª medição:", ruim);
        const { error: errRep } = await db
          .from("farol_pauta")
          .update({ status: "reprovada", motivo_linter: ruim })
          .eq("id", pauta.id);
        if (errRep) {
          console.error("[farol-reel] falha marcando pauta reprovada:", errRep.message);
        }
      } else {
        roteiro = pauta.roteiro;
        legenda = legendaPauta;
        pautaUsada = { id: pauta.id, formula: pauta.formula };
        // `formula` é texto livre no banco: uma pauta antiga, ou de uma fôrma
        // renomeada, devolve null aqui — e null vira Porta-voz, que é o certo.
        formulaUsada = formulaPorId(pauta.formula);
      }
    }

    if (!pautaUsada) {
      // `hoje` entrou na assinatura em 08/08 (FAROL-FORMULAS-02): é ele que
      // escolhe a fôrma do dia quando FAROL_FORMULAS=on. Com a env desarmada o
      // argumento é ignorado e estas duas linhas devolvem o texto de sempre.
      roteiro = montarRoteiro(carta, hoje);
      legenda = montarLegendaReel(carta, hoje);
      // MESMA função que `montarRoteiro` consulta por dentro, e não uma segunda
      // cópia da regra: com `FAROL_FORMULAS` desarmada devolve null, o roteiro
      // é o clássico e a persona é o Porta-voz — as três coisas de acordo.
      formulaUsada = formulaDoTemplate(carta, hoje);
    }

    // ---- Compliance ANTES do render (linha INALTERADA) --------------------
    // Roda sobre o texto que venceu, seja qual for. No caminho do template é
    // literalmente a mesma medição de sempre, sobre os mesmos dois textos.
    const reprovado = revisarLegenda(roteiro) ?? revisarLegenda(legenda);
    if (reprovado) {
      console.error("[farol-reel] texto reprovado no compliance:", reprovado);
      await registrar(db, "reel_falhou", carta.id, null, {
        data: hoje,
        erro: `texto_reprovado:${reprovado}`,
      });
      return NextResponse.json(
        { ok: false, erro: `texto_reprovado:${reprovado}` },
        { status: 500 }
      );
    }

    // ---- Elenco: quem fala (FAROL-DUPLA-01) -------------------------------
    // DEPOIS do compliance e ANTES do render: trocar de avatar não muda o
    // texto, então medir o texto primeiro continua sendo o mais barato. Com
    // `FAROL_DUPLA` desarmada, `escalar()` devolve exatamente os três valores
    // que a trava 3 já tinha lido — o diff funcional é zero.
    const elenco = escalar(formulaUsada, {
      avatarId,
      voiceId,
      tipo: tipoAvatar,
    });

    // ---- Render (a única linha que custa) ---------------------------------
    let r = await dispararRender({
      roteiro,
      avatarId: elenco.avatarId,
      voiceId: elenco.voiceId,
      tipo: elenco.tipo,
      // Mesma função que a fase 2 usa para procurar. Era template literal aqui;
      // virou chave de resgate lá — duas cópias seriam duas verdades.
      titulo: tituloRender(hoje, carta.tipo),
    });

    // -----------------------------------------------------------------------
    // A SEGUNDA PORTA DO FALLBACK DE PERSONA (09/08/2026)
    // -----------------------------------------------------------------------
    // AUTORIZADO: Emerson — "se HEYGEN_AVATAR_ID_2/VOICE_ID_2 falharem, a rota
    // cai no Porta-voz ou marca reel_falhou? Se marcar falhou, implemente
    // FALLBACK (...) — não vale perder o vídeo do dia por uma persona."
    //
    // "FALHAR" tem DOIS casos, e só um estava coberto. `escalar()` já cobria o
    // env AUSENTE. Faltava o env PRESENTE E ERRADO — id copiado com espaço,
    // avatar apagado no painel do HeyGen, voz despublicada. Nesse caso as envs
    // existem, `escalar()` devolve Valentina satisfeita, e a recusa só aparece
    // aqui, onde a rota gravava `reel_falhou` e perdia o vídeo do dia. Era
    // exatamente o que o Emerson não queria, e estava acontecendo.
    //
    // O RETRY É CONDICIONAL, E A CONDIÇÃO É DINHEIRO. Só repete em 4xx — a
    // HeyGen RECUSOU o pedido, nada foi enfileirado, nada será cobrado.
    // `timeout_heygen`, 5xx e `resposta_sem_video_id` NÃO repetem: nos três o
    // render pode ter COMEÇADO do outro lado, e repetir cegamente pagaria dois
    // vídeos para publicar um. Perder o vídeo do dia é ruim; pagar dobrado sem
    // saber é pior, porque não aparece em lugar nenhum.
    //
    // Só o roteiro sobrevive à troca — e ele já passou pelo compliance acima,
    // que não depende de quem fala. Nada é re-medido porque nada mudou no texto.
    let personaFinal: Persona = elenco.persona;
    let motivoFallback: string | null = elenco.fallback ? "env_2_ausente" : null;

    if (!r.ok && elenco.persona === "valentina" && recusaDeCadastro(r.erro)) {
      console.error("[farol-reel] persona_indisponivel:", {
        data: hoje,
        carta_id: carta.id,
        formula: formulaUsada?.id ?? null,
        erro: r.erro,
        caiu_em: "porta_voz",
      });
      r = await dispararRender({
        roteiro,
        avatarId,
        voiceId,
        tipo: tipoAvatar,
        titulo: tituloRender(hoje, carta.tipo),
      });
      personaFinal = "porta_voz";
      motivoFallback = "render_recusado";
    }

    if (!r.ok) {
      console.error("[farol-reel] render recusado:", {
        data: hoje,
        carta_id: carta.id,
        erro: r.erro,
      });
      await registrar(db, "reel_falhou", carta.id, null, { data: hoje, erro: r.erro });
      return NextResponse.json({ ok: false, erro: r.erro }, { status: 502 });
    }

    // ---- Registro do render (ver header: falha AQUI é erro, não sucesso) ---
    const { error: errIns } = await db.from("farol_reels").insert({
      carta_id: carta.id,
      video_id: r.data.videoId,
      status: "renderizando",
      roteiro,
      legenda,
      detalhe: {
        data: hoje,
        tipo: carta.tipo,
        administradora: carta.administradora,
        credito: carta.credito,
        custo_am: carta.custoAm,
        escolha: motivoEscolha,
        avatar_tipo: elenco.tipo,
        // QUEM FALOU, gravado na linha (ordem do Emerson na decisão 6). Sem a
        // dupla armada isto é sempre "porta_voz", que é a verdade de hoje —
        // então a coluna já nasce preenchida e comparável quando a dupla ligar.
        // `personaFinal`, e NÃO `elenco.persona`: depois do fallback de render
        // os dois divergem, e gravar a intenção no lugar do fato faria o
        // FAROL-METRICAS-01 creditar à Valentina um vídeo que o Porta-voz
        // gravou. Métrica de persona construída sobre isso mediria fantasma.
        persona: personaFinal,
        ...(motivoFallback ? { persona_fallback: motivoFallback } : {}),
        // Aditivo e opcional: `detalhe` é jsonb, então dizer QUAL fôrma gerou
        // este reel não custa migração. É o dado que o FAROL-METRICAS-01 vai
        // precisar para saber quais fôrmas retêm e quais devem morrer.
        ...(pautaUsada
          ? { pauta_id: pautaUsada.id, formula: pautaUsada.formula }
          : {
              fonte_texto: "template",
              // Aditivo e só existe com FAROL_FORMULAS=on: até aqui o caminho
              // do template não dizia QUAL fôrma tinha usado, e sem isso a
              // persona gravada acima ficaria sem par para conferência.
              ...(formulaUsada ? { formula: formulaUsada.id } : {}),
            }),
      },
    });

    if (errIns) {
      // Render disparado e não registrado. O video_id vai no log E na resposta
      // porque é a única forma de alguém recuperar esse vídeo à mão.
      console.error("[farol-reel] RENDER ÓRFÃO — insert falhou:", {
        video_id: r.data.videoId,
        carta_id: carta.id,
        erro: errIns.message,
      });
      return NextResponse.json(
        {
          ok: false,
          erro: `render_orfao: ${errIns.message}`,
          video_id: r.data.videoId,
          carta_id: carta.id,
        },
        { status: 500 }
      );
    }

    // ---- Pauta consumida --------------------------------------------------
    // DEPOIS do insert, de propósito. Marcar antes significaria queimar a pauta
    // num render que ainda pode falhar — e um disparo manual de resgate cairia
    // no template sem motivo. Se este update falhar, a pauta fica 'nova' tendo
    // sido usada; é um erro de contabilidade auditável (o roteiro está gravado
    // em `farol_reels`), não um erro de produção.
    if (pautaUsada) {
      const { error: errUso } = await db
        .from("farol_pauta")
        .update({ status: "usada" })
        .eq("id", pautaUsada.id);
      if (errUso) {
        console.error("[farol-reel] pauta usada mas NÃO marcada:", {
          pauta_id: pautaUsada.id,
          erro: errUso.message,
        });
      }
    }

    console.log("[farol-reel] render disparado:", {
      data: hoje,
      video_id: r.data.videoId,
      carta_id: carta.id,
      tipo: carta.tipo,
      custo_am: carta.custoAm,
      escolha: motivoEscolha,
      texto: pautaUsada ? `pauta:${pautaUsada.formula}` : "template",
      persona: personaFinal,
    });

    return NextResponse.json({
      ok: true,
      renderizou: true,
      video_id: r.data.videoId,
      carta_id: carta.id,
      escolha: motivoEscolha,
      texto: pautaUsada ? "pauta" : "template",
      formula: pautaUsada?.formula ?? formulaUsada?.id ?? null,
      persona: personaFinal,
      // Sai na RESPOSTA, e não só no log: é assim que o Emerson vê que a
      // persona caiu sem precisar abrir o painel de logs da Vercel.
      persona_fallback: motivoFallback,
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-reel] erro na fase 1:", erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
