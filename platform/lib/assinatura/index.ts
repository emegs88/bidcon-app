// ============================================================================
// BIDCON-ASSINATURA-01 — seletor de provedor + constantes da fatia.
// ----------------------------------------------------------------------------
// ESIGN_PROVIDER deixa de ser env órfã e passa a ser o seletor do adapter.
// Sem ela, a fatia inteira responde "não configurado" e NÃO escreve nada —
// é o mesmo comportamento de /api/processo/esign, para não haver dois
// contratos de resposta diferentes convivendo no mesmo app.
//
// Storage: bucket ÚNICO e já existente `processo-docs` (privado). Não se cria
// bucket nesta fatia. ASSINATURA_STORAGE_BUCKET existe só como escape hatch de
// operação; o default é o bucket da casa.
// ============================================================================
import type { AssinaturaProvider } from "./tipos";
import { criarProviderZapSign } from "./zapsign";

export * from "./tipos";
export { segredoConfere } from "./seguranca";

/** Bucket privado onde vivem os PDFs a assinar e os assinados. */
export function bucketAssinatura(): string {
  return (process.env.ASSINATURA_STORAGE_BUCKET ?? "").trim() || "processo-docs";
}

/** true se há provedor selecionado. Não valida credencial (isso é da factory). */
export function providerConfigurado(): boolean {
  return (process.env.ESIGN_PROVIDER ?? "").trim() !== "";
}

/**
 * Devolve o adapter do provedor selecionado.
 * Joga se ESIGN_PROVIDER estiver vazia ou apontar para provedor sem adapter —
 * quem chama deve conferir providerConfigurado() antes e responder
 * { status: 'nao_configurado' }, sem 500.
 */
export function obterProvider(): AssinaturaProvider {
  const nome = (process.env.ESIGN_PROVIDER ?? "").trim().toLowerCase();
  switch (nome) {
    case "zapsign":
      return criarProviderZapSign();
    case "":
      throw new Error("ESIGN_PROVIDER não configurada.");
    default:
      // Clicksign/Docusign estão no CHECK do banco mas ainda não têm adapter.
      // Falha explícita é melhor que cair no ZapSign por engano.
      throw new Error(`Provedor de assinatura sem adapter: ${nome}.`);
  }
}

/**
 * Path do PDF no bucket. Mesmo padrão de api/processo/documento:
 * '{processo_id}/{nome}-{timestamp}.pdf', prefixo = processo.
 */
export function pathDocumento(
  processoId: string,
  item: string,
  assinado: boolean,
  agora: number = Date.now()
): string {
  const sufixo = assinado ? "-assinado" : "";
  return `${processoId}/${item}${sufixo}-${agora}.pdf`;
}
