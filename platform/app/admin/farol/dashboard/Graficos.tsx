// ============================================================================
// Graficos.tsx — as primitivas de gráfico da sala de controle (PAINEL-DASHBOARD-01)
// ----------------------------------------------------------------------------
// SEM BIBLIOTECA, POR ORDEM DA OS ("SVG/CSS inline, sem biblioteca nova"). São
// três formas — barra empilhada, linha e barra horizontal — e cada uma cabe em
// algumas dezenas de linhas de SVG. Uma lib de gráfico custaria ~50kB de JS no
// cliente para desenhar o que aqui sai pronto do servidor, e obrigaria a tela a
// virar Client Component, que é exatamente o que a OS proíbe.
//
// SERVER COMPONENTS, ZERO JAVASCRIPT NO NAVEGADOR. Nenhum arquivo aqui tem
// "use client". O SVG chega pronto no HTML: a tela não pisca, não tem estado de
// carregamento e não faz fetch. O preço é não ter tooltip no hover — pago de
// propósito, e compensado pelo `<title>` de cada barra, que o navegador mostra
// no hover NATIVAMENTE e o leitor de tela anuncia. É acessibilidade e tooltip
// pelo mesmo custo: zero.
//
// AS CORES SÃO TOKENS, NUNCA LITERAIS. `var(--ok)`, `var(--brand)`,
// `var(--warn)` — os mesmos de app/globals.css. Isso não é preciosismo: o
// portal tem tema claro E tema de alto contraste (`[data-theme]`), e um
// `fill="#34d399"` cravado no SVG viraria verde-sobre-branco ilegível no claro
// e furaria o alto contraste, onde a paleta inteira é substituída. Com token, o
// gráfico acompanha o tema sem uma linha a mais.
//
// O DESVIO VISUAL JÁ FOI DECLARADO na fatia anterior (ver o header de
// ../page.tsx, item 5): a OS cita "navy #0A0E1A, IBM Plex Mono, Space Grotesk",
// que são os tokens da LANDING, não os do portal. Aqui vale a mesma decisão, e
// pelo mesmo motivo — inclusive o `--mono-painel` (pilha monoespaçada do
// sistema) nos números, que é o ponto real do "IBM Plex Mono nos números" sem
// baixar webfont na área logada.
// ============================================================================
import type { ReactNode } from "react";
import { dataBR } from "@/lib/data-br";
import { precisaMostrarN, type Medida } from "@/lib/farol/dashboard";
import s from "./dashboard.module.css";

/**
 * "2026-08-08" (chave de dia civil de SP) → "08/08/2026".
 *
 * O MEIO-DIA NÃO É ENFEITE. `dataBR` recebe um INSTANTE e o formata no relógio
 * de São Paulo; a chave aqui é uma DATA CIVIL, que não é um instante. Ancorar em
 * "T12:00:00Z" (09h BRT) põe o instante no meio do dia em qualquer offset que o
 * Brasil já teve — ancorar em "T00:00:00Z" (21h do dia ANTERIOR em BRT) faria a
 * tela rotular cada barra com o dia errado, que é exatamente o defeito que o
 * lib/data-br.ts existe para não deixar voltar.
 *
 * Dia ausente devolve o travessão porque `dataBR` já trata data inválida assim —
 * a série vazia rotula "—", não "undefined".
 */
function rotuloDia(dia: string | undefined): string {
  return dia ? dataBR(`${dia}T12:00:00Z`) : "—";
}

// ---------------------------------------------------------------------------
// Estado vazio — a peça mais importante desta tela
// ---------------------------------------------------------------------------

/**
 * O bloco que ocupa o lugar de um gráfico que não pode ser desenhado.
 *
 * A regra de honestidade da OS ("dizendo POR QUE está vazio e o que o
 * destrava") só vale alguma coisa se a ausência for MAIS visível que o dado,
 * não menos. Um card apagado com "sem dados" em cinza claro é indistinguível de
 * um bug de carregamento e ensina o operador a ignorar a região da tela. Por
 * isso este bloco tem borda tracejada (diz "reservado", não "quebrado"), o
 * motivo em texto normal e o destravamento em destaque.
 */
export function Vazio({ porque, destrava }: { porque: string; destrava: string }) {
  return (
    <div className={s.vazio}>
      <p className={s.vazioPorque}>
        <span className={s.vazioTag}>sem fonte</span> {porque}
      </p>
      <p className={s.vazioDestrava}>
        <strong>o que destrava:</strong> {destrava}
      </p>
    </div>
  );
}

/** Renderiza `medido` ou o bloco de ausência, sem a página precisar decidir. */
export function ComMedida<T>({
  medida,
  children,
}: {
  medida: Medida<T>;
  children: (valor: T, n: number) => ReactNode;
}) {
  if (medida.estado === "sem_fonte") {
    return <Vazio porque={medida.porque} destrava={medida.destrava} />;
  }
  return <>{children(medida.valor, medida.n)}</>;
}

// ---------------------------------------------------------------------------
// Números grandes
// ---------------------------------------------------------------------------

/**
 * O placar. O `n` ao lado NÃO é opcional abaixo de 10 — é a regra da OS, e é o
 * que impede "100% de sucesso" de significar "3 de 3" sem avisar.
 */
export function Numerao({
  rotulo,
  medida,
  formata,
  rodape,
}: {
  rotulo: string;
  medida: Medida<number>;
  formata: (v: number) => string;
  rodape?: string;
}) {
  return (
    <div className={s.numeroBloco}>
      <span className={s.numeroRotulo}>{rotulo}</span>
      {medida.estado === "sem_fonte" ? (
        <Vazio porque={medida.porque} destrava={medida.destrava} />
      ) : (
        <>
          <span className={s.numeroValor}>
            {formata(medida.valor)}
            {precisaMostrarN(medida.n) && <span className={s.numeroN}>n={medida.n}</span>}
          </span>
          {rodape && <span className={s.numeroRodape}>{rodape}</span>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras empilhadas por dia
// ---------------------------------------------------------------------------

export type FaixaBarra = { chave: string; rotulo: string; cor: string };

/**
 * Barras empilhadas — uma coluna por dia da janela, inclusive as vazias.
 *
 * O DIA VAZIO DESENHA UM TRILHO, não nada. Sem o trilho, trinta dias com três
 * publicações viram três barras soltas num campo branco e o olho lê "houve
 * produção"; com o trilho, o mesmo dado lê "vinte e sete dias parados", que é a
 * verdade. É uma linha de SVG e muda o sentido do gráfico inteiro.
 *
 * A escala é o MÁXIMO OBSERVADO, com piso 1 — não uma escala fixa. Com números
 * de um dígito qualquer teto arbitrário achataria tudo contra o eixo.
 */
export function BarrasEmpilhadas<T extends { dia: string }>({
  serie,
  faixas,
  titulo,
}: {
  serie: T[];
  faixas: FaixaBarra[];
  titulo: string;
}) {
  const alturaTotal = 100;
  const larguraPasso = 100 / Math.max(serie.length, 1);
  const larguraBarra = Math.min(larguraPasso * 0.62, 3.4);

  const totalDe = (d: T) =>
    faixas.reduce((soma, f) => soma + ((d as Record<string, unknown>)[f.chave] as number ?? 0), 0);
  const teto = Math.max(1, ...serie.map(totalDe));

  return (
    <figure className={s.figura}>
      <svg
        viewBox={`0 0 100 ${alturaTotal}`}
        className={s.svgBarras}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${titulo}. Máximo de ${teto} por dia em ${serie.length} dias.`}
      >
        {/* linha de base */}
        <line x1="0" y1={alturaTotal} x2="100" y2={alturaTotal} className={s.eixo} />

        {serie.map((d, i) => {
          const x = i * larguraPasso + (larguraPasso - larguraBarra) / 2;
          const total = totalDe(d);
          let y = alturaTotal;
          return (
            <g key={d.dia}>
              {/* o trilho do dia vazio — ver o comentário acima */}
              <rect
                x={x}
                y={alturaTotal - 1.2}
                width={larguraBarra}
                height={1.2}
                className={s.trilho}
              />
              {faixas.map((f) => {
                const v = ((d as Record<string, unknown>)[f.chave] as number) ?? 0;
                if (v <= 0) return null;
                const h = (v / teto) * (alturaTotal - 6);
                y -= h;
                return (
                  <rect key={f.chave} x={x} y={y} width={larguraBarra} height={h} fill={f.cor}>
                    <title>{`${rotuloDia(d.dia)} · ${f.rotulo}: ${v}`}</title>
                  </rect>
                );
              })}
              {total === 0 && <title>{`${rotuloDia(d.dia)} · nada`}</title>}
            </g>
          );
        })}
      </svg>
      <figcaption className={s.legenda}>
        {faixas.map((f) => (
          <span key={f.chave} className={s.legendaItem}>
            <span className={s.legendaCor} style={{ background: f.cor }} aria-hidden="true" />
            {f.rotulo}
          </span>
        ))}
        <span className={s.legendaEixo}>
          {serie.length} dias · pico {teto}/dia · {rotuloDia(serie[0]?.dia)} →{" "}
          {rotuloDia(serie[serie.length - 1]?.dia)}
        </span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Linha
// ---------------------------------------------------------------------------

export type SerieLinha = { chave: string; rotulo: string; cor: string };

/**
 * Linha por dia, uma polilinha por série.
 *
 * PONTO ISOLADO GANHA UM MARCADOR. Uma série com um único dia não tem segmento
 * para desenhar — `<polyline>` com um ponto só é invisível. Com os volumes de
 * hoje (25 conversas em três semanas) esse é o caso NORMAL, não a exceção, e
 * sem o marcador a seção inteira pareceria vazia estando cheia.
 *
 * O MARCADOR É UMA LINHA DE COMPRIMENTO ZERO, NÃO UM `<circle>`, e a diferença
 * é visível. Este SVG usa `preserveAspectRatio="none"` para esticar 100×100
 * unidades numa caixa larga e baixa — a escala em x e em y é diferente, então um
 * `<circle r="1.1">` sairia como uma ELIPSE achatada e a espessura do traço
 * variaria conforme a inclinação do segmento. Uma linha de comprimento zero com
 * `stroke-linecap="round"` renderiza como um ponto cujo diâmetro é a espessura
 * do traço, e `vector-effect="non-scaling-stroke"` mede essa espessura em pixels
 * de tela, imune à distorção. Mesmo motivo pelo qual a polilinha e o eixo também
 * carregam o `vector-effect`.
 */
export function LinhaTemporal<T extends { dia: string }>({
  serie,
  series,
  titulo,
}: {
  serie: T[];
  series: SerieLinha[];
  titulo: string;
}) {
  const W = 100;
  const H = 100;
  const teto = Math.max(
    1,
    ...serie.flatMap((d) =>
      series.map((sr) => ((d as Record<string, unknown>)[sr.chave] as number) ?? 0)
    )
  );
  const px = (i: number) => (serie.length <= 1 ? W / 2 : (i / (serie.length - 1)) * W);
  const py = (v: number) => H - (v / teto) * (H - 6) - 2;

  return (
    <figure className={s.figura}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={s.svgLinha}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${titulo}. Pico de ${teto} por dia em ${serie.length} dias.`}
      >
        <line x1="0" y1={H - 2} x2={W} y2={H - 2} className={s.eixo} />
        {series.map((sr) => {
          const pontos = serie.map((d, i) => {
            const v = ((d as Record<string, unknown>)[sr.chave] as number) ?? 0;
            return { x: px(i), y: py(v), v, dia: d.dia };
          });
          return (
            <g key={sr.chave}>
              <polyline
                points={pontos.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={sr.cor}
                className={s.tracoLinha}
              />
              {pontos
                .filter((p) => p.v > 0)
                .map((p) => (
                  <line
                    key={p.dia}
                    x1={p.x}
                    y1={p.y}
                    x2={p.x}
                    y2={p.y}
                    stroke={sr.cor}
                    className={s.marcador}
                  >
                    <title>{`${rotuloDia(p.dia)} · ${sr.rotulo}: ${p.v}`}</title>
                  </line>
                ))}
            </g>
          );
        })}
      </svg>
      <figcaption className={s.legenda}>
        {series.map((sr) => (
          <span key={sr.chave} className={s.legendaItem}>
            <span className={s.legendaCor} style={{ background: sr.cor }} aria-hidden="true" />
            {sr.rotulo}
          </span>
        ))}
        <span className={s.legendaEixo}>pico {teto}/dia</span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Barras horizontais — o funil
// ---------------------------------------------------------------------------

export type EtapaBarra = {
  rotulo: string;
  medida: Medida<number>;
  conversao: number | null;
};

/**
 * O funil, em barras horizontais proporcionais à PRIMEIRA etapa medida.
 *
 * A etapa SEM FONTE aparece com o mesmo peso visual das outras, com a barra
 * substituída pela explicação. Um funil que simplesmente omite a última etapa
 * ensina que o funil termina antes — e a pergunta "isso vira cedente?", que é a
 * razão de o funil existir, desaparece com a barra.
 */
export function Funil({ etapas }: { etapas: EtapaBarra[] }) {
  const base = etapas.find((e) => e.medida.estado === "medido");
  const topo =
    base && base.medida.estado === "medido" ? Math.max(base.medida.valor, 1) : 1;

  return (
    <ol className={s.funil}>
      {etapas.map((e) => (
        <li key={e.rotulo} className={s.funilEtapa}>
          <div className={s.funilCabeca}>
            <span className={s.funilRotulo}>{e.rotulo}</span>
            {e.medida.estado === "medido" && (
              <span className={s.funilNumero}>
                {e.medida.valor}
                {e.conversao != null && (
                  <span className={s.funilConversao}>
                    {(e.conversao * 100).toFixed(0)}% da anterior
                  </span>
                )}
              </span>
            )}
          </div>
          {e.medida.estado === "medido" ? (
            <div className={s.funilTrilho}>
              <div
                className={s.funilBarra}
                style={{ width: `${Math.min(100, (e.medida.valor / topo) * 100)}%` }}
              />
            </div>
          ) : (
            <Vazio porque={e.medida.porque} destrava={e.medida.destrava} />
          )}
        </li>
      ))}
    </ol>
  );
}
