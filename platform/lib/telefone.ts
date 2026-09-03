// Normalização de telefone BR — extraído de
// platform/app/api/whatsapp/disparo/route.ts (DISPARO-01) pra ser
// reaproveitado pela FATIA 1 (venda nova Disal), sem mudar comportamento.
// Aceita telefone com ou sem DDI 55, extrai só dígitos. Formato final igual
// ao que o Meta manda no webhook (DDI+DDD+número, sem "+") — E.164 sem o
// prefixo "+", mesmo padrão já usado em wa_conversas.telefone.
export function normalizarTelefoneBR(raw: unknown): string | null {
  const digitos = String(raw ?? "").replace(/\D/g, "");
  if (digitos.length === 12 || digitos.length === 13) {
    return digitos.startsWith("55") ? digitos : null;
  }
  if (digitos.length === 10 || digitos.length === 11) {
    return "55" + digitos;
  }
  return null;
}

// ---------------------------------------------------------------------------
// chaveTelefone — a chave de COMPARAÇÃO. NÃO é uma segunda forma de guardar.
// ---------------------------------------------------------------------------
// POR QUE ELA EXISTE. A casa tem duas réguas de telefone e elas discordam na
// FORMA da saída: `normalizarTelefoneBR` (acima) ACRESCENTA o 55; a gêmea no
// banco, `sentinela_telefone_norm` (0083_sentinela_dedup_telefone.sql:107),
// CORTA o 55. Comparar o resultado de uma com o da outra é comparar réguas,
// não corpos.
//
// E nenhuma das duas resolve o caso que motivou a F3. Medido em 02/09/2026, o
// mesmo cedente aparece nas duas pontas assim:
//   captação  82981131987   (com o nono dígito)
//   conversa 558281131987   (sem o nono dígito)
// O que separa as duas linhas não é o DDI: é o NONO DÍGITO. Pôr ou tirar o 55
// não faz uma virar a outra por caminho nenhum.
//
// A CHAVE:  DDD (2 dígitos) || últimos 8 dígitos.
// Os últimos 8 são a parte que SOBREVIVE à migração do nono dígito, que
// acrescentou um algarismo na frente e preservou a cauda. Cortar por 9
// manteria o problema de pé.
//
// NUNCA PERSISTIDA. Só serve para `=`. As colunas `captacoes.telefone` e
// `wa_conversas.telefone` continuam exatamente nos formatos que já têm.
//
// O GÊMEO EM SQL é `telefone_chave(text)`, hoje em
// `ident01/FUNIL-01_F3_telefone_chave_NAO_APLICAR.sql`, composto sobre
// `sentinela_telefone_norm` pela mesma razão que este é composto sobre
// `normalizarTelefoneBR`: reimplementar o corte do 55 seria criar a terceira
// régua que estes dois arquivos existem para evitar. `telefone.test.ts` prova
// os dois lados com as mesmas fixtures.
//
// RISCO RESIDUAL, DECLARADO E NÃO ESCONDIDO. Dois números do mesmo DDD que
// difiram SÓ no nono dígito colapsam na mesma chave. Na numeração brasileira
// isso é o mesmo número antes e depois da migração do 9, e não dois
// assinantes: fixo começa em 2–5 e celular em 6–9, então fixo e celular não
// colidem na cauda. Ainda assim, a lista de candidatas da F3.1 mostra os DOIS
// telefones brutos ao lado da chave, para que quem confere veja a colisão se
// ela existir.
export function chaveTelefone(raw: unknown): string | null {
  const comDdi = normalizarTelefoneBR(raw);
  if (comDdi === null) return null;

  // `normalizarTelefoneBR` só devolve 12 ou 13 dígitos começando em 55, então
  // aqui sobram sempre 10 ou 11. A guarda não é decorativa: ela é o espelho
  // literal da guarda do lado SQL, onde `sentinela_telefone_norm` PODE
  // devolver 12 dígitos (número de Portugal, prefixo 351, que ela não corta).
  // Se um dia a régua acima mudar, esta guarda é o que impede a chave de
  // nascer de um número que não tem DDD nenhum.
  const semDdi = comDdi.slice(2);
  if (semDdi.length !== 10 && semDdi.length !== 11) return null;

  return semDdi.slice(0, 2) + semDdi.slice(-8);
}

// ---------------------------------------------------------------------------
// TELEFONES_DA_CASA — os números que são NOSSOS, não de cedente.
// ---------------------------------------------------------------------------
// Lista provisória, com conteúdo dado pelo Emerson em 02/09/2026: são estes
// dois e só estes dois. Confirmado por medição das 104 linhas de
// `wa_conversas` no xtv — nenhum outro número da casa aparece lá.
//
// POR QUE ELA NASCE AQUI E POR QUE É PROVISÓRIA. Hoje a casa já exclui um
// número em três lugares, e nenhum dos três é reaproveitável:
//   `app/api/sentinela/varredura/route.ts:99`  const NUMERO_EXCLUIDO  (privado)
//   `app/api/whatsapp/disparo/route.ts:37`     const NUMERO_EXCLUIDO  (privado)
//   `lib/vitrine.ts:264`                       WA_PROSPERITO (exportado, mas
//                                              com OUTRO sentido: é a linha
//                                              viva da WABA, não uma exclusão)
// Os três guardam só o 5511973202967. O 5519997561909 — o número do próprio
// Emerson, que conversa com a Sentinela e viraria captação sem esta lista —
// não está excluído em lugar nenhum executável.
//
// O DESTINO é `TELEFONES-CASA-01`: uma tabela no xtv, na doutrina do
// `funil_operadores` (RLS on, zero policies, leitura por service_role), lida
// pelo SQL e por este arquivo, para que os três lugares acima convirjam nela.
// Enquanto essa fatia não roda, esta constante é a única cópia com nome.
//
// COMPARE POR CHAVE, NUNCA POR `===`. O número da casa já trocou uma vez
// (5519 → 5511, entre 14/07 e 03/08, por bloqueio do WhatsApp Business —
// documentado em `lib/vitrine.ts:251`), e `===` não perdoa uma formatação
// diferente da mesma linha.
export const TELEFONES_DA_CASA: readonly string[] = [
  "5519997561909",
  "5511973202967",
];

const CHAVES_DA_CASA: ReadonlySet<string> = new Set(
  TELEFONES_DA_CASA.map((t) => chaveTelefone(t)).filter(
    (c): c is string => c !== null
  )
);

// Um telefone sem chave (nulo, lixo, estrangeiro) NÃO é da casa: na dúvida a
// linha segue para conferência humana, que é o erro barato. O caro seria
// engolir uma conversa de cedente por causa de um dígito a mais.
export function ehTelefoneDaCasa(raw: unknown): boolean {
  const chave = chaveTelefone(raw);
  return chave !== null && CHAVES_DA_CASA.has(chave);
}
