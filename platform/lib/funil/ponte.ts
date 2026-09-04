// ============================================================================
// FUNIL-01 · F3.2 — A PONTE, como função pura
// ----------------------------------------------------------------------------
// Decide, para UMA conversa já medida, o que acontece com ela em `captacoes`.
// Não lê banco, não escreve banco, não sabe o que é uma conexão. Recebe fatos
// e devolve uma decisão. Quem mede é o chamador (a F3.3 ao vivo, a F3.4 no
// backfill); quem grava também. Aqui só mora a régua.
//
// POR QUE PURA, e não um `async` que já grava: porque a mesma régua tem de
// rodar duas vezes na vida — uma no ensaio em `begin/rollback` e outra ao vivo
// — e as duas têm de dar o MESMO resultado. Função que fala com o banco não se
// testa: se testa o banco. A F3.4 tem de reproduzir 15/1/2/10 exatos, e isso
// só é verificável se a decisão for um valor de retorno.
//
// ----------------------------------------------------------------------------
// ESTE ARQUIVO É O GÊMEO DE `ident01/RELATORIOS/FUNIL-01_F3_candidatas.sql`
//
// A CTE `classificada` daquele arquivo (em 706ef122) tem DEZ braços numa
// ordem que não é decorativa. Esta função os repete um a um, na mesma ordem,
// com os mesmos textos de motivo. Se você mudar um braço aqui e não lá, a
// lista que o Emerson aprovou deixa de descrever o que o código faz — e o
// ensaio da F3.4 passa a mentir. Mude os dois, ou não mude nenhum.
//
// ONDE A TS TEM BRAÇO QUE O SQL NÃO TEM — DUAS VEZES, E DECLARADO:
//
//   (a) DUAS CANDIDATAS NA MESMA CHAVE. O SQL nunca precisou disso porque na
//       leitura de 03/09 os três duplicados que a chave achou eram todos NÃO
//       candidatos. Ao vivo pode acontecer, e aí duas conversas tentariam
//       inserir a mesma `origem_chave`. A segunda devolve `nada`.
//
//   (b) CAPTAÇÃO JÁ LIGADA A OUTRA CONVERSA. O SQL, vendo `cap_id is not
//       null`, diz `ligar` — porque ele nunca olhou `wa_conversa_id`, que é
//       nulo nas duas linhas reais. Ao vivo, ligar uma captação que já tem
//       dono violaria `captacoes_wa_conversa_viva_key`. Devolve `nada`.
//
// Os dois braços são INERTES no backfill (medido em 03/09: nenhuma candidata
// com posto > 1; `wa_conversa_id` nulo em 2/2), então as contagens 15/1/2/10
// continuam de pé. Eles existem para a F3.3, não para a F3.4.
//
// E NOTE O QUE ELES NÃO SÃO: não são "confiar no índice único". O banco tem
// `captacoes_origem_chave_key` e `captacoes_wa_conversa_viva_key`, ambos
// parciais sobre os status vivos, e eles são a última linha de defesa. Mas
// deixar o índice ser a régua significa descobrir o conflito por exceção, no
// meio de um insert, com metade do lote gravado. A ponte recusa ANTES, com
// motivo escrito, e o índice fica sendo o que deve ser: a prova de que a
// ponte não errou.
//
// ----------------------------------------------------------------------------
// AS TRÊS DECISÕES DE NEGÓCIO QUE ESTÃO GRAVADAS AQUI (03/09/2026)
//
// 1. `consentimento_em` NASCE NULO, SEMPRE.
//    A coluna significa um ato explícito de aceite. No formulário do site ele
//    existe e tem hora. No WhatsApp não existe: a pessoa mandou mensagem, que
//    é procura, não aceite. Gravar ali a hora da primeira mensagem seria
//    escrever ACEITE onde houve PROCURA — dado falso com nome de dado
//    verdadeiro, e o pior tipo, porque um dia alguém vai contar essa coluna
//    achando que conta consentimento. As 15 captações de WhatsApp nascem sem
//    consentimento explícito, e a lista diz isso em voz alta.
//    Fatia candidata: CONSENTIMENTO-ZAP-01.
//    O tipo do campo é o literal `null`, de propósito: quem tentar preencher
//    não passa nem no compilador.
//
// 2. `tipo_bem` NASCE NULO NESTA FATIA.
//    Medido: `tipo_bem` aparece em 0 dos 34 extratos. Inferir do texto é
//    trabalho de outra fatia (TIPO-BEM-MENSAGEM-01), com fixture e isca
//    próprias. Até lá a mesa mostra "tipo não informado" e um humano resolve
//    num clique. Mesmo tratamento de tipo: literal `null`.
//
// 3. `origem_chave` = `whatsapp:<CHAVE DE 10 DÍGITOS>`, e a assimetria com o
//    site é DELIBERADA. Não "corrija" isto para `whatsapp:<telefone>`.
//    O site grava `site:47988117408` — o telefone inteiro, como o formulário
//    mandou. Aqui grava-se a CHAVE (DDD + últimos 8), que é a mesma coisa que
//    o `=` da F3.1 usa para dizer que dois números são a mesma pessoa.
//    A razão: `captacoes_origem_chave_key` é um índice único parcial. Se a
//    chave gravada for o telefone cru, `5511987654321` e `11987654321` e
//    `1187654321` são três chaves diferentes para uma pessoa só, e o banco
//    aceita as três captações. Gravando a chave de comparação, o BANCO passa
//    a segurar o N:1 mesmo que esta função erre. É o único jeito de o índice
//    ser uma trava e não um enfeite.
//    Não escrevi construtor novo para isso: `chaveOrigem` de `lib/captacao.ts`
//    já monta `<origem>:<x>` e aceita 10 dígitos. Passo a CHAVE onde o site
//    passa o TELEFONE. Um construtor, dois chamadores, uma assimetria.
//    COROLÁRIO: o índice é parcial sobre os status VIVOS. `perdida` e
//    `recusada` liberam a chave — a Tamires pode ser recaptada amanhã sem
//    ninguém mexer em índice.
//    E O COROLÁRIO TEM UM LIMITE, escrito em 03/09/2026 quando o gatilho ao
//    vivo obrigou a pensar nisso: liberar a chave é PERMISSÃO DO BANCO PARA O
//    ATO HUMANO de reabrir na mesa (F4). Não é licença para a PONTE reabrir
//    sozinha. As duas frases convivem porque falam de sujeitos diferentes — o
//    banco deixa, a ponte se recusa. Quem faz a recusa é o braço 8b, e o motivo
//    dele é a única memória que a exclusão tem: `inserir` deixa linha, `ligar`
//    deixa `wa_conversa_id`, e `excluir` não deixa nada. Sem o 8b, o gatilho
//    refaria a conta a cada mensagem nova e desfaria a palavra de quem decidiu.
//
// 4. `telefone` GRAVADO COMO VEIO, SEM O 55 E SEM GANHAR O NONO DÍGITO.
//    Medido nas duas linhas reais: `captacoes.telefone` guarda sem o DDI
//    (`47988117408`, `82981131987`). A ponte tira o 55 e para aí. Não
//    acrescenta o 9 que falta em número antigo — isso seria inventar uma
//    QUARTA régua de telefone numa casa que já tem três, e réguas de telefone
//    nesta casa já divergiram em silêncio antes. O que iguala formatos é a
//    CHAVE, na comparação; a coluna guarda o que a pessoa tem.
//    Consequência declarada, que vai para TELEFONE-CANON-01: a partir do
//    backfill, `captacoes.telefone` terá números de 10 e de 11 dígitos lado a
//    lado, e QUALQUER busca por telefone nessa tabela precisa passar pela
//    chave, nunca por igualdade de string.
//
// ----------------------------------------------------------------------------
// O QUE ESTA FUNÇÃO NUNCA DEVOLVE, e é o motivo de metade do teste existir:
// `proposta_valor` e `observacao`. Não estão no tipo `LinhaCaptacao`. Não é
// esquecimento: proposta é preço, e preço é palavra do Emerson, não saída de
// régua. Observação é texto humano. A ponte enche os campos que o extrato
// mede e mais nada. Como os dois campos não existem no tipo, nem um `spread`
// distraído os coloca lá — e o teste confere o conjunto EXATO de chaves.
//
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO MORA EM `lib/funil/` COM UM `lib/funil.ts` AO LADO
//
// Medido em 03/09: nenhum dos 13 subdiretórios de `lib/` tem um `.ts` irmão de
// mesmo nome. Esta é a primeira colisão da casa, e ela é feia. Fica assim
// mesmo agora por um motivo: `lib/funil.ts` (o interruptor) veio de `fcec06b`,
// que já está em `origin/main`. Movê-lo para `lib/funil/interruptor.ts` seria
// mexer em arquivo de outra fatia dentro do PR da F3, contra "um PR por
// fatia". A resolução tem nome e fica esperando: FUNIL-PASTA-01.
// Enquanto isso: `@/lib/funil` resolve para o ARQUIVO (o interruptor) e
// `@/lib/funil/ponte` para a PASTA. Não há ambiguidade, só feiura datada.
// ============================================================================

import { chaveTelefone, ehTelefoneDaCasa, normalizarTelefoneBR } from "../telefone";
import { chaveOrigem, textoCurto } from "../captacao";
import { TAG_CEDENTE } from "../farol/cedente";

// ----------------------------------------------------------------------------
// AS CONSTANTES DA RÉGUA. Todas espelham literais que hoje existem no SQL.
// ----------------------------------------------------------------------------

// A TAG NÃO NASCE AQUI, E ISSO É UM CONSERTO.
// ----------------------------------------------------------------------------
// A primeira versão deste arquivo declarava `export const TAG_CEDENTE =
// "cedente"` de novo. Era a SEGUNDA cópia da mesma palavra na casa, e o
// comentário da primeira (`lib/farol/cedente.ts:40`, de 09/08) diz exatamente
// o que essa cópia quebrava: "Uma constante para não haver 'cedente' digitado
// em dois lugares".
//
// O estrago não seria hoje, seria no dia em que a etiqueta mudar de nome. Quem
// mudasse iria a `lib/farol/cedente.ts`, trocaria lá, veria o detector e o
// painel passarem a usar o nome novo — e a ponte continuaria procurando o
// nome velho, calada, deixando de inserir captação de gente marcada. Um erro
// que não acende luz nenhuma: só um funil que emagrece sem motivo.
//
// Por isso a ponte IMPORTA a constante de quem a escreve — o detector — e
// apenas a REEXPORTA, para que `ponte.test.ts` e os chamadores continuem
// dizendo `from "./ponte"` sem saber de onde ela veio. Uma dona, vários
// leitores.
export { TAG_CEDENTE };

/** Agentes cuja presença já torna a conversa CANDIDATA a ser lida.
 *  `caetano` capta; `tobias` atende os dois lados — por isso ele entra na
 *  lista de candidatas mas NÃO na de inserção automática. */
export const AGENTES_QUE_TORNAM_CANDIDATA: readonly string[] = [
  "caetano",
  "tobias",
];

/** O agente que só capta. Presença dele, sem exclusão, basta para inserir. */
export const AGENTE_DE_CAPTACAO = "caetano";

/** Agentes que atendem QUEM COMPRA. Conversa deles, sem tag de cedente e sem
 *  extrato que se sustente, é comprador — o outro lado do balcão. */
export const AGENTES_DE_COMPRA: readonly string[] = [
  "valentina",
  "serena",
  "bento",
  "aurora",
];

/** Limiar de confiança do extrato. O `>=` é a régua, não o `>`: um extrato
 *  com confiança EXATAMENTE 0.7 passa. Está aqui dentro, e não a cargo do
 *  chamador, porque a fronteira é a parte que se erra — e há teste nela. */
export const CONFIANCA_MINIMA_EXTRATO = 0.7;

/** Origem gravada nas captações que nascem desta ponte. Passa no CHECK
 *  `captacoes_origem_sana` (site|whatsapp|painel|indicacao). */
export const ORIGEM_DA_PONTE = "whatsapp" as const;

/** Status de nascimento. Passa no CHECK `captacoes_status_sano`. */
export const STATUS_DE_NASCIMENTO = "novo" as const;

// ----------------------------------------------------------------------------
// O QUE É UMA CAPTAÇÃO VIVA — E POR QUE A LISTA É DE VIVAS, NÃO DE MORTAS
//
// Não é opinião: é o `WHERE` dos dois índices parciais de `captacoes`, lido do
// banco em 03/09/2026 (`pg_indexes`):
//
//   captacoes_origem_chave_key      WHERE origem_chave IS NOT NULL
//                                     AND status = ANY (ARRAY['novo',
//                                     'em_analise','proposta_enviada','aceita'])
//   captacoes_wa_conversa_viva_key  mesma lista de status
//
// Os seis status sãos são `novo`, `em_analise`, `proposta_enviada`, `aceita`,
// `recusada`, `perdida` (CHECK `captacoes_status_sano`). Os quatro de cima
// OCUPAM a chave; `recusada` e `perdida` a LIBERAM. `aceita` conta como VIVA —
// isso surpreende, porque negócio fechado parece terminal, mas para o banco a
// chave segue ocupada, e quem manda aqui é o banco.
//
// A LISTA É DE VIVAS DE PROPÓSITO. Escrever a lista das mortas faria um status
// novo nascer VIVO por omissão, e o gatilho escreveria em cima de uma captação
// cujo significado ninguém ensinou a ele. Assim, ao contrário: status novo cai
// como encerrado, o gatilho NÃO escreve, e alguém vem consertar. O erro por
// omissão fica do lado de não gravar.
// ----------------------------------------------------------------------------
export const STATUS_VIVOS_DA_CAPTACAO: readonly string[] = [
  "novo",
  "em_analise",
  "proposta_enviada",
  "aceita",
];

/** Uma captação encerrada (`recusada`/`perdida`) LIBEROU a chave no banco — mas
 *  isso é permissão para o ATO HUMANO de reabrir na mesa, nunca licença para a
 *  ponte escrever sozinha. Ver o braço 8b. */
export function captacaoViva(status: string): boolean {
  return STATUS_VIVOS_DA_CAPTACAO.includes(status);
}

// ----------------------------------------------------------------------------
// OS FATOS QUE A PONTE RECEBE
// ----------------------------------------------------------------------------

/** O extrato JÁ ESCOLHIDO para a conversa (o de maior confiança). A ponte
 *  ainda assim confere o limiar: receber um extrato não significa que ele
 *  vale. */
export type ExtratoEscolhido = {
  readonly confianca: number;
  /** `false` exclui a conversa. `null` NÃO exclui — não saber não é saber
   *  que não. Essa distinção é do SQL (`ext_contemplada is false`) e há
   *  teste dos dois lados. */
  readonly contemplada: boolean | null;
  // AS COLUNAS TIPADAS, NÃO O `dados` jsonb. Ver o bloco "DE ONDE VÊM OS
  // NÚMEROS" mais abaixo: `extratos_cotas` grava tudo duas vezes, e medimos
  // que as duas cópias concordam em 34/34. Lê-se a que o banco tipou.
  readonly administradora: string | null;
  readonly valor_credito: number | null;
  readonly saldo_devedor: number | null;
  readonly parcelas_pagas: number | null;
};

/** A captação que já existe para esta chave de telefone, se existir. */
export type CaptacaoExistente = {
  readonly id: string;
  /** Um dos seis de `captacoes_status_sano`. `captacaoViva()` diz se ocupa a
   *  chave; ver o bloco "O QUE É UMA CAPTAÇÃO VIVA". */
  readonly status: string;
  /** Quando a linha mudou pela última vez. Entra no MOTIVO quando a captação
   *  está encerrada, para quem lê a mesa saber de quando é a decisão que está
   *  segurando a conversa. */
  readonly atualizado_em: string | null;
  /** Nulo = ainda não tem conversa dona. Preenchido com OUTRA conversa =
   *  a chave já está viva em outro lugar. */
  readonly wa_conversa_id: string | null;
  readonly nome: string | null;
  readonly administradora: string | null;
  readonly credito: number | null;
  readonly saldo_devedor: number | null;
  readonly parcelas_pagas: number | null;
};

/** Uma decisão tomada por uma PESSOA sobre uma conversa nominal. Não é régua:
 *  é palavra. Vem de fora (o backfill passa o mapa; o gatilho ao vivo passa
 *  vazio) exatamente para que a régua continue geral e a palavra continue
 *  datada e assinada. */
export type DecisaoNominal = {
  readonly classe: Classe;
  readonly motivo: string;
  /** Quem decidiu. No SQL isso é o NOME da CTE; aqui é um campo. */
  readonly quem: string;
};

export type ConversaMedida = {
  readonly id: string;
  readonly nome: string | null;
  readonly telefone: string | null;
  readonly tags: readonly string[];
  readonly agente_ativo: string | null;
  readonly opt_out: boolean;
  /** Quantas mensagens DO CLIENTE bateram na regex de intenção de venda. */
  readonly n_intencao: number;
  readonly extrato: ExtratoEscolhido | null;
  readonly captacao: CaptacaoExistente | null;
  /** Posto no desempate da chave (1 = principal). Só importa quando duas
   *  CANDIDATAS dividem a chave — ver braço (a) do cabeçalho. */
  readonly posto_na_chave: number;
  readonly nominal: DecisaoNominal | null;
};

// ----------------------------------------------------------------------------
// O QUE A PONTE DEVOLVE
// ----------------------------------------------------------------------------

export type Classe =
  | "inserir"
  | "ligar"
  | "revisar"
  | "excluir"
  | "(mesma chave)"
  | "nada";

/** A linha que desce para `captacoes`. Doze campos, nem um a mais.
 *  `tipo_bem` e `consentimento_em` são o literal `null` como TIPO: preencher
 *  não compila. `proposta_valor` e `observacao` não existem aqui. */
export type LinhaCaptacao = {
  readonly nome: string | null;
  readonly telefone: string;
  readonly administradora: string | null;
  readonly credito: number | null;
  readonly saldo_devedor: number | null;
  readonly parcelas_pagas: number | null;
  readonly tipo_bem: null;
  readonly origem: typeof ORIGEM_DA_PONTE;
  readonly status: typeof STATUS_DE_NASCIMENTO;
  readonly wa_conversa_id: string;
  readonly origem_chave: string;
  readonly consentimento_em: null;
};

/** Os campos que a ponte pode preencher numa captação que JÁ EXISTE. Só entra
 *  aqui o que está NULO lá e tem valor aqui — sobrescrever dado humano com
 *  leitura de OCR é o erro caro. */
export type EscritaEmLinhaExistente = {
  readonly wa_conversa_id: string;
  readonly administradora?: string;
  readonly credito?: number;
  readonly saldo_devedor?: number;
  readonly parcelas_pagas?: number;
};

export type Decisao =
  | { readonly classe: "inserir"; readonly motivo: string; readonly linha: LinhaCaptacao }
  | {
      readonly classe: "ligar";
      readonly motivo: string;
      readonly captacao_id: string;
      readonly escrever: EscritaEmLinhaExistente;
    }
  | { readonly classe: "revisar"; readonly motivo: string }
  | { readonly classe: "excluir"; readonly motivo: string }
  | { readonly classe: "(mesma chave)"; readonly motivo: string }
  | { readonly classe: "nada"; readonly motivo: string };

// ----------------------------------------------------------------------------
// AUXILIARES
// ----------------------------------------------------------------------------

/** O telefone como `captacoes` guarda: dígitos, sem o 55, como veio.
 *  Reusa `normalizarTelefoneBR` e corta o DDI — o mesmo corpo que
 *  `chaveTelefone` usa por dentro. Não é régua nova: é a régua existente
 *  parada um passo antes. */
export function telefoneParaCaptacoes(bruto: unknown): string | null {
  const comDdi = normalizarTelefoneBR(bruto);
  if (comDdi === null) return null;
  const semDdi = comDdi.slice(2);
  return semDdi.length >= 10 ? semDdi : null;
}

/** O extrato conta? Só com confiança >= 0.7. Fronteira testada. */
function extratoValido(e: ExtratoEscolhido | null): e is ExtratoEscolhido {
  return e !== null && e.confianca >= CONFIANCA_MINIMA_EXTRATO;
}

// ----------------------------------------------------------------------------
// POR QUE ESTA PONTE NÃO USA `moedaParaNumero` DE `lib/captacao.ts`
//
// Custou dois testes vermelhos para ficar claro, e a lição vale o parágrafo.
//
// `moedaParaNumero` está CORRETA para o que ela serve: a máscara do site faz
// `Number(digitos).toLocaleString("pt-BR")`, que emite só reais inteiros com
// separador de milhar. Ali "150.000" são cento e cinquenta mil, e por isso a
// função tira todo caractere não-dígito de propósito. Está escrito no
// cabeçalho dela.
//
// O extrato tem o contrato EXATAMENTE OPOSTO. Medido em 03/09/2026 sobre os
// 34 extratos, com `jsonb_typeof`:
//
//     valor_credito, saldo_devedor, parcelas_pagas -> `number` ou ausente
//     administradora                                -> `string` ou ausente
//     zero ocorrências de string nos três numéricos
//     valores reais: 164597.39, 131163.29, 679917.8, 93147, 0
//
// Ou seja: número JSON com ponto decimal, que o driver entrega como `number`
// de JavaScript. Passado por `moedaParaNumero`, o braço de `typeof number`
// devolve certo — hoje funciona por sorte de tipo.
//
// ---- DE ONDE VÊM OS NÚMEROS (mudou em 03/09, e o motivo é medido) ---------
//
// `extratos_cotas` guarda os mesmos campos DUAS VEZES: dentro do `dados`
// jsonb E em dez colunas tipadas de primeiro nível. Não é redundância
// acidental — é o mesmo objeto gravado nos dois lugares, no mesmo insert
// (`lib/whatsapp/processar-background.ts:461`).
//
// A primeira versão desta ponte lia o jsonb. Passou a ler as COLUNAS
// TIPADAS, por medição e não por gosto. Nas 34 linhas, comparando coluna
// contra `dados->>'x'` nos seis campos que interessam:
//
//     divergências em valor_credito, saldo_devedor, parcelas_pagas,
//     administradora, contemplada, confianca ......... 0 de 34
//
// Concordam. E concordando, a coluna tipada é estritamente melhor: o banco
// já garantiu o tipo na escrita, enquanto `dados->>'x'` devolve TEXTO que
// alguém teria de converter de novo — e "converter de novo" é exatamente o
// passo onde a bomba de cem vezes mora.
//
// Os tipos das colunas, medidos em `information_schema`:
//
//     valor_credito, saldo_devedor, confianca ....... numeric
//     parcelas_pagas ................................ integer
//     administradora ................................ text
//     contemplada ................................... boolean
//
// E como `numeric` atravessa a serialização JSON (o PostgREST monta a
// resposta DENTRO do Postgres, então `to_jsonb` percorre o mesmo caminho —
// é proxy do caminho HTTP, e fica dito que é proxy):
//
//     numeric  -> number     (22 de 22 linhas com crédito)
//     integer  -> number
//     boolean  -> boolean
//     text     -> string     <- ISCA: a régua SABE dizer "string"
//
// A isca importa: se `administradora` também tivesse voltado "number", a
// medição não valeria nada, porque "number" seria só o que a régua responde
// sempre. Ela discordou onde devia discordar.
//
// OS LEITORES ESTRITOS FICAM, mesmo com o tipo garantido pelo banco. Custam
// nada e são a última linha: se um dia a travessia entregar string, o campo
// vem NULO e aparece na mesa como "crédito não lido" — erro visível e
// barato. O que eles impedem é o outro erro, o de treze milhões calados.
//
// A BOMBA está em amanhã. Se o extrator um dia emitir `"131163.29"` como
// STRING — uma refatoração, um modelo novo, um `JSON.stringify` no meio do
// caminho — `moedaParaNumero` tira o ponto e devolve 13116329. Cento e trinta
// e um mil vira treze milhões, sem exceção, sem log, sem nada. A captação
// nasce com um crédito cem vezes maior e alguém liga oferecendo proposta em
// cima disso.
//
// Uma função servindo dois contratos opostos é como esse erro entra. Então
// aqui mora um leitor ESTRITO: exige `number`, recusa string. Se o formato do
// jsonb mudar, o campo vem nulo e um humano olha — que é o erro barato. O caro
// seria o silêncio de duas casas decimais.
// ----------------------------------------------------------------------------

/** Número vindo de uma coluna `numeric` de `extratos_cotas`. EXIGE `number`;
 *  string devolve `null` de propósito (ver o bloco acima). Negativo e
 *  não-finito também. */
export function numeroDoExtrato(bruto: unknown): number | null {
  if (typeof bruto !== "number") return null;
  if (!Number.isFinite(bruto) || bruto < 0) return null;
  return bruto;
}

// ----------------------------------------------------------------------------
// DUAS CASAS, PORQUE O DESTINO TEM DUAS CASAS
//
// Medido no xtv, `information_schema.columns`:
//   FONTE   extratos_cotas.valor_credito / saldo_devedor -> numeric SEM
//           precisão nem escala: aceita qualquer número de casas decimais.
//   DESTINO captacoes.credito / saldo_devedor            -> numeric(14,2).
//
// A fonte não tem trava e o destino tem. Quem faz a travessia é o float64 do
// JavaScript, que não guarda 0,29 exato — guarda o binário mais próximo. Um
// `131163.29` que voltasse do PostgREST e passasse por qualquer conta viraria
// `131163.29000000001` no corpo do INSERT, e o Postgres arredondaria calado
// para gravar em numeric(14,2). O número gravado não seria o número lido, e
// ninguém veria.
//
// O corpo real de hoje NÃO tem esse problema, e isso foi medido, não suposto:
//   34 linhas, 22 com crédito preenchido
//   crédito com mais de 2 casas ....... 0
//   saldo   com mais de 2 casas ....... 0
//   maior escala vista ................ 2
//   maior crédito ..................... 1.061.000
//   ISCA: scale(1.234) devolveu 3 -- a régua sabe dizer "três casas"
//
// Então a trava é PREVENTIVA, e é barata: a fonte é `numeric` sem precisão,
// nada no banco impede a terceira casa de chegar amanhã de um extrator novo.
//
// ESCALA: até 1,06 milhão com duas casas, `n * 100` fica em 1,06e8 — muito
// abaixo de 2^53. O arredondamento é exato nessa faixa. Se um dia a casa
// vender carta de trilhões, esta conta precisa de outra régua; o teto está
// escrito aqui de propósito para o dia em que alguém procurar.
// ----------------------------------------------------------------------------

/** Reais vindos de `extratos_cotas`, já arredondados às DUAS casas do destino
 *  `numeric(14,2)`. Mesma severidade de `numeroDoExtrato`: exige `number`. O
 *  arredondamento existe para nunca mandar `131163.29000000001` ao banco e
 *  deixar o Postgres cortar calado (ver o bloco acima). */
export function reaisDoExtrato(bruto: unknown): number | null {
  const n = numeroDoExtrato(bruto);
  return n === null ? null : Math.round(n * 100) / 100;
}

/** Inteiro >= 0 vindo do extrato. Mesma severidade: só `number`.
 *  NÃO passa por `reaisDoExtrato` de propósito: arredondar antes faria
 *  `42.001` virar `42` e passar na checagem de inteiro. Aqui, `42.001` é
 *  leitura suja e tem de virar nulo. */
export function inteiroDoExtrato(bruto: unknown): number | null {
  const n = numeroDoExtrato(bruto);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** Os quatro campos que o extrato sabe entregar, lidos das COLUNAS TIPADAS de
 *  `extratos_cotas` (não do `dados` jsonb — ver o bloco acima), já passados
 *  pelos leitores estritos e pelos CHECKs da tabela de destino
 *  (`credito > 0`, `saldo >= 0`, `parcelas >= 0`). */
function camposDoExtrato(e: ExtratoEscolhido | null): {
  administradora: string | null;
  credito: number | null;
  saldo_devedor: number | null;
  parcelas_pagas: number | null;
} {
  if (!extratoValido(e)) {
    return {
      administradora: null,
      credito: null,
      saldo_devedor: null,
      parcelas_pagas: null,
    };
  }
  // Dinheiro sai por `reaisDoExtrato` (duas casas, como o destino); contagem
  // sai por `inteiroDoExtrato` (sem arredondar). Ver o bloco "DUAS CASAS".
  const credito = reaisDoExtrato(e.valor_credito);
  return {
    administradora: textoCurto(e.administradora, 120),
    // `captacoes_credito_positivo` recusa zero. Zero de OCR é leitura falha,
    // não crédito de zero real — vira nulo e um humano olha.
    credito: credito !== null && credito > 0 ? credito : null,
    // Saldo zero, ao contrário, é legítimo: cota quitada. Medido — existe um
    // extrato com `saldo_devedor: 0` no banco.
    saldo_devedor: reaisDoExtrato(e.saldo_devedor),
    parcelas_pagas: inteiroDoExtrato(e.parcelas_pagas),
  };
}

// ----------------------------------------------------------------------------
// A RÉGUA
// ----------------------------------------------------------------------------

/** A conversa é candidata a ser lida? Espelha a CTE `marcada` do SQL. */
export function ehCandidata(c: ConversaMedida): boolean {
  return (
    (c.agente_ativo !== null &&
      AGENTES_QUE_TORNAM_CANDIDATA.includes(c.agente_ativo)) ||
    c.tags.includes(TAG_CEDENTE) ||
    extratoValido(c.extrato) ||
    c.n_intencao > 0 ||
    c.nominal !== null
  );
}

/**
 * A decisão. Dez braços do SQL na mesma ordem, mais os dois declarados no
 * cabeçalho. A ordem É a regra: compliance antes de palavra, palavra antes de
 * régua, régua antes de escrita.
 */
export function decidir(c: ConversaMedida): Decisao {
  const chave = chaveTelefone(c.telefone);
  const temTag = c.tags.includes(TAG_CEDENTE);
  const temExtrato = extratoValido(c.extrato);

  // ---- 1. Não é candidata: só apareceu porque divide a chave com uma. ------
  if (!ehCandidata(c)) {
    return {
      classe: "(mesma chave)",
      motivo:
        "nao e candidata por si; aparece porque divide a chave de telefone com uma candidata - e o duplicado que a chave achou. Nao desce para captacoes",
    };
  }

  // ---- 1b. BRAÇO (a): duas CANDIDATAS na mesma chave. ---------------------
  // Inerte no backfill de 03/09 (nenhuma candidata com posto > 1). Existe
  // para o gatilho ao vivo, onde a segunda conversa da mesma pessoa chega.
  if (chave !== null && c.posto_na_chave > 1) {
    return {
      classe: "nada",
      motivo: `outra conversa da mesma chave de telefone ja e a principal (esta esta no posto ${c.posto_na_chave}): uma pessoa, uma captacao. Nao insere segunda e nao liga por cima`,
    };
  }

  // ---- 2. Compliance. Vence régua E vence palavra: vem ANTES do nominal. ---
  if (c.opt_out) {
    return {
      classe: "excluir",
      motivo:
        "PEDIU PARA NAO RECEBER (opt_out): uma captacao viraria card com proxima acao e alguem ligaria. Compliance vence regra e vence palavra",
    };
  }

  // ---- 3. Palavra de gente. Vence a régua, e o motivo é o dela. -----------
  if (c.nominal !== null) {
    const n = c.nominal;
    if (n.classe === "inserir" || n.classe === "ligar") {
      // Palavra que MANDA ESCREVER não passa por aqui sem a régua montar a
      // linha. Enquanto nenhuma decisão nominal pede escrita, isto é uma
      // parede, não um caminho: melhor recusar do que gravar uma linha que
      // ninguém montou.
      return {
        classe: "revisar",
        motivo: `decisao nominal de ${n.quem} pede "${n.classe}", que exige montar linha: a ponte nao escreve por palavra, so por regua. Precisa de olho humano. Motivo original: ${n.motivo}`,
      };
    }
    return { classe: n.classe, motivo: n.motivo };
  }

  // ---- 4. A nossa própria linha. ------------------------------------------
  if (ehTelefoneDaCasa(c.telefone)) {
    return {
      classe: "excluir",
      motivo:
        "telefone da casa: e a nossa propria linha conversando, nao um cedente",
    };
  }

  // ---- 5. Cota não contemplada. `null` NÃO exclui. ------------------------
  if (temExtrato && c.extrato!.contemplada === false) {
    return {
      classe: "excluir",
      motivo:
        "o extrato escolhido diz que a cota NAO esta contemplada - nao e captacao; candidata a um funil proprio",
    };
  }

  // ---- 6. Agente do outro lado do balcão. ---------------------------------
  if (
    c.agente_ativo !== null &&
    AGENTES_DE_COMPRA.includes(c.agente_ativo) &&
    !temTag &&
    !temExtrato
  ) {
    return {
      classe: "excluir",
      motivo:
        "agente de compra, sem tag de cedente e sem extrato valido: e comprador, nao vendedor",
    };
  }

  // ---- 7. Sem telefone brasileiro utilizável. -----------------------------
  if (chave === null) {
    return {
      classe: "revisar",
      motivo:
        "nao tem telefone brasileiro utilizavel (identificador de rede social ou numero estrangeiro): nao da para ligar nem inserir",
    };
  }

  // ---- 8. Já existe captação nesta chave. ---------------------------------
  if (c.captacao !== null) {
    const cap = c.captacao;

    // BRAÇO (b), parte 1: idempotência. Rodar de novo não faz nada de novo.
    if (cap.wa_conversa_id === c.id) {
      return {
        classe: "nada",
        motivo: `a captacao ${cap.id} ja esta ligada a esta conversa: nada a fazer. A ponte pode rodar de novo sem mudar linha`,
      };
    }

    // BRAÇO 8b: A CAPTAÇÃO ESTÁ ENCERRADA — E ISSO É A MEMÓRIA DA EXCLUSÃO.
    //
    // O problema que este braço resolve: `inserir` deixa linha, `ligar` deixa
    // `wa_conversa_id`, mas `excluir` NÃO DEIXA NADA. Depois do backfill, nada
    // no banco distingue "foi avaliada e a resposta foi não" de "nunca foi
    // olhada" — e o gatilho ao vivo, que reclassifica a cada mensagem, refaria
    // a conta do zero e desfaria a palavra de quem decidiu.
    //
    // A MEMÓRIA NÃO É UMA LISTA DE PESSOAS, É A PRÓPRIA CAPTAÇÃO ENCERRADA.
    // Decisão da coordenação, 03/09/2026: as palavras do Emerson descrevem um
    // ESTADO ("não teve negócio", "cota cancelada"), não uma pessoa banida. Uma
    // lista de excluídos erraria exatamente no dia em que a pessoa voltasse
    // querendo vender de verdade. Então não há lista, não há tabela nova, não
    // há exceção: há este braço, que é régua.
    //
    // E ELE NÃO CONTRADIZ A F3.2. Lá ficou escrito que `perdida` LIBERA a
    // chave, e continua verdade — é permissão do BANCO para o ATO HUMANO de
    // reabrir na mesa (F4). Não é licença para a ponte reabrir sozinha. As duas
    // frases convivem porque falam de sujeitos diferentes.
    //
    // INERTE NO BACKFILL, e isso foi medido antes de escrever: as duas
    // captações de 03/09 estão ambas em `novo`, nenhuma encerrada. A contagem
    // aprovada 15/1/2/10 não muda por causa deste braço.
    if (!captacaoViva(cap.status)) {
      const quando = cap.atualizado_em ?? "(sem data)";
      return {
        classe: "nada",
        motivo: `a chave ja teve captacao (${cap.id}) e ela esta ENCERRADA em "${cap.status}" desde ${quando}: reabrir e decisao da mesa, nao da ponte. A exclusao tem memoria justamente para o gatilho nao desfazer a palavra de quem decidiu`,
      };
    }

    // BRAÇO (b), parte 2: a chave está viva em outra conversa.
    if (cap.wa_conversa_id !== null) {
      return {
        classe: "nada",
        motivo: `a captacao ${cap.id} ja esta ligada a OUTRA conversa (${cap.wa_conversa_id}): ligar aqui violaria captacoes_wa_conversa_viva_key. Recuso antes do banco recusar, com motivo`,
      };
    }

    const campos = camposDoExtrato(c.extrato);
    const escrever: {
      wa_conversa_id: string;
      administradora?: string;
      credito?: number;
      saldo_devedor?: number;
      parcelas_pagas?: number;
    } = { wa_conversa_id: c.id };

    // SÓ o que está nulo lá e tem valor aqui. Um campo já preenchido é dado
    // que alguém pôs; leitura de OCR não passa por cima dele.
    if (cap.administradora === null && campos.administradora !== null) {
      escrever.administradora = campos.administradora;
    }
    if (cap.credito === null && campos.credito !== null) {
      escrever.credito = campos.credito;
    }
    if (cap.saldo_devedor === null && campos.saldo_devedor !== null) {
      escrever.saldo_devedor = campos.saldo_devedor;
    }
    if (cap.parcelas_pagas === null && campos.parcelas_pagas !== null) {
      escrever.parcelas_pagas = campos.parcelas_pagas;
    }

    return {
      classe: "ligar",
      motivo:
        "ja existe captacao com a mesma chave de telefone: a ponte LIGA a conversa a linha que ja existe, nunca cria uma segunda",
      captacao_id: cap.id,
      escrever,
    };
  }

  // ---- 9. Inserir. --------------------------------------------------------
  if (c.agente_ativo === AGENTE_DE_CAPTACAO || temTag || temExtrato) {
    const telefone = telefoneParaCaptacoes(c.telefone);
    const origem_chave = chaveOrigem(ORIGEM_DA_PONTE, chave);
    if (telefone === null || origem_chave === null) {
      // Cinto e suspensório: a chave existe (braço 7 garantiu), então isto
      // não deveria acontecer. Se acontecer, é a régua que quebrou, e o que
      // se faz com régua quebrada é parar, não gravar.
      return {
        classe: "revisar",
        motivo:
          "a chave de telefone existe mas o telefone ou a origem_chave nao se montaram: regua inconsistente, nao gravo. Isto e defeito, nao caso de negocio",
      };
    }

    const campos = camposDoExtrato(c.extrato);
    const motivo =
      c.agente_ativo === AGENTE_DE_CAPTACAO
        ? "agente de captacao, e nenhuma exclusao se aplica"
        : temTag
          ? "marcada como cedente por quem atendeu, e nenhuma exclusao se aplica"
          : "mandou extrato de cota que se sustenta (confianca alta), e nenhuma exclusao se aplica";

    return {
      classe: "inserir",
      motivo,
      linha: {
        nome: c.nome,
        telefone,
        administradora: campos.administradora,
        credito: campos.credito,
        saldo_devedor: campos.saldo_devedor,
        parcelas_pagas: campos.parcelas_pagas,
        tipo_bem: null, // TIPO-BEM-MENSAGEM-01
        origem: ORIGEM_DA_PONTE,
        status: STATUS_DE_NASCIMENTO,
        wa_conversa_id: c.id,
        origem_chave, // whatsapp:<chave de 10 digitos> — assimetria deliberada
        consentimento_em: null, // CONSENTIMENTO-ZAP-01
      },
    };
  }

  // ---- 10. A régua não decide. -------------------------------------------
  return {
    classe: "revisar",
    motivo:
      "a regua nao decide: agente que atende os dois lados, ou suspeita levantada so pelo texto, sem tag e sem extrato. Precisa de olho humano",
  };
}

/** As doze chaves que `LinhaCaptacao` tem, em ordem alfabética. Exportada
 *  para o teste poder cobrar o conjunto EXATO — e para a F3.4 poder montar o
 *  `insert` sem inventar coluna. Se alguém acrescentar campo ao tipo e não
 *  aqui, o teste quebra. */
export const COLUNAS_DA_LINHA: readonly string[] = [
  "administradora",
  "consentimento_em",
  "credito",
  "nome",
  "origem",
  "origem_chave",
  "parcelas_pagas",
  "saldo_devedor",
  "status",
  "telefone",
  "tipo_bem",
  "wa_conversa_id",
];

/** Colunas que a ponte NUNCA pode tocar, em linha nova ou existente. A F3.4
 *  usa esta lista como assertiva antes de gravar. */
export const COLUNAS_PROIBIDAS: readonly string[] = [
  "proposta_valor",
  "proposta_em",
  "observacao",
  "fechado_em",
  "fechado_valor",
  "dono",
  "proxima_acao",
  "ultimo_contato_em",
];
