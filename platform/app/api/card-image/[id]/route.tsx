// ============================================================================
// CARROSSEL-OPS-01 Peça 2 — GET /api/card-image/[id]
// Arte 1200×630 (1.91:1) de UMA carta, gerada ao vivo a partir do estoque.
// ----------------------------------------------------------------------------
// POR QUE AO VIVO E NÃO PNG PRÉ-GERADO: a vitrine é substituída inteira a cada
// rodada de sync. Uma arte gerada na hora do disparo já nasceria vencida se o
// carrossel for reenviado, e o carrossel vive para sempre no celular do cliente.
// Renderizar no GET faz a imagem valer no instante em que a Meta a busca.
//
// PÚBLICA E SEM AUTENTICAÇÃO, DE PROPÓSITO: quem faz este GET é o servidor da
// Meta montando a mensagem — não há sessão, não há cookie, não há origem
// conhecida. Por isso esta rota NÃO usa o `origemPermitida()` de lib/api-guard:
// a allowlist de origem bloquearia justamente o único cliente que importa.
// Em compensação a rota não recebe parâmetro nenhum além do uuid e não escreve
// nada — a superfície é "dado público de uma carta pública".
//
// O QUE PROTEGE O ESTOQUE: a leitura é na view `vw_vitrine_viva`, que só contém
// carta disponível, contemplada, com crédito > 0 e sem reserva ativa. Um uuid de
// carta vendida, reservada ou fora da vitrine simplesmente não retorna linha →
// 404. Não existe caminho por onde esta rota devolva arte de carta morta. A view
// também não expõe `fornecedor_id`.
//
// NÚMEROS: toda a formatação vem de lib/carrossel-formato.ts — o mesmo módulo
// que monta o texto do card no payload. Arte e texto não podem divergir.
//
// FONTES: usa a stack padrão do renderizador. Space Grotesk / IBM Plex Mono
// exigiriam carregar arquivo .ttf a cada request (latência + ponto de falha no
// caminho crítico da Meta). Fica como polimento futuro, registrado aqui.
//
// ARMADILHA DO SATORI (custou um 500 antes de virar comentário): todo `div` com
// MAIS DE UM nó filho precisa de `display: "flex"` explícito. E texto literal ao
// lado de `{expressão}` conta como DOIS filhos — `R$ {milhar(x)}` quebra, mesmo
// parecendo uma linha só de texto. Por isso todo texto aqui entra como filho
// ÚNICO (`{reais(x)}`, `{\`Administradora: ${x}\`}`). Nem `tsc --noEmit` nem
// `next build` pegam isso: só renderizando de verdade. Ao mexer no JSX abaixo,
// renderize a rota antes de commitar.
//
// COMPLIANCE: nenhuma data de contemplação, nenhuma palavra de rendimento;
// custo sempre "% a.m.". O rodapé cita a Conta Notarial sem prometer risco zero.
// ============================================================================
import { ImageResponse } from "next/og";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  CAMPOS_VITRINE,
  normalizarCarta,
  reais,
  pctAoMes,
  type LinhaVitrine,
} from "@/lib/carrossel-formato";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAVY = "#0A0E1A";
const GRADIENTE = "linear-gradient(90deg, #8FB7FF 0%, #36C5F0 50%, #1E6FE6 100%)";
const AZUL_CLARO = "#8FB7FF";

/** Bloco "rótulo em cima, valor embaixo" das três condições centrais. */
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

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;

  // Guard barato antes de tocar o banco: só uuid. Evita que qualquer string
  // vire uma consulta.
  const ehUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!ehUuid) {
    return new Response("not found", { status: 404 });
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

  const imagem = new ImageResponse(
    (
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
    ),
    { width: 1200, height: 630 }
  );

  // CACHE — por que reescrever o header em vez de passar `headers` ao
  // ImageResponse (medido em build de produção, 06/08/2026): a opção `headers`
  // APPENDA ao padrão do próprio ImageResponse, ela não substitui. O resultado
  // era este header, servido de verdade por `next start`:
  //   public, immutable, no-transform, max-age=31536000, public, s-maxage=600, ...
  // Ou seja: um ano de cache imutável no navegador grudado antes do nosso valor.
  // Para uma arte que espelha estoque vivo isso é o pior default possível — é
  // exatamente a "arte vencida" que motivou renderizar no GET. `Headers.set`
  // troca todos os valores do nome, então o que sai é só o que está aqui.
  // O dev server mascarava o problema (lá vinha `no-store` na frente); só o
  // build de produção mostrou. Reconferir com `next start`, não com `next dev`.
  const headers = new Headers(imagem.headers);
  headers.set("cache-control", "public, s-maxage=600, stale-while-revalidate=60");
  return new Response(imagem.body, { status: 200, headers });
}
