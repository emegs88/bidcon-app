// ============================================================================
// FUNIL-01 — O GATILHO: onde a ponte encosta no mundo
// ----------------------------------------------------------------------------
// `ponte.ts` é pura: recebe uma `ConversaMedida` e devolve uma `Decisao`. Ela
// não sabe o que é um banco. Este arquivo é o único lugar da fatia que sabe —
// ele MEDE a conversa no xtv, entrega a medição à ponte, e APLICA o que a ponte
// decidiu. Um arquivo por responsabilidade: quem decide não lê banco, quem lê
// banco não decide.
//
// PRIMEIRA PROVA DO CAMINHO HTTP = PRIMEIRA CONVERSA REAL DEPOIS DE FUNIL=on;
// FALHA APARECE COMO CRÉDITO NÃO LIDO.
//
// Essa frase é ordem da coordenação e merece o parágrafo que a explica. Toda a
// medição de tipos que sustenta a F3.2 (numeric -> number, integer -> number,
// text -> string) foi feita por PROXY DECLARADO: `jsonb_typeof(to_jsonb(col))`
// rodado dentro do Postgres, que é o mesmo caminho que o PostgREST percorre
// para montar a resposta. É proxy honesto, mas é proxy. O caminho HTTP de
// verdade — supabase-js falando com o PostgREST — não vai ser medido antes do
// deploy: não há `.env.local` nesta worktree, o ensaio da F3.4 vai por SQL, e
// este gatilho só roda ao vivo com `FUNIL=on`. Então a primeira prova real é a
// primeira conversa depois de ligar.
//
// E o modo de falha é o barato, POR CONSTRUÇÃO, não por sorte: se a travessia
// entregar `"131163.29"` como string em vez de número, os leitores estritos de
// `ponte.ts` recusam e o campo vira NULO. A mesa mostra "crédito não lido", um
// humano olha. O que NÃO acontece é o número errado calado — que é o erro de
// cem vezes que a F3.2 desarmou. Erro visível é aceitável; erro silencioso não.
//
// ---- A DOUTRINA DA FALHA: LOG, NUNCA EXCEÇÃO -------------------------------
//
// Este gatilho é chamado de dentro do webhook do WhatsApp. A doutrina já está
// escrita em `app/api/whatsapp/route.ts` (cabeçalho e o laço das etiquetas):
// perder uma etiqueta é aceitável, perder a resposta ao cliente porque a
// etiquetagem falhou não é. Um funil é a mesma coisa, com mais motivo ainda:
// nenhuma captação vale derrubar o atendimento de quem está falando com a gente
// agora. Então NADA aqui lança. Tudo que pode falhar vira `console.error` e o
// chamador segue. `rodarPonteNaConversa` devolve o que aconteceu para quem
// quiser olhar (e para o teste poder cobrar), mas nunca por exceção.
//
// ---- ONDE ELE É CHAMADO ----------------------------------------------------
//
// Dois pontos, uma função. Os dois momentos em que a casa aprende algo novo
// sobre uma conversa:
//   1. `app/api/whatsapp/route.ts`, depois do laço que grava as etiquetas —
//      é quando `cedente` acabou de nascer.
//   2. `lib/whatsapp/processar-background.ts`, depois do insert em
//      `extratos_cotas` — é quando o extrato acabou de nascer.
// Uma função só, chamada dos dois lados, porque duas funções seriam duas
// réguas divergindo em silêncio — foi assim que `TAG_CEDENTE` ganhou uma
// segunda cópia e custou uma fatia inteira para desfazer.
//
// O `db` VEM DE FORA, nunca é criado aqui. É a forma que
// `processar-background.ts` já usa (`db: ReturnType<typeof createXtvClient>`):
// service_role, uma conexão por requisição, passada adiante. Criar um cliente
// próprio aqui dobraria a conexão e esconderia de quem lê a rota que este
// código escreve no banco.
// ============================================================================

import { createXtvClient } from "@/lib/supabase-xtv";
// `@/lib/funil` e não `../funil`: de dentro de `lib/funil/`, o caminho relativo
// `../funil` é ambíguo a olho humano — existe o ARQUIVO `lib/funil.ts` e a
// PASTA `lib/funil/`. O TypeScript resolve para o arquivo, mas quem lê hesita.
// A colisão está registrada como FUNIL-PASTA-01 e se resolve em fatia própria;
// até lá, o caminho explícito é o que não mente.
import { funilLigado } from "@/lib/funil";
import { chaveTelefone } from "@/lib/telefone";
import {
  CONFIANCA_MINIMA_EXTRATO,
  TAG_CEDENTE,
  captacaoViva,
  decidir,
  ehCandidata,
  type CaptacaoExistente,
  type ConversaMedida,
  type Decisao,
  type ExtratoEscolhido,
} from "./ponte";

type ClienteXtv = ReturnType<typeof createXtvClient>;

/** Teto de linhas que o gatilho traz para peneirar em TypeScript. Ver o bloco
 *  "A CHAVE NÃO CABE NUM FILTRO" abaixo. Hoje a casa tem 104 conversas e 2
 *  captações; o teto existe para AVISAR quando deixar de ser adequado, não
 *  para esconder o problema. Bater no teto vira log. */
const TETO_DE_VARREDURA = 2000;

// ----------------------------------------------------------------------------
// A CHAVE NÃO CABE NUM FILTRO, ENTÃO O BANCO ENTREGA O CORPO E O TS PENEIRA
//
// A chave de comparação é `DDD (2 dígitos) || últimos 8 dígitos`, derivada e
// nunca persistida. No SQL do relatório ela é montada com
// `sentinela_telefone_norm()`; pelo PostgREST não existe forma de pedir "onde a
// chave derivada é igual a X" sem inventar uma função nova no banco — e a
// coordenação decidiu esta fatia SEM migration.
//
// Então a divisão de trabalho fica declarada: o BANCO entrega o corpo, o
// TypeScript aplica a RÉGUA EXATA (`chaveTelefone`, a mesma que `decidir()`
// usa). Não é um filtro grosseiro no SQL mais um exato no TS — isso seriam duas
// réguas, e a grosseira poderia derrubar antes uma linha que a exata aceitaria.
// É régua NENHUMA no SQL e uma só no TS.
//
// O preço é trazer linhas demais. Com 104 conversas isso é nada. Quando não for
// mais, o log do teto avisa, e a resposta certa será uma função no banco (uma
// régua, do lado do banco) — não um filtro traduzido aqui.
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// O QUE O GATILHO NÃO CARREGA — E A PROVA DE QUE ISSO NUNCA GRAVA ERRADO
//
// 1. `nominal` é SEMPRE null aqui.
//    As oito decisões nominais (cinco do Emerson, três da coordenação) vivem
//    dentro do SQL do relatório, e são o julgamento de OITO CONVERSAS EM
//    03/09/2026 — não uma regra. Trazê-las para o gatilho seria embutir uma
//    lista de pessoas no código que roda todo dia, que é exatamente a segunda
//    `TAG_CEDENTE` esperando para nascer. A coordenação decidiu em 03/09:
//    ESTADO, NÃO PESSOA. A memória das exclusões é a captação encerrada, e quem
//    a lê é o braço 8b da ponte.
//
// 2. `n_intencao` é SEMPRE 0 aqui.
//    A terceira régua do relatório — a ruidosa, duas listas de palavras casadas
//    por regex sobre o texto do cliente — mora no SQL. Traduzi-la para TypeScript
//    criaria uma SEGUNDA CÓPIA de uma régua difícil, e cópia traduzida diverge
//    em silêncio.
//
//    E ela pode sair porque não muda NENHUMA ESCRITA. A prova está na ordem dos
//    braços de `decidir()`:
//      - Intenção só entra em `ehCandidata`. Uma conversa candidata SÓ por
//        intenção (sem tag, sem extrato, sem agente) não bate em nenhum braço
//        que escreve: cai no braço 10, `revisar`, que não grava.
//      - Sem `n_intencao`, essa mesma conversa deixa de ser candidata e cai no
//        braço 1, `(mesma chave)`, que também não grava.
//      - Os dois caminhos escrevem NADA. Muda o rótulo do log, não o banco.
//
//    O ÚNICO caso em que difere de verdade: conversa candidata só por intenção
//    COM captação existente na chave. O SQL a ligaria; o gatilho não liga. Ou
//    seja, a omissão erra sempre para o lado de NÃO ESCREVER, e o erro aparece
//    na mesa como conversa sem card — o humano liga em um clique na F4. O
//    contrário (ligar por causa de um regex sobre texto solto) seria o erro
//    caro. A direção do erro é escolhida, não sorteada.
//
//    O BACKFILL CONTINUA COM A RÉGUA COMPLETA: ele roda o SQL aprovado, com
//    intenção e com os nominais. As contagens 15/1/2/10 são dele, e não mudam.
// ----------------------------------------------------------------------------

export type ResultadoDoGatilho =
  | { readonly feito: "desligado" }
  | { readonly feito: "sem_conversa"; readonly conversaId: string }
  | {
      readonly feito: "decidido";
      readonly decisao: Decisao;
      /** Verdadeiro só quando uma linha foi criada ou alterada de fato. */
      readonly escreveu: boolean;
    }
  | { readonly feito: "falhou"; readonly onde: string };

// ----------------------------------------------------------------------------
// A MEDIÇÃO
// ----------------------------------------------------------------------------

/** As linhas de `wa_conversas` que a medição precisa. Nomes iguais aos das
 *  colunas de propósito: quem confere o `select` confere o tipo junto. */
type LinhaConversa = {
  id: string;
  nome: string | null;
  telefone: string | null;
  tags: string[] | null;
  agente_ativo: string | null;
  opt_out: boolean | null;
  criado_em: string | null;
};

const COLUNAS_CONVERSA = "id,nome,telefone,tags,agente_ativo,opt_out,criado_em";

/** As colunas TIPADAS de `extratos_cotas` — não o `dados` jsonb. O motivo está
 *  no bloco grande de `ponte.ts`: as duas cópias concordam em 34/34, e a coluna
 *  é melhor porque o banco já garantiu o tipo na escrita. Aqui fica a nota de
 *  que isto DIVERGE do SQL do relatório, que lê `dados` — divergência
 *  declarada, não acidente: o relatório é a régua velha, congelada no dia em
 *  que o Emerson leu a lista; a ponte é a nova. */
const COLUNAS_EXTRATO =
  "conversa_id,confianca,contemplada,administradora,valor_credito,saldo_devedor,parcelas_pagas";

const COLUNAS_CAPTACAO =
  "id,status,atualizado_em,wa_conversa_id,nome,telefone,administradora,credito,saldo_devedor,parcelas_pagas";

/**
 * Monta a `ConversaMedida` de uma conversa. Devolve `null` quando a conversa
 * não existe ou quando alguma leitura falhou — e nos dois casos já registrou o
 * porquê. Nunca lança.
 */
export async function medirConversa(
  db: ClienteXtv,
  conversaId: string
): Promise<ConversaMedida | null> {
  const { data: conv, error: errConv } = await db
    .from("wa_conversas")
    .select(COLUNAS_CONVERSA)
    .eq("id", conversaId)
    .maybeSingle();

  if (errConv) {
    console.error("[funil/gatilho] conversa não lida:", {
      conversaId,
      erro: errConv.message,
    });
    return null;
  }
  if (!conv) return null;

  const c = conv as unknown as LinhaConversa;
  const chave = chaveTelefone(c.telefone);

  const extrato = await extratoEscolhido(db, conversaId);
  const captacao = chave === null ? null : await captacaoDaChave(db, chave);
  const posto = chave === null ? 1 : await postoNaChave(db, chave, c);

  return {
    id: c.id,
    nome: c.nome,
    telefone: c.telefone,
    tags: c.tags ?? [],
    agente_ativo: c.agente_ativo,
    opt_out: c.opt_out === true,
    n_intencao: 0, // ver "O QUE O GATILHO NÃO CARREGA"
    extrato,
    captacao,
    posto_na_chave: posto,
    nominal: null, // ver "O QUE O GATILHO NÃO CARREGA"
  };
}

/** O extrato que vale: confiança >= 0.7, o de maior confiança, desempate pelo
 *  `id` — a mesma ordem da CTE `ext_valido` do SQL aprovado. */
async function extratoEscolhido(
  db: ClienteXtv,
  conversaId: string
): Promise<ExtratoEscolhido | null> {
  const { data, error } = await db
    .from("extratos_cotas")
    .select(COLUNAS_EXTRATO)
    .eq("conversa_id", conversaId)
    .gte("confianca", CONFIANCA_MINIMA_EXTRATO)
    .order("confianca", { ascending: false })
    .order("id", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[funil/gatilho] extrato não lido:", {
      conversaId,
      erro: error.message,
    });
    return null; // sem extrato a ponte ainda decide; ela só perde um sinal
  }
  const linha = data?.[0];
  if (!linha) return null;

  // Sem conversão nenhuma aqui de propósito. Os leitores estritos de `ponte.ts`
  // é que decidem o que é número; se este ponto "ajudasse" convertendo, a
  // travessia deixaria de ser observável e a bomba de cem vezes voltaria a
  // caber no caminho.
  return linha as unknown as ExtratoEscolhido;
}

// ----------------------------------------------------------------------------
// A ESCOLHA DA CAPTAÇÃO, QUANDO A CHAVE TEM MAIS DE UMA
//
// `ConversaMedida.captacao` é UMA. E a chave pode ter várias: os dois índices
// únicos parciais de `captacoes` só impedem uma segunda captação VIVA — nada
// impede N encerradas. Medido em 04/09/2026: hoje são 2 captações em 2 chaves
// distintas, ZERO chaves com mais de uma. O problema é latente, não vivo.
//
// (E ele também mora no SQL do relatório: aquele `left join cap on cp.chave =
// c.chave` DUPLICARIA a linha se uma chave tivesse duas captações, mexendo nas
// contagens. Está registrado para a F3.4 tratar. Não muda o 15/1/2/10 de hoje
// porque hoje não há chave repetida — foi medido, não suposto.)
//
// A ESCOLHA: a VIVA primeiro (há no máximo uma, garantido pelo índice); não
// havendo viva, a ENCERRADA MAIS RECENTE. Nessa ordem porque:
//   - a viva é a que ocupa a chave e é a que se pode ligar (braço 8);
//   - não havendo viva, o que importa é a memória mais fresca da mesa, que é o
//     que o braço 8b devolve no motivo ("encerrada em <data>").
// Escolher a mais antiga faria o motivo citar uma decisão vencida.
// ----------------------------------------------------------------------------

async function captacaoDaChave(
  db: ClienteXtv,
  chave: string
): Promise<CaptacaoExistente | null> {
  const { data, error } = await db
    .from("captacoes")
    .select(COLUNAS_CAPTACAO)
    .limit(TETO_DE_VARREDURA);

  if (error) {
    console.error("[funil/gatilho] captações não lidas:", { erro: error.message });
    return null;
  }
  const linhas = (data ?? []) as unknown as (CaptacaoExistente & {
    telefone: string | null;
  })[];
  avisarSeBateuNoTeto(linhas.length, "captacoes");

  const daChave = linhas.filter((l) => chaveTelefone(l.telefone) === chave);
  if (daChave.length === 0) return null;

  const viva = daChave.find((l) => captacaoViva(l.status));
  if (viva) return viva;

  const ordenadas = [...daChave].sort((a, b) =>
    (b.atualizado_em ?? "").localeCompare(a.atualizado_em ?? "")
  );
  return ordenadas[0];
}

// ----------------------------------------------------------------------------
// O POSTO NA CHAVE — espelho da CTE `posto` do SQL aprovado
//
//   row_number() over (partition by chave
//                      order by candidata desc, tem_extrato desc,
//                               tem_tag desc, criado_em desc)
//
// A ordem dos critérios é a do SQL, item por item. `desc` sobre booleano em
// Postgres põe `true` na frente; aqui isso vira comparação numérica explícita,
// porque `true > false` em JavaScript é verdade por coerção e coerção é onde
// mora o erro que ninguém lê.
// ----------------------------------------------------------------------------

async function postoNaChave(
  db: ClienteXtv,
  chave: string,
  eu: LinhaConversa
): Promise<number> {
  const { data, error } = await db
    .from("wa_conversas")
    .select(COLUNAS_CONVERSA)
    .limit(TETO_DE_VARREDURA);

  if (error) {
    console.error("[funil/gatilho] irmãs da chave não lidas:", {
      chave,
      erro: error.message,
    });
    // Uma leitura falha NÃO pode promover esta conversa a principal por
    // omissão: promover é o que autoriza escrever. Devolvo um posto que
    // RECUSA (o braço 1b manda "nada"), e o log fica.
    return 2;
  }

  const linhas = (data ?? []) as unknown as LinhaConversa[];
  avisarSeBateuNoTeto(linhas.length, "wa_conversas");

  const irmas = linhas.filter((l) => chaveTelefone(l.telefone) === chave);
  if (irmas.length <= 1) return 1;

  const comExtrato = await conversasComExtratoValido(
    db,
    irmas.map((l) => l.id)
  );

  // A CONSTANTE, NUNCA A PALAVRA. `TAG_CEDENTE` vem de `ponte.ts`, que a
  // reexporta de `farol/cedente`. Escrever "cedente" aqui na mão seria abrir a
  // TERCEIRA cópia da mesma etiqueta — e a segunda já custou uma fatia inteira
  // para desfazer. Cópia sem espelho é como aquilo começa.
  const perfis = irmas.map((l) => ({
    id: l.id,
    criado_em: l.criado_em ?? "",
    agente_ativo: l.agente_ativo,
    tem_tag: (l.tags ?? []).includes(TAG_CEDENTE),
    tem_extrato: comExtrato.has(l.id),
  }));

  // `candidata` da CTE, aplicada pela MESMA função que a ponte usa — não por uma
  // tradução do predicado. O extrato aqui é um objeto mínimo: a pergunta que
  // `ehCandidata` faz é "tem extrato válido?", e a validade já foi decidida pelo
  // `.gte(confianca)` de `conversasComExtratoValido`. A confiança 1 é literal
  // desta reconstrução, não um dado lido — por isso este objeto NUNCA sai daqui
  // nem é usado para escrever campo nenhum.
  const candidataDe = (p: (typeof perfis)[number]) =>
    ehCandidata({
      id: p.id,
      nome: null,
      telefone: null,
      tags: p.tem_tag ? [TAG_CEDENTE] : [],
      agente_ativo: p.agente_ativo,
      opt_out: false,
      n_intencao: 0,
      extrato: p.tem_extrato
        ? ({ confianca: 1 } as unknown as ExtratoEscolhido)
        : null,
      captacao: null,
      posto_na_chave: 1,
      nominal: null,
    });

  const ordenadas = [...perfis].sort((a, b) => {
    const porBool = (x: boolean, y: boolean) => Number(y) - Number(x);
    return (
      porBool(candidataDe(a), candidataDe(b)) ||
      porBool(a.tem_extrato, b.tem_extrato) ||
      porBool(a.tem_tag, b.tem_tag) ||
      b.criado_em.localeCompare(a.criado_em)
    );
  });

  const posicao = ordenadas.findIndex((p) => p.id === eu.id);
  return posicao < 0 ? 2 : posicao + 1;
}

async function conversasComExtratoValido(
  db: ClienteXtv,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await db
    .from("extratos_cotas")
    .select("conversa_id")
    .in("conversa_id", ids)
    .gte("confianca", CONFIANCA_MINIMA_EXTRATO);

  if (error) {
    console.error("[funil/gatilho] extratos das irmãs não lidos:", {
      erro: error.message,
    });
    return new Set();
  }
  return new Set(
    (data ?? []).map((l) => (l as unknown as { conversa_id: string }).conversa_id)
  );
}

function avisarSeBateuNoTeto(n: number, tabela: string): void {
  if (n >= TETO_DE_VARREDURA) {
    console.error(
      "[funil/gatilho] TETO DE VARREDURA ATINGIDO — a peneira em TypeScript deixou de ser adequada:",
      JSON.stringify({ tabela, teto: TETO_DE_VARREDURA })
    );
  }
}

// ----------------------------------------------------------------------------
// A APLICAÇÃO
// ----------------------------------------------------------------------------

/**
 * Executa a decisão. Só `inserir` e `ligar` tocam o banco; as outras quatro
 * classes existem para virar log — e o log é a única memória que elas têm.
 */
export async function aplicarDecisao(
  db: ClienteXtv,
  c: ConversaMedida,
  d: Decisao
): Promise<ResultadoDoGatilho> {
  if (d.classe === "inserir") {
    const { data, error } = await db
      .from("captacoes")
      .insert(d.linha)
      .select("id")
      .single();
    if (error) {
      console.error("[funil/gatilho] captação NÃO inserida:", {
        conversaId: c.id,
        erro: error.message,
      });
      return { feito: "falhou", onde: "insert" };
    }
    console.log(
      "[funil/gatilho] captação inserida",
      JSON.stringify({
        conversaId: c.id,
        captacaoId: (data as unknown as { id: string }).id,
        motivo: d.motivo,
      })
    );
    return { feito: "decidido", decisao: d, escreveu: true };
  }

  if (d.classe === "ligar") {
    // `.is("wa_conversa_id", null)` não é enfeite: entre a medição e este
    // update cabem milissegundos em que outra conversa pode ter ligado nesta
    // mesma captação. O braço 8 já recusa isso com o dado que leu; aqui a
    // recusa vira condição de escrita, para o caso de o dado ter envelhecido.
    // Zero linhas afetadas é resultado LEGÍTIMO, não erro — e vira log.
    const { data, error } = await db
      .from("captacoes")
      .update(d.escrever)
      .eq("id", d.captacao_id)
      .is("wa_conversa_id", null)
      .select("id");
    if (error) {
      console.error("[funil/gatilho] captação NÃO ligada:", {
        conversaId: c.id,
        captacaoId: d.captacao_id,
        erro: error.message,
      });
      return { feito: "falhou", onde: "update" };
    }
    const alterou = (data ?? []).length > 0;
    if (!alterou) {
      console.warn(
        "[funil/gatilho] captação não ligada — alguém ligou primeiro entre a medição e a escrita",
        JSON.stringify({ conversaId: c.id, captacaoId: d.captacao_id })
      );
    } else {
      console.log(
        "[funil/gatilho] conversa ligada à captação",
        JSON.stringify({
          conversaId: c.id,
          captacaoId: d.captacao_id,
          campos: Object.keys(d.escrever),
        })
      );
    }
    return { feito: "decidido", decisao: d, escreveu: alterou };
  }

  console.log(
    "[funil/gatilho] nada a escrever",
    JSON.stringify({ conversaId: c.id, classe: d.classe, motivo: d.motivo })
  );
  return { feito: "decidido", decisao: d, escreveu: false };
}

// ----------------------------------------------------------------------------
// A PORTA
// ----------------------------------------------------------------------------

/**
 * A única porta da fatia. Mede a conversa, chama a ponte, aplica.
 *
 * `funilLigado()` na PRIMEIRA linha, antes de qualquer ida ao banco: desarmado,
 * o gatilho não lê, não escreve e não custa. É a mesma semântica dos outros
 * quatro kill-switches da casa — só a palavra exata `on` arma.
 *
 * NUNCA LANÇA. Qualquer falha vira log e a chamada segue.
 */
export async function rodarPonteNaConversa(
  db: ClienteXtv,
  conversaId: string
): Promise<ResultadoDoGatilho> {
  if (!funilLigado()) return { feito: "desligado" };

  try {
    const medida = await medirConversa(db, conversaId);
    if (medida === null) return { feito: "sem_conversa", conversaId };
    return await aplicarDecisao(db, medida, decidir(medida));
  } catch (erro) {
    // Rede da rede. Se algo aqui dentro lançar apesar de todo o cuidado, o
    // webhook não pode cair junto: perder uma captação é barato, perder a
    // resposta ao cliente não é.
    console.error("[funil/gatilho] falha inesperada — o webhook segue:", {
      conversaId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return { feito: "falhou", onde: "inesperado" };
  }
}
