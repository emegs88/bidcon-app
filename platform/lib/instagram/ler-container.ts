// ============================================================================
// ler-container.ts — DIAG-CONTAINER-02 · UM leitor de container, e um só
// AUTORIZADO: Emerson Gomes dos Santos — 11/08/2026:
//   "2. CONSERTO: substituir a leitura própria do diag pela MESMA função que a
//    fase 2 do reel-publicar usa (os logs de produção provam que ela devolve
//    status_code e marca copyright como 'ausente' quando não vem). Não manter
//    dois leitores."
// ----------------------------------------------------------------------------
// O DEFEITO QUE ESTE ARQUIVO EXISTE PARA MATAR, e ele era meu
// ----------------------------------------------------------------------------
// A DIAG-CONTAINER-01 escreveu um leitor PRÓPRIO dentro da sua rota
// (`lerContainer`), com o comentário "Os mesmos campos de lib/farol/container.ts,
// por acordo". O acordo era verdadeiro e inútil: os campos eram idênticos —
//
//     rota do diag  : "id,status,status_code,copyright_check_status"
//     CAMPOS_CONTAINER: "id,status,status_code,copyright_check_status"
//
// — e mesmo assim um funcionou e o outro mentiu. O que o leitor do diag NÃO
// copiou foi a ESCADA: quando a Graph recusa o conjunto por campo inexistente
// (`code=100`), o `statusContainer` do reel-publicar desce UM degrau e relê,
// enquanto o do diag devolvia o erro e ia embora com `status_code: null`.
//
// Aí a árvore de leitura recebia `null` dos dois lados, chamava os dois de
// "travado" (porque o container já tinha mais de 15 min) e imprimia o veredito
// `meta` como CONCLUSIVO. Uma requisição rejeitada virou um diagnóstico.
//
// A lição, escrita aqui porque é a única parte que se generaliza: DOIS LEITORES
// COM OS MESMOS CAMPOS NÃO SÃO O MESMO LEITOR. A duplicação não estava na
// string; estava no tratamento do erro, que é justamente a parte que ninguém
// copia porque parece acessória. Enquanto existirem dois, o conserto de um não
// alcança o outro — e foi exatamente isso que aconteceu.
//
// ----------------------------------------------------------------------------
// POR QUE ISTO MORA EM lib/instagram/ E NÃO EM lib/farol/container.ts
// ----------------------------------------------------------------------------
// `lib/farol/container.ts` é vocabulário puro: sem rede, sem relógio, sem banco.
// Empurrar `fetch` para dentro dele estragaria a única propriedade que o torna
// testável de graça. Já `lib/instagram/` JÁ É a camada de I/O da Graph nesta
// casa — `publicar.ts` faz `fetch`, `rupload.ts` faz `fetch`. Este arquivo entra
// entre iguais.
//
// A DECISÃO continua fora daqui: esta função devolve LITERAIS (e o erro literal
// quando há erro). Quem conclui é `lerAB`, em lib/farol/diag-container.ts, sob
// teste. Um leitor que opina é um leitor que não se pode auditar.
// ============================================================================
import { CAMPOS_CONTAINER, degrauAbaixo, resumoContainer, type ResumoContainer } from "@/lib/farol/container";

const IG_GRAPH_VERSION = "v25.0";

/**
 * Teto de espera por chamada.
 *
 * ENTRA POR PARÂMETRO, e o padrão é 20 s, porque os dois chamadores foram
 * MEDIDOS com números diferentes: `reel-publicar/route.ts` usa 15 s e a rota do
 * diag usa 20 s. Unificar em silêncio mudaria a paciência do caminho de
 * PRODUÇÃO — que publica de verdade e roda de 10 em 10 min — por causa de uma
 * fatia de diagnóstico. "Um leitor só" é sobre a lógica de leitura, não sobre
 * apagar uma diferença de operação que ninguém pediu para apagar.
 */
export const TIMEOUT_PADRAO_MS = 20_000;

/** Quantos degraus a escada pode descer numa mesma leitura, no total. */
const MAX_DEGRAUS = 4;

export type LeituraGraph =
  | {
      ok: true;
      resumo: ResumoContainer;
      bruto: unknown;
      /** O conjunto de campos que a Graph ACEITOU. */
      campos_usados: string;
      /** Quantas vezes foi preciso descer. 0 = o conjunto completo passou. */
      degraus: number;
      erro: null;
    }
  | {
      ok: false;
      resumo: null;
      bruto: unknown;
      /** O último conjunto tentado antes de desistir. */
      campos_usados: string;
      degraus: number;
      /** Erro LITERAL da Graph: `code=100 subcode=... mensagem`. */
      erro: string;
    };

/**
 * GET num container da Graph, com a escada de degradação.
 *
 * NUNCA LANÇA. Todo caminho de falha volta `ok: false` com o erro literal —
 * incluindo timeout e env ausente. Quem chama precisa poder distinguir "a Meta
 * disse X" de "não consegui perguntar", e uma exceção apaga essa diferença ao
 * subir a pilha.
 *
 * `copyright_check_status` ausente na resposta vira `null` no resumo, e `null`
 * aqui quer dizer "a Meta não devolveu este campo" — que é diferente de
 * "devolveu vazio" e MUITO diferente de "não perguntei". Quem quiser saber se
 * chegamos a perguntar olha `campos_usados`: se o degrau usado não contém
 * `copyright_check_status`, o campo não foi pedido nesta leitura.
 */
export async function lerContainerGraph(
  containerId: string,
  opts?: { campos?: string; timeoutMs?: number }
): Promise<LeituraGraph> {
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_PADRAO_MS;
  let campos = opts?.campos ?? CAMPOS_CONTAINER;
  let degraus = 0;

  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) {
    return {
      ok: false,
      resumo: null,
      bruto: null,
      campos_usados: campos,
      degraus,
      erro: "env_ausente(IG_ACCESS_TOKEN)",
    };
  }

  // Laço em vez de recursão: o número de degraus fica visível no retorno, e um
  // conjunto fora da escada não pode girar em falso — `degrauAbaixo` devolve o
  // piso para conjuntos desconhecidos, e MAX_DEGRAUS fecha a porta de qualquer
  // ciclo que alguém introduza editando ESCADA_CAMPOS.
  for (;;) {
    const url =
      `https://graph.instagram.com/${IG_GRAPH_VERSION}/${encodeURIComponent(containerId)}` +
      `?fields=${encodeURIComponent(campos)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const data: unknown = await resp.json().catch(() => ({}));

      if (resp.ok) {
        return {
          ok: true,
          resumo: resumoContainer(data),
          bruto: data,
          campos_usados: campos,
          degraus,
          erro: null,
        };
      }

      const err = (data as {
        error?: { message?: string; code?: number; error_subcode?: number };
      })?.error;

      // code 100 = campo inválido/inexistente para este nó. Desce UM degrau.
      // Não despenca até o piso: perder um campo é o preço de pedir um campo
      // novo; perder todos é o defeito que esta fatia conserta.
      if (err?.code === 100 && degraus < MAX_DEGRAUS) {
        const abaixo = degrauAbaixo(campos);
        if (abaixo && abaixo !== campos) {
          console.warn("[ler-container] campos recusados, descendo um degrau:", {
            campos,
            proximo: abaixo,
            erro: err?.message,
          });
          campos = abaixo;
          degraus += 1;
          continue;
        }
      }

      return {
        ok: false,
        resumo: null,
        bruto: data,
        campos_usados: campos,
        degraus,
        erro: montarErro(err, resp.status),
      };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return {
          ok: false,
          resumo: null,
          bruto: null,
          campos_usados: campos,
          degraus,
          erro: `timeout_instagram_api(${timeoutMs}ms)`,
        };
      }
      return {
        ok: false,
        resumo: null,
        bruto: null,
        campos_usados: campos,
        degraus,
        erro: e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * O erro da Graph em uma linha, com `code` e `subcode` NA FRENTE.
 *
 * A ordem não é estética: `code=100` é a assinatura do defeito que derrubou a
 * leitura de 11/08, e quem lê o painel precisa vê-la sem rolar a mensagem. O
 * corte em 500 caracteres é o mesmo dos dois leitores anteriores.
 */
function montarErro(
  err: { message?: string; code?: number; error_subcode?: number } | undefined,
  httpStatus: number
): string {
  return [
    err?.code !== undefined ? `code=${err.code}` : null,
    err?.error_subcode !== undefined ? `subcode=${err.error_subcode}` : null,
    err?.message ?? `http_${httpStatus}`,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}
