// ============================================================================
// CARROSSEL-OPS-01 Peça 2 — GET /api/card-image/[id]
// Arte de UMA carta, gerada ao vivo a partir do estoque, em três formatos.
// ----------------------------------------------------------------------------
// 06/08/2026 ~23h30 — VISUAL-KIT-APLICADO-01. Esta rota passou a atender três
// destinos com o MESMO dado e a MESMA formatação:
//
//   (sem parâmetro) → 1200×630 (1.91:1) — WhatsApp. INTOCADO, byte a byte.
//   ?formato=feed   → 1080×1080         — grid do Instagram.
//   ?formato=story  → 1080×1920 (9:16)  — stories.
//
// POR QUE O DEFAULT NÃO PODE MUDAR NEM UM PIXEL: ele é o card do carrossel do
// WhatsApp, que já está em produção e vive para sempre no celular do cliente. A
// OS exige "byte a byte intacto" e o caminho `padrao` abaixo é literalmente o
// código anterior, com a MESMA árvore JSX, as MESMAS options `{width, height}`
// e SEM fontes (fonte muda pixel). Verificado por sha256 do PNG antes e depois:
// mesma carta, mesmo hash. O render do satori é determinístico — conferi
// pedindo a mesma arte duas vezes em produção e comparando os hashes.
//
// QUALQUER VALOR DESCONHECIDO DE `formato` CAI NO DEFAULT, de propósito: um
// typo na querystring devolve a arte do WhatsApp (segura, já validada) em vez
// de 400. Esta rota é chamada pelo servidor da Meta; ela não tem para quem
// reclamar de um 400.
//
// POR QUE AO VIVO E NÃO PNG PRÉ-GERADO: a vitrine é substituída inteira a cada
// rodada de sync. Uma arte gerada na hora do disparo já nasceria vencida se o
// carrossel for reenviado, e o carrossel vive para sempre no celular do cliente.
// Renderizar no GET faz a imagem valer no instante em que a Meta a busca.
//
// PÚBLICA E SEM AUTENTICAÇÃO, DE PROPÓSITO: quem faz este GET é o servidor da
// Meta montando a mensagem — não há sessão, não há cookie, não há origem
// conhecida. Por isso esta rota NÃO usa o `origemPermitida()` de lib/api-guard:
// a allowlist de origem bloquearia justamente o único cliente que importa.
// Em compensação a rota não recebe parâmetro nenhum além do uuid e do formato,
// e não escreve nada — a superfície é "dado público de uma carta pública".
//
// O QUE PROTEGE O ESTOQUE: a leitura é na view `vw_vitrine_viva`, que só contém
// carta disponível, contemplada, com crédito > 0 e sem reserva ativa. Um uuid de
// carta vendida, reservada ou fora da vitrine simplesmente não retorna linha →
// 404. Não existe caminho por onde esta rota devolva arte de carta morta. A view
// também não expõe `fornecedor_id`.
//
// NÚMEROS: toda a formatação vem de lib/carrossel-formato.ts — o mesmo módulo
// que monta o texto do card no payload. Arte e texto não podem divergir, e os
// três formatos mostram exatamente os mesmos números pela mesma razão: eles
// chamam `reais()`/`pctAoMes()` sobre a MESMA `carta` normalizada.
//
// FONTES: o default segue na stack padrão do renderizador (ver acima). Feed e
// story carregam Space Grotesk + IBM Plex Mono via lib/card-fontes.ts, com
// cache de módulo e fallback silencioso para a stack padrão quando a rede
// falha — o card SAI de qualquer jeito, e o motivo fica no log `[card-fontes]`.
// Lá também está registrado por que Space Grotesk não varia de peso aqui (só
// existe como fonte variável no espelho, e o satori renderiza a instância
// default): NESTE LAYOUT A HIERARQUIA VEM DO TAMANHO, NÃO DO PESO.
//
// KIT "PRECISÃO NOTARIAL", o que dá para alcançar no satori: não existe
// backdrop-filter. O "vidro" é aproximado com preenchimento translúcido
// (rgba sobre o navy) + borda de 1px igualmente translúcida. Fica perto o
// bastante e não custa nada de render.
//
// O GRADIENTE-ASSINATURA APARECE UMA VEZ SÓ POR ARTE (uma barra), nunca
// espalhado: é assinatura, não enfeite. Margens de 96px constantes em feed e
// story, e a marca `bidcon` sempre no MESMO canto (topo-esquerdo) nos três
// formatos — o grid do perfil é um sistema, não uma coleção de peças.
//
// ARMADILHA DO SATORI (custou um 500 antes de virar comentário): todo `div` com
// MAIS DE UM nó filho precisa de `display: "flex"` explícito. E texto literal ao
// lado de `{expressão}` conta como DOIS filhos — `R$ {milhar(x)}` quebra, mesmo
// parecendo uma linha só de texto. Por isso todo texto aqui entra como filho
// ÚNICO (`{reais(x)}`, `{\`Administradora: ${x}\`}`). Nem `tsc --noEmit` nem
// `next build` pegam isso: só renderizando de verdade. Ao mexer no JSX abaixo,
// renderize os TRÊS formatos antes de commitar.
//
// COMPLIANCE: nenhuma data de contemplação, nenhuma palavra de rendimento;
// custo sempre "% a.m.". O rodapé cita a Conta Notarial sem prometer risco zero.
// ============================================================================
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  CAMPOS_VITRINE,
  normalizarCarta,
  reais,
  pctAoMes,
  type CartaCarrossel,
  type LinhaVitrine,
} from "@/lib/carrossel-formato";
import {
  fontesDoKit,
  esquecerFontes,
  FONT_TITULO,
  FONT_NUMERO,
} from "@/lib/card-fontes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAVY = "#0A0E1A";
const GRADIENTE = "linear-gradient(90deg, #8FB7FF 0%, #36C5F0 50%, #1E6FE6 100%)";
const AZUL_CLARO = "#8FB7FF";

/** "Vidro" do kit aproximado sem backdrop-filter — ver header. */
const VIDRO_FUNDO = "rgba(143, 183, 255, 0.07)";
const VIDRO_BORDA = "1px solid rgba(143, 183, 255, 0.22)";
const CINZA_TEXTO = "#C7D3E8";

/** Margem constante do kit nos formatos novos. */
const MARGEM = 96;

/** Bloco "rótulo em cima, valor embaixo" das três condições centrais (1200×630). */
function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          fontSize: 22,
          letterSpacing: 2,
          color: AZUL_CLARO,
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </div>
      <div style={{ fontSize: 40, color: "#FFFFFF", marginTop: 6 }}>{valor}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças compartilhadas entre feed e story — é o que faz o grid ser um sistema.
// ---------------------------------------------------------------------------

/**
 * Marca no canto. `bidcon` minúscula em branco (a grafia é regra), seguida do
 * kicker em caixa alta. São dois nós, por isso o pai tem `display: flex`.
 */
function Marca({ tamanho }: { tamanho: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div
        style={{
          fontSize: tamanho + 8,
          color: "#FFFFFF",
          fontFamily: FONT_TITULO,
          letterSpacing: 1,
        }}
      >
        bidcon
      </div>
      <div
        style={{
          fontSize: tamanho,
          letterSpacing: 4,
          color: AZUL_CLARO,
          marginLeft: 16,
          fontFamily: FONT_TITULO,
        }}
      >
        · CARTA DE CRÉDITO CONTEMPLADA
      </div>
    </div>
  );
}

/** Pill do tipo do bem. */
function Pill({ texto, tamanho }: { texto: string; tamanho: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: tamanho,
        color: "#FFFFFF",
        fontFamily: FONT_TITULO,
        border: `2px solid ${AZUL_CLARO}`,
        borderRadius: "999px",
        padding: "8px 26px",
      }}
    >
      {texto}
    </div>
  );
}

/** O gradiente-assinatura. Uma por arte — ver header. */
function Assinatura({ altura, margemTopo }: { altura: number; margemTopo: number }) {
  return (
    <div
      style={{
        display: "flex",
        height: `${altura}px`,
        width: "100%",
        marginTop: `${margemTopo}px`,
        borderRadius: `${altura / 2}px`,
        backgroundImage: GRADIENTE,
      }}
    />
  );
}

/** Linha "rótulo à esquerda, número à direita" do painel de vidro. */
function LinhaDado({
  rotulo,
  valor,
  tamRotulo,
  tamValor,
}: {
  rotulo: string;
  valor: string;
  tamRotulo: number;
  tamValor: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontSize: tamRotulo,
          letterSpacing: 2,
          color: AZUL_CLARO,
          textTransform: "uppercase",
          fontFamily: FONT_TITULO,
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          fontSize: tamValor,
          color: "#FFFFFF",
          fontFamily: FONT_NUMERO,
        }}
      >
        {valor}
      </div>
    </div>
  );
}

/** Painel de vidro que agrupa as três condições. */
function Painel({
  carta,
  tamRotulo,
  tamValor,
  espaco,
}: {
  carta: CartaCarrossel;
  tamRotulo: number;
  tamValor: number;
  espaco: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: `${espaco}px`,
        padding: "32px 36px",
        borderRadius: "24px",
        backgroundColor: VIDRO_FUNDO,
        border: VIDRO_BORDA,
      }}
    >
      <LinhaDado
        rotulo="Entrada"
        valor={reais(carta.entrada)}
        tamRotulo={tamRotulo}
        tamValor={tamValor}
      />
      <LinhaDado
        rotulo="Parcela"
        valor={`${carta.parcelas}x ${reais(carta.parcela)}`}
        tamRotulo={tamRotulo}
        tamValor={tamValor}
      />
      <LinhaDado
        rotulo="Custo ao mês"
        valor={pctAoMes(carta.custoAm)}
        tamRotulo={tamRotulo}
        tamValor={tamValor}
      />
    </div>
  );
}

/**
 * Tamanho do crédito gigante, calculado — não chutado.
 * MEDIDO no estoque em 06/08/2026: o maior crédito é 2.385.990, que `reais()`
 * escreve como "R$ 2.385.990" = 12 caracteres, e 24 cartas têm 7 dígitos. Uma
 * constante fixa que coubesse em "R$ 90.000" estouraria a margem nessas 24.
 * IBM Plex Mono avança exatamente 0.6em por glifo (mono: todo glifo igual), e
 * as stacks de fallback são mais estreitas que isso — então 0.6 erra para o
 * lado seguro nos dois casos. O `Math.floor` garante que nunca sobre.
 */
function fonteCredito(texto: string, larguraUtil: number, maximo: number): number {
  const cabe = Math.floor(larguraUtil / (texto.length * 0.6));
  return Math.max(48, Math.min(maximo, cabe));
}

// ---------------------------------------------------------------------------
// FEED — 1080×1080. É o que define o grid do perfil.
// ---------------------------------------------------------------------------
function Feed({ carta }: { carta: CartaCarrossel }) {
  const credito = reais(carta.credito);
  return (
    <div
      style={{
        width: "1080px",
        height: "1080px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: NAVY,
        padding: `${MARGEM}px`,
        fontFamily: FONT_TITULO,
      }}
    >
      {/* Topo: marca no canto de sempre, pill do tipo, assinatura. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Marca tamanho={22} />
          <Pill texto={carta.tipoLabel} tamanho={24} />
        </div>
        <Assinatura altura={8} margemTopo={28} />
      </div>

      {/* Centro: o crédito. É a informação que faz o cliente parar de rolar. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 28,
            letterSpacing: 4,
            color: AZUL_CLARO,
            fontFamily: FONT_TITULO,
          }}
        >
          CRÉDITO
        </div>
        <div
          style={{
            fontSize: fonteCredito(credito, 1080 - MARGEM * 2, 132),
            color: "#FFFFFF",
            lineHeight: 1.05,
            marginTop: 8,
            fontFamily: FONT_NUMERO,
          }}
        >
          {credito}
        </div>
      </div>

      {/* Condições + administradora. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Painel carta={carta} tamRotulo={24} tamValor={42} espaco={22} />
        <div
          style={{
            fontSize: 26,
            color: CINZA_TEXTO,
            marginTop: 26,
            fontFamily: FONT_TITULO,
          }}
        >
          {`Administradora: ${carta.administradora || "—"}`}
        </div>
      </div>

      {/* Rodapé: a garantia que sustenta o pagamento. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 24,
          color: AZUL_CLARO,
          fontFamily: FONT_TITULO,
        }}
      >
        Pagamento protegido por Conta Notarial
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STORY — 1080×1920. O padding vertical assimétrico (180 em cima, 220 embaixo)
// não é estética: é a folga para os cortes da UI do Instagram — avatar e nome
// no topo, caixa de resposta e barra de compartilhar embaixo. Tudo que importa
// mora na zona segura central.
// ---------------------------------------------------------------------------
function Story({ carta }: { carta: CartaCarrossel }) {
  const credito = reais(carta.credito);
  return (
    <div
      style={{
        width: "1080px",
        height: "1920px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: NAVY,
        // MEDIDO no render: com 180/220 a marca caía em y≈200 e o rodapé a
        // ~237px da base — ambos DENTRO das faixas que a UI do Instagram cobre
        // (topo: foto+nome+X; base: barra de resposta), ~250px de cada lado num
        // canvas de 1920. 260/280 tira os dois da zona de corte com sobra.
        // As laterais seguem em MARGEM (96px), como todo o resto do kit.
        padding: `260px ${MARGEM}px 280px ${MARGEM}px`,
        fontFamily: FONT_TITULO,
      }}
    >
      {/* Topo (com folga): a MESMA marca, no MESMO canto do feed. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Marca tamanho={22} />
        <Assinatura altura={8} margemTopo={28} />
      </div>

      {/* Zona segura central: título, crédito, três números, administradora. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* A pílula PRECISA deste invólucro `row`. Numa coluna, o align-items
            default do satori é `stretch` e ela esticava de margem a margem —
            virava campo de formulário, não pílula (visto no render). Numa row,
            o filho é dimensionado pelo conteúdo. O feed não precisa disto
            porque lá ela já nasce dentro de uma row, ao lado da marca. */}
        <div style={{ display: "flex" }}>
          <Pill texto={carta.tipoLabel} tamanho={26} />
        </div>
        <div
          style={{
            fontSize: 30,
            letterSpacing: 4,
            color: AZUL_CLARO,
            marginTop: 40,
            fontFamily: FONT_TITULO,
          }}
        >
          CRÉDITO
        </div>
        <div
          style={{
            fontSize: fonteCredito(credito, 1080 - MARGEM * 2, 128),
            color: "#FFFFFF",
            lineHeight: 1.05,
            marginTop: 8,
            fontFamily: FONT_NUMERO,
          }}
        >
          {credito}
        </div>
        <div style={{ display: "flex", marginTop: 48 }}>
          <Painel carta={carta} tamRotulo={26} tamValor={48} espaco={30} />
        </div>
        <div
          style={{
            fontSize: 28,
            color: CINZA_TEXTO,
            marginTop: 30,
            fontFamily: FONT_TITULO,
          }}
        >
          {`Administradora: ${carta.administradora || "—"}`}
        </div>
      </div>

      {/* Rodapé (com folga): CTA + a garantia. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 34,
            color: "#FFFFFF",
            fontFamily: FONT_TITULO,
            border: `2px solid ${AZUL_CLARO}`,
            borderRadius: "999px",
            padding: "20px 44px",
          }}
        >
          Carta completa no link na bio
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 26,
            color: AZUL_CLARO,
            marginTop: 28,
            fontFamily: FONT_TITULO,
          }}
        >
          Pagamento protegido por Conta Notarial
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SLIDES FIXOS DO CARROSSEL — 1080×1080, texto cravado, ZERO número.
// FAROL-VISUAL-02, 09/08/2026. Só existem no `?formato=feed`, porque o carrossel
// do Instagram é quadrado; `?formato=story&slide=capa` cai no card normal.
//
// POR QUE ELES NÃO LEEM O BANCO (é a razão de existirem como ramo próprio, e
// não como mais um `if` depois da consulta): a Meta busca a arte de CADA filho
// no momento em que cria o container. Se a capa dependesse de uma carta e essa
// carta fosse vendida ou reservada entre a montagem da URL e o fetch da Meta,
// a view devolveria 404, o filho seria recusado e — pela regra da própria OS —
// o CARROSSEL INTEIRO seria abortado. Um slide de texto fixo não tem motivo
// nenhum para depender de estoque vivo. Tirar o banco daqui não é economia de
// query: é remover uma causa de falha do conjunto.
//
// O uuid no caminho continua EXIGIDO e é IGNORADO aqui — as duas coisas ao
// mesmo tempo, e não é descuido. MEDIDO: o guard de formato de uuid roda ANTES
// deste ramo (linha ~765), então `/api/card-image/capa?slide=capa` devolve 404.
// Deixei assim de propósito: afrouxar o guard para aceitar uma segunda forma de
// caminho daria a esta rota pública mais uma superfície para guardar, em troca
// de nada. Quem chama manda um uuid sintético de zeros
// (`UUID_SLIDE_FIXO`, em lib/instagram/publicar.ts), que passa no guard e nunca
// chega ao banco. Um uuid de carta de verdade também funcionaria, mas mentiria
// no log: sugeriria que aquele slide fala daquela carta, e ele não fala.
//
// SEM NÚMERO, por ordem — e isso também os deixa fora do alcance da regra de
// compliance do "% a.m.": não há percentual para formatar errado.
// ---------------------------------------------------------------------------

/** Moldura comum dos dois slides fixos: navy, marca no canto de sempre. */
function Fixo({
  olho,
  titulo,
  linhas,
  rodape,
}: {
  olho: string;
  titulo: string;
  linhas: string[];
  rodape: string;
}) {
  return (
    <div
      style={{
        width: "1080px",
        height: "1080px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: NAVY,
        padding: `${MARGEM}px`,
        fontFamily: FONT_TITULO,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Marca tamanho={22} />
        <Assinatura altura={8} margemTopo={28} />
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 28,
            letterSpacing: 4,
            color: AZUL_CLARO,
            fontFamily: FONT_TITULO,
          }}
        >
          {olho}
        </div>
        <div
          style={{
            fontSize: 92,
            color: "#FFFFFF",
            lineHeight: 1.05,
            marginTop: 12,
            fontFamily: FONT_TITULO,
          }}
        >
          {titulo}
        </div>
        {/* Cada linha é um nó filho ÚNICO de texto — ver a armadilha do satori
            no header. Nada de `{a} {b}` na mesma div. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 40,
            gap: "14px",
          }}
        >
          {linhas.map((t) => (
            <div
              key={t}
              style={{ display: "flex", fontSize: 34, color: CINZA_TEXTO }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 26,
          color: AZUL_CLARO,
          fontFamily: FONT_TITULO,
        }}
      >
        {rodape}
      </div>
    </div>
  );
}

/** Slide 1 do carrossel semanal. */
function Capa() {
  return (
    <Fixo
      olho="TODA SEMANA"
      titulo="A tabela da semana"
      linhas={[
        "As cartas contempladas com o menor",
        "custo ao mês do nosso estoque agora.",
        "Arraste para o lado →",
      ]}
      rodape="Pagamento protegido por Conta Notarial"
    />
  );
}

/** Último slide do carrossel semanal. */
function Cta() {
  return (
    <Fixo
      olho="GOSTOU DE ALGUMA?"
      titulo="A carta completa está no link da bio"
      linhas={[
        "Salve este post para consultar depois.",
        "Prefere conversar? Chama no direct.",
        "A tabela muda toda semana.",
      ]}
      rodape="Pagamento protegido por Conta Notarial"
    />
  );
}

// ---------------------------------------------------------------------------
// PADRÃO — 1200×630. NÃO MEXER: é o card do WhatsApp já em produção. Qualquer
// alteração aqui (inclusive registrar fontes) muda os bytes do PNG.
// ---------------------------------------------------------------------------
function Padrao({ carta }: { carta: CartaCarrossel }) {
  return (
    <div
      style={{
        width: "1200px",
        height: "630px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: NAVY,
        padding: "56px 64px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Topo: marca + tipo do bem, e a régua do gradiente da marca. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 24,
              letterSpacing: 4,
              color: AZUL_CLARO,
            }}
          >
            BIDCON · CARTA DE CRÉDITO CONTEMPLADA
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              color: "#FFFFFF",
              border: `2px solid ${AZUL_CLARO}`,
              borderRadius: "999px",
              padding: "6px 22px",
            }}
          >
            {carta.tipoLabel}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            height: "6px",
            width: "100%",
            marginTop: "22px",
            borderRadius: "3px",
            backgroundImage: GRADIENTE,
          }}
        />
      </div>

      {/* Centro: o crédito, que é a informação que faz o cliente parar. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 26, letterSpacing: 3, color: AZUL_CLARO }}>
          CRÉDITO
        </div>
        <div
          style={{
            fontSize: 108,
            color: "#FFFFFF",
            lineHeight: 1.05,
            marginTop: 4,
          }}
        >
          {reais(carta.credito)}
        </div>
      </div>

      {/* Condições + administradora. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: "72px" }}>
          <Dado rotulo="Entrada" valor={reais(carta.entrada)} />
          <Dado
            rotulo="Parcela"
            valor={`${carta.parcelas}x ${reais(carta.parcela)}`}
          />
          <Dado rotulo="Custo ao mês" valor={pctAoMes(carta.custoAm)} />
        </div>
        <div style={{ fontSize: 26, color: "#C7D3E8", marginTop: 26 }}>
          {`Administradora: ${carta.administradora || "—"}`}
        </div>
      </div>

      {/* Rodapé: a garantia que sustenta o pagamento. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 22,
          color: AZUL_CLARO,
        }}
      >
        Pagamento protegido por Conta Notarial
      </div>
    </div>
  );
}

type Formato = "padrao" | "feed" | "story";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  // Guard barato antes de tocar o banco: só uuid. Evita que qualquer string
  // vire uma consulta.
  const ehUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!ehUuid) {
    return new Response("not found", { status: 404 });
  }

  // Valor desconhecido cai no default de propósito — ver header.
  const busca = new URL(req.url).searchParams;
  const pedido = busca.get("formato")?.toLowerCase();
  const formato: Formato =
    pedido === "feed" ? "feed" : pedido === "story" ? "story" : "padrao";

  // ---- SLIDES FIXOS (capa/CTA do carrossel) — ANTES do banco. Ver bloco. ----
  // `slide` desconhecido é ignorado em silêncio, na mesma doutrina do `formato`:
  // quem faz este GET é o servidor da Meta, e ele não tem para quem reclamar
  // de um 400.
  const pedidoSlide = busca.get("slide")?.toLowerCase();
  if (formato === "feed" && (pedidoSlide === "capa" || pedidoSlide === "cta")) {
    return await renderKit(pedidoSlide === "capa" ? <Capa /> : <Cta />, {
      width: 1080,
      height: 1080,
    });
  }

  let carta;
  try {
    const db = createXtvClient();
    const { data, error } = await db
      .from("vw_vitrine_viva")
      .select(CAMPOS_VITRINE)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      return new Response("not found", { status: 404 });
    }
    carta = normalizarCarta(data as unknown as LinhaVitrine);
  } catch {
    return new Response("erro", { status: 500 });
  }

  if (!carta) {
    return new Response("not found", { status: 404 });
  }

  // --- DEFAULT: o card do WhatsApp. Caminho literalmente igual ao anterior. ---
  // Não carrega fontes (registrar fonte muda os bytes do PNG), não passa por
  // nenhum ramo novo, e continua entregando o `body` em stream. É o que torna
  // "byte a byte intacto" verificável em vez de prometido.
  if (formato === "padrao") {
    const imagem = new ImageResponse(<Padrao carta={carta} />, {
      width: 1200,
      height: 630,
    });
    return comCache(imagem.headers, imagem.body);
  }

  // --- FEED / STORY --------------------------------------------------------
  const elemento =
    formato === "feed" ? <Feed carta={carta} /> : <Story carta={carta} />;
  const medidas =
    formato === "feed"
      ? { width: 1080, height: 1080 }
      : { width: 1080, height: 1920 };

  return await renderKit(elemento, medidas);
}

/**
 * Render com as fontes do kit e queda para a stack padrão.
 * EXTRAÍDO em 09/08/2026 (FAROL-VISUAL-02) para que os slides fixos do carrossel
 * usem exatamente este caminho em vez de uma segunda cópia dele. Corpo levado
 * LITERAL do GET, incluindo o comentário abaixo — mudança de endereço, não de
 * comportamento. Uma segunda cópia era o jeito garantido de a cicatriz ser
 * consertada num lugar e não no outro.
 */
async function renderKit(
  elemento: ReactElement,
  medidas: { width: number; height: number }
): Promise<Response> {
  const fontes = await fontesDoKit();

  // POR QUE ESTE RAMO EXISTE (cicatriz, não paranoia): quando o satori não
  // consegue parsear uma fonte registrada, o erro NÃO vira 500 — ele estoura
  // durante o pipe do stream e o cliente recebe conexão vazia
  // (`curl: (52) Empty reply from server`). Foi exatamente o que aconteceu com
  // a fonte variável do google/fonts (ver lib/card-fontes.ts). Consumir o corpo
  // aqui, com `arrayBuffer()`, transforma esse erro invisível numa exceção que
  // dá para pegar — e aí a arte SAI na stack padrão em vez de o feed do
  // Instagram ficar sem imagem. `esquecerFontes()` evita repetir o download
  // condenado a cada request do container.
  if (fontes) {
    try {
      const bytes = await new ImageResponse(elemento, {
        ...medidas,
        fonts: fontes,
      }).arrayBuffer();
      const headers = new Headers({ "content-type": "image/png" });
      return comCache(headers, bytes);
    } catch (e) {
      console.error(
        "[card-image] render com fontes falhou — caindo na stack padrão:",
        e instanceof Error ? e.message : "erro_desconhecido"
      );
      esquecerFontes();
    }
  }

  const imagem = new ImageResponse(elemento, medidas);
  return comCache(imagem.headers, imagem.body);
}

/**
 * CACHE — por que reescrever o header em vez de passar `headers` ao
 * ImageResponse (medido em build de produção, 06/08/2026): a opção `headers`
 * APPENDA ao padrão do próprio ImageResponse, ela não substitui. O resultado
 * era este header, servido de verdade por `next start`:
 *   public, immutable, no-transform, max-age=31536000, public, s-maxage=600, ...
 * Ou seja: um ano de cache imutável no navegador grudado antes do nosso valor.
 * Para uma arte que espelha estoque vivo isso é o pior default possível — é
 * exatamente a "arte vencida" que motivou renderizar no GET. `Headers.set`
 * troca todos os valores do nome, então o que sai é só o que está aqui.
 * O dev server mascarava o problema (lá vinha `no-store` na frente); só o
 * build de produção mostrou. Reconferir com `next start`, não com `next dev`.
 */
function comCache(base: Headers, corpo: BodyInit | null): Response {
  const headers = new Headers(base);
  headers.set("cache-control", "public, s-maxage=600, stale-while-revalidate=60");
  return new Response(corpo, { status: 200, headers });
}
