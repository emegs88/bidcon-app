// ============================================================================
// CARROSSEL-OPS-01 Peças 2+3 — fonte ÚNICA de seleção e formatação dos números
// que aparecem no carrossel do WhatsApp (imagem do card + body do card).
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE: a imagem (`/api/card-image/[id]`) e o texto do
// card (`/api/whatsapp/carrossel-payload`) são renderizados por processos
// diferentes, em momentos diferentes — a imagem é buscada pelos servidores da
// Meta quando ela monta a mensagem; o texto vai no payload. Se cada um
// formatasse por conta própria, um card poderia dizer "R$ 69.525" na arte e
// "R$ 69.524" no texto. Toda a aritmética de exibição mora aqui, e as duas
// rotas importam daqui — não há segunda cópia.
//
// ---------------------------------------------------------------------------
// DE ONDE VÊM OS DADOS (medido em 06/08/2026, xtv):
// A fonte é a VIEW `vw_vitrine_viva`, a MESMA que `/api/vitrine` já lê para
// alimentar a vitrine pública de www.bidcon.com.br. Não é preciosismo: a view
// embute quatro filtros que uma consulta direta em `cartas` NÃO tem, e cada um
// deles já causou (ou causaria) um card mentiroso no carrossel:
//   1. status='disponivel'
//   2. valor_credito > 0
//   3. categoria='contemplada'   → 12 cartas 'disponivel' NÃO são contempladas
//   4. NOT EXISTS reserva ativa no mesmo fingerprint → carta reservada no chat
//      some da vitrine sem `cartas.status` mudar
// Além disso a view resolve `COALESCE(administradora.nome, administradora_raw)`
// — 25 cartas disponíveis não têm `administradora_id` e só têm o texto cru; lidas
// pelo join que a página usa, apareceriam com administradora vazia.
// A view TAMBÉM não expõe `fornecedor_id` — o campo proibido fica inalcançável
// por construção, não por disciplina de quem escreve o select.
//
// ---------------------------------------------------------------------------
// CUSTO AO MÊS — por que NÃO usamos `custo_am` da view:
// A view traz `bidcon_custo_am` (coluna gravada pelo sync). A página
// `/cartas/<uuid>`, que é o DESTINO do clique no card, não lê essa coluna: ela
// calcula a TIR em JS por bisseção (`custoEfetivoCarta`, lib/custo-efetivo.ts).
// Medido nas 2.596 cartas disponíveis: 2.579 batem, 17 divergem em exatamente
// 0,01 p.p. (casos que caem em cima da borda de arredondamento). É 0,65% do
// estoque — pequeno, mas o carrossel promete o número que a página vai mostrar,
// então quem manda é a página. Chamamos a MESMA função dela.
//
// ---------------------------------------------------------------------------
// DINHEIRO SEM CENTAVOS — decisão consciente, com um efeito colateral honesto:
// O formato abaixo é `Math.round(v)` + separador pt-BR, idêntico ao gerador da
// vitrine estática (scripts/gerar-vitrine.mjs, `BRL`). Ele reproduz LETRA POR
// LETRA os exemplos aprovados do template `bidcon_vitrine_cartas_v2`, que saíram
// da carta 83f8af16 (crédito 136.069,72 → "136.070"; entrada 69.524,88 →
// "R$ 69.525"; parcela 854,67 → "R$ 855"; 109 parcelas; 0,65% a.m.).
// EFEITO COLATERAL: a página `/cartas/<uuid>` formata com `brl()`, que mantém
// centavos. Nas ~30 cartas do estoque com centavos não-zero, o card dirá
// "R$ 136.070" e a página dirá "R$ 136.069,72". Mesmo valor, arredondamento
// diferente. Mantido assim porque o formato do template é o especificado e é o
// que a vitrine pública já usa; registrado aqui para não virar "bug" surpresa.
//
// COMPLIANCE (CLAUDE.md): custo SEMPRE como "% a.m." (nunca nominal simples);
// nunca "investimento/rendimento/lucro/CDI"; nenhuma promessa de contemplação.
// ============================================================================
import { custoEfetivoCarta, fmtCustoEfetivo } from "@/lib/custo-efetivo";
import { LABEL_TIPO_BEM } from "@/lib/status";

// Origem absoluta das imagens do card. Precisa ser absoluta e PÚBLICA porque
// quem faz o GET é o servidor da Meta, não o navegador do cliente — URL
// relativa ou host de preview não resolvem do lado de lá.
export const APP_URL = "https://app.bidcon.com.br";

// Colunas lidas de `vw_vitrine_viva`. Enumeradas uma a uma (nunca `*`): a view
// é lida com service_role, e select explícito é o que mantém o alcance mínimo.
export const CAMPOS_VITRINE =
  "id,tipo,credito,entrada,parcela,parcelas,agio_150,administradora,exclusiva";

/** Linha crua da view, como o PostgREST devolve. */
export type LinhaVitrine = {
  id: string | null;
  tipo: string | null;
  credito: number | null;
  entrada: number | null;
  parcela: number | null;
  parcelas: number | null;
  agio_150: number | null;
  administradora: string | null;
  exclusiva: boolean | null;
};

/** Carta já normalizada e com o custo calculado do mesmo jeito que a página. */
export type CartaCarrossel = {
  id: string;
  tipo: string;
  tipoLabel: string;
  administradora: string;
  credito: number;
  entrada: number;
  parcela: number;
  parcelas: number;
  /** % a.m. pela bisseção de lib/custo-efetivo.ts. null = não exibível. */
  custoAm: number | null;
  /** true = carta própria da Bidcon (view: fonte='cliente_direto'). */
  exclusiva: boolean;
};

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Converte a linha da view no formato de exibição. Devolve null quando a linha
 * não tem o mínimo para virar card (sem id, ou sem crédito) — melhor pular a
 * carta do que publicar um card com buraco.
 */
export function normalizarCarta(l: LinhaVitrine): CartaCarrossel | null {
  if (!l.id) return null;
  const credito = num(l.credito);
  if (!(credito > 0)) return null;

  const tipo = l.tipo ?? "";
  return {
    id: l.id,
    tipo,
    tipoLabel: LABEL_TIPO_BEM[tipo] ?? tipo,
    administradora: (l.administradora ?? "").trim(),
    credito,
    entrada: num(l.entrada),
    parcela: num(l.parcela),
    parcelas: num(l.parcelas),
    custoAm: custoEfetivoCarta({
      valor_credito: credito,
      valor_entrada: num(l.entrada),
      valor_parcela: num(l.parcela) || null,
      qtd_parcelas: num(l.parcelas) || null,
    }),
    exclusiva: !!l.exclusiva,
  };
}

// ---------------------------------------------------------------------------
// Formatação. Idêntica à do gerador da vitrine estática (sem centavos).
// ---------------------------------------------------------------------------

/** 136069.72 → "136.070" (milhar pt-BR, sem "R$", sem centavos). */
export function milhar(v: number): string {
  return Math.round(v).toLocaleString("pt-BR");
}

/** 69524.88 → "R$ 69.525". */
export function reais(v: number): string {
  return "R$ " + milhar(v);
}

/** 0.65 → "0,65% a.m."; null → "—". Reusa o formatador da página. */
export function pctAoMes(taxa: number | null): string {
  return fmtCustoEfetivo(taxa);
}

// ---------------------------------------------------------------------------
// Parâmetros do template `bidcon_vitrine_cartas_v2` (3 no body de cada card).
// ---------------------------------------------------------------------------

/** {{1}} — ex.: "Imóvel · CNP (Caixa)". Sem administradora, só o tipo. */
export function paramTipoAdm(c: CartaCarrossel): string {
  return c.administradora ? `${c.tipoLabel} · ${c.administradora}` : c.tipoLabel;
}

/** {{2}} — ex.: "136.070". Sem "R$": o template já traz o prefixo. */
export function paramCredito(c: CartaCarrossel): string {
  return milhar(c.credito);
}

/** {{3}} — ex.: "R$ 69.525 · 109x R$ 855 · 0,65% a.m.". */
export function paramCondicoes(c: CartaCarrossel): string {
  const partes: string[] = [];
  if (c.entrada > 0) partes.push(reais(c.entrada));
  if (c.parcelas > 0 && c.parcela > 0) {
    partes.push(`${c.parcelas}x ${reais(c.parcela)}`);
  }
  if (c.custoAm != null) partes.push(pctAoMes(c.custoAm));
  return partes.join(" · ");
}

/** URL pública da arte do card (buscada pelos servidores da Meta). */
export function urlImagemCard(id: string): string {
  return `${APP_URL}/api/card-image/${id}`;
}

/**
 * Parâmetro do botão URL. O template tem a base cravada
 * (`https://app.bidcon.com.br/cartas/`), então aqui vai só o sufixo: uuid + UTM.
 */
export function paramBotao(id: string): string {
  return `${id}?utm_source=whatsapp&utm_medium=carousel&utm_campaign=vitrine_v2`;
}
