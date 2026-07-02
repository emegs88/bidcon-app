// ============================================================================
// Guarda de léxico de compliance — reutilizável no servidor.
// ----------------------------------------------------------------------------
// `garantirLexico(texto)` é a última barreira antes de qualquer texto sair da
// plataforma (e-mails internos hoje; outros canais amanhã). Se encontrar termo
// proibido em fronteira de palavra e NÃO negado, devolve { ok:false, termo }.
// O chamador decide o que fazer — no aviso de cadastro, NÃO envia e registra o
// motivo, sem nunca derrubar o cadastro.
//
// FONTE-ESPELHO: a régua canônica vive em lib/ia.ts (TERMOS_PROIBIDOS +
// violaTermo, usada por sanitizarCompliance do agente). Aqui a lista é
// espelhada porque aquela é `const`/`function` local (não exportada). Ao mudar
// a régua num lado, sincronizar o outro. Mesma semântica: sem acento,
// case-insensitive, casa em limite de palavra, libera a forma negada.
// ============================================================================

// Régua regulatória de consórcio + sigilo de mecânica interna (espelho de ia.ts).
export const TERMOS_PROIBIDOS = [
  // régua regulatória de consórcio
  "investimento",
  "investidor",
  "rendimento",
  "garantido",
  "garantida",
  "desconto",
  "aprovacao de credito",
  "aprovação de crédito",
  "limite de credito",
  "limite de crédito",
  "contemplacao garantida",
  "contemplação garantida",
  // mecânica interna (sigilo) — nunca verbalizar
  "ccb",
  "fidc",
  "funding",
  "custo de aquisicao",
  "custo de aquisição",
  "custo de capital",
  "cedula de credito bancario",
  "cédula de crédito bancário",
  "estrutura de aquisicao",
  "estrutura de aquisição",
] as const;

const NEGACOES = ["nao ", "não ", "sem ", "nunca "];

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export type ResultadoLexico =
  | { ok: true }
  | { ok: false; termo: string };

/**
 * Verifica um texto contra a régua de léxico. Retorna o PRIMEIRO termo que
 * viola (em fronteira de palavra, não negado) ou { ok:true } se limpo.
 *
 * A fronteira de palavra evita que siglas curtas (ccb/fidc/funding) casem
 * dentro de outra palavra. A janela curta antes da ocorrência libera a forma
 * negada institucional ("não é investimento").
 */
export function garantirLexico(texto: string): ResultadoLexico {
  const base = semAcento((texto ?? "").toLowerCase());
  for (const termoRaw of TERMOS_PROIBIDOS) {
    const termo = semAcento(termoRaw.toLowerCase());
    let idx = base.indexOf(termo);
    while (idx !== -1) {
      const ant = base[idx - 1] ?? " ";
      const dep = base[idx + termo.length] ?? " ";
      const fronteira = /[^a-z0-9]/.test(ant) && /[^a-z0-9]/.test(dep);
      if (fronteira) {
        const antes = base.slice(Math.max(0, idx - 8), idx);
        const negado = NEGACOES.some((n) => antes.includes(semAcento(n)));
        if (!negado) return { ok: false, termo: termoRaw };
      }
      idx = base.indexOf(termo, idx + termo.length);
    }
  }
  return { ok: true };
}
