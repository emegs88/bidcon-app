// ============================================================================
// BIDCON-ASSINATURA-01 — comparação de segredo do webhook.
// ----------------------------------------------------------------------------
// O webhook do provedor é um endpoint público: qualquer um na internet pode
// fazer POST nele. A única coisa que separa o provedor de um atacante é o
// segredo combinado, que chega no header `x-webhook-signature`.
//
// POR QUE timingSafeEqual E NÃO `===`:
// comparação de string em JS sai no primeiro byte diferente. Isso vaza, pelo
// TEMPO da resposta, quantos bytes iniciais o atacante acertou — dá para
// descobrir o segredo byte a byte com requisições suficientes. timingSafeEqual
// compara o buffer inteiro sempre, em tempo constante.
//
// POR QUE sha256 ANTES DE COMPARAR:
// timingSafeEqual JOGA (RangeError) se os buffers tiverem tamanhos diferentes.
// Tratar esse throw como "não confere" reintroduz o vazamento — o tamanho do
// segredo escaparia pelo caminho de erro. Passando os dois por sha256 primeiro,
// os buffers têm SEMPRE 32 bytes, a função nunca joga por tamanho, e o
// comprimento do segredo real não influencia nada.
//
// Escopo: só decide "confere ou não". Não lê env, não fala HTTP, não loga.
// Sem I/O = testável de verdade (ver eventos.test.ts).
// ============================================================================
import { createHash, timingSafeEqual } from "node:crypto";

function digest(valor: string): Buffer {
  return createHash("sha256").update(valor, "utf8").digest();
}

/**
 * true só se `recebido` for exatamente igual a `esperado`.
 *
 * Segredo vazio (env não configurada) é SEMPRE false: sem isso, um deploy que
 * esqueceu ZAPSIGN_WEBHOOK_SECRET aceitaria um POST com header vazio e deixaria
 * qualquer um marcar contratos como assinados. Falha fechada, nunca aberta.
 */
export function segredoConfere(
  recebido: string | null | undefined,
  esperado: string | null | undefined
): boolean {
  if (!recebido || !esperado) return false;
  return timingSafeEqual(digest(recebido), digest(esperado));
}
