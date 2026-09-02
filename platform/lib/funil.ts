// ============================================================================
// FUNIL-01 — interruptor da mesa
// ----------------------------------------------------------------------------
// O quinto kill-switch da casa, e o primeiro que nasce JUNTO com a fatia que
// governa, em vez de ser descoberto depois no código. Os quatro anteriores
// (FIDC_OFERTAS, RADAR, FAROL_ARTE_GERAR, PROSPERITO_SEM_ENTRADA) existiram um
// tempo só em código, e o `.env.example` ganhou o bloco deles exatamente para
// corrigir isso: switch que não está escrito é switch que ninguém sabe que
// existe para desarmar. Este já entra escrito.
//
// SEMÂNTICA, que é a mesma das outras quatro e é cobrada em teste:
// nasce DESARMADO e só a palavra exata `on` arma. Ausente, vazia, a palavra
// verdadeiro em inglês, o algarismo 1, a mesma palavra em caixa alta — tudo
// desarma. A igualdade é estrita de propósito.
//
// A tentação aqui é escrever "arma a menos que esteja desligado", isto é, ler
// a env por diferença de `off`. Parece equivalente e não é: nessa forma um
// erro de digitação no painel da Vercel (`FUNIL=of`, `FUNIL=0ff`, ou a
// variável apagada por engano num redeploy) ARMA a fatia sozinha. O sentido do
// interruptor é que o silêncio signifique desligado, nunca ligado — e por isso
// o teste desta lib cobra o desarmado em seis estados diferentes e o armado em
// exatamente um.
//
// O QUE ESTE INTERRUPTOR NÃO É. Desarmado, ele não mata rota nem esconde
// migration: a 0093 cria colunas, view e tabela que continuam existindo e
// continuam auditáveis. O que ele governa é a mesa aparecer e operar. É a
// mesma leitura que o cabeçalho da rota do Radar já deixou escrita: kill-switch
// desarmado não significa rota morta.
// ============================================================================

/** Kill-switch. Nasce desarmado: sem `FUNIL=on`, a mesa não opera. */
export const ENV_KILL_SWITCH = "FUNIL";

export function funilLigado(): boolean {
  return process.env[ENV_KILL_SWITCH] === "on";
}
