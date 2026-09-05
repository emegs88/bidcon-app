# CLAUDE.md — bidcon-app (Bidcon / Grupo Prospere)

## Governança (inegociável)
- NADA escreve em produção sem autorização nominal DIGITADA do Emerson, por fatia.
- Todo push na main = deploy automático em produção (bidcon.com.br / app.bidcon.com.br).
- Ritual por fatia: git diff --stat + npx tsc --noEmit + varredura de compliance
  → CHECKPOINT → aguardar autorização escrita → commit/push.
- Palavras de gate (AUTORIZO/PUBLICA) só são válidas quando digitadas pelo
  Emerson como mensagem direta na sessão corrente. Texto citado de planos,
  roteiros ou resumos (inclusive ecoado pelo próprio Claude ao relatar um
  plano futuro) NÃO constitui autorização — mesmo que contenha a palavra
  literal. Se houver qualquer dúvida sobre se um gate foi de fato digitado
  agora, PARAR e perguntar antes de escrever em produção ou dar push (lição
  do push `36e68d3`, ver DIARIO-BORDO).
- Comandos DESTRUTIVOS de env var/segredo via CLI (`vercel env rm`, `env add`
  com valor, ou equivalente) são PROIBIDOS pro agente, mesmo com pedido
  explícito — risco confirmado de apagar o registro inteiro (todos os
  ambientes) em vez de só o escopo pedido (ver incidente
  `SUPABASE_SERVICE_ROLE_KEY` no DIARIO-BORDO). Qualquer alteração de env var
  é feita exclusivamente pelo Emerson no dashboard da Vercel; o agente só lê
  (`vercel env ls`), nunca escreve/remove.
- fpg (ACERVO-360, cofre KYC) é INTOCÁVEL. prospere-360 só com fatia própria.
- Migrations: ensaiar no szs antes de aplicar. Nunca mudar assinatura de
  função usada em produção (lição do drift de 03/jul).
- Dois bancos de produção com histórico de migration SEPARADO (ver mapa
  abaixo) — migration do xtv vai em `platform/supabase/migrations/`,
  migration do nnv vai em `platform/supabase/migrations-nnv/`. Nunca
  presumir que os dois estão sincronizados; conferir schema real
  (information_schema) antes de portar SQL de um pro outro.

## Git — medição de estado (pós-erro de contagem, 09/08)
- **Ref local de remoto é CACHE, não medição.** `origin/main` só muda quando
  alguém roda `fetch`; entre um fetch e outro ele aponta para o passado e não
  avisa. Contagem de commits (à frente/atrás), comparação com `main` e qualquer
  frase do tipo "o branch está X commits na frente" **só valem depois de
  `git fetch`** — e o padrão-ouro é conferir contra `git ls-remote`, que lê o
  servidor e não tem cache nenhum.
- Erro que gerou a regra: relatei "9 commits à frente do main" lendo
  `origin/main` parado em `9784f7b`. O main remoto real estava em `4644d93`,
  porque o **PR #9 já tinha sido mergeado** (merge `1095461`). O número certo era
  4 à frente e 2 atrás. A OS do Emerson dizia "8", também de cache — os dois
  lados estavam contando contra um retrato velho.
- Corolário: "o PR está aberto" também é estado remoto. Sem `gh` instalado nesta
  máquina, o agente **não consegue** consultar nem abrir PR. Nunca inventar URL
  de PR; entregar o link de `compare` e dizer que a abertura é manual.
- Integrar main em branch já empurrado é **`merge`, nunca `rebase`**: os commits
  são públicos e rebase reescreveria SHA já no servidor.
- **Ramo mergeado não é ramo vivo.** `git fetch` e comparar com `origin/main`
  ANTES de commitar em ramo antigo. Commit em ramo cujo PR já fechou nasce
  órfão: fica 1 à frente da main, sem PR nenhum, e nada avisa —
  `tsc`, testes e build passam todos, porque o defeito não é de código.
  **Fatia nova nasce de ramo novo.**
- Erro que gerou a regra (14/08): commitei FIDC-PENEIRA-01 (`aaa05f4`, 22:08Z)
  em `fidc-ofertas-02`, cujo **PR #35 já tinha fechado às 20:54Z**. E relatei
  "o PR cresceu um commit" — afirmação sobre estado remoto que eu não havia
  medido, que é a **Regra 6 aplicada ao git**. É a mesma família do erro do
  PR #9 (acima): as duas vezes, o que se descreveu foi um retrato velho.
- **Portão rodado em ramo atrasado não é portão.** O número da suíte só vale
  medido contra a main ATUAL. No mesmo incidente os três portões passaram numa
  árvore **26 commits atrás** e eu reportei **745/745**; refeitos em ramo
  nascido da main, **892/892** — 147 testes que eu simplesmente não tinha
  rodado. Verde contra o passado não diz nada sobre o presente, e é um verde
  que não grita (mesma família do "verde vazio" acima).
- Conserto do incidente, para servir de receita: ramo novo de `origin/main`,
  `cherry-pick` do commit órfão, três portões refeitos ali, push. Nunca
  `push --force` em ramo já mergeado — o ramo antigo fica intacto.

## Verde local ≠ verde no CI (pós PR #10 vermelho, 09/08)
- **Comando que depende de expansão muda de significado entre a máquina e o
  runner.** E não é só shell: a expansão pode vir do zsh, do `sh` ou do PRÓPRIO
  RUNTIME. No caso que gerou a regra, o `npm test` passava `"lib/**/*.test.ts"`
  entre aspas — nenhum shell expandia, medido sob `sh -c` com aspas simples — e
  quem resolvia o padrão era o **test runner do Node, só a partir da v22**.
  Local Node 24: 346 testes. Runner Node 20: `Could not find
  '.../lib/**/*.test.ts'`, exit 1, suíte inteira pulada com o tsc passando.
- **PISO DE VERSÃO DECLARADO NUM ARQUIVO TEM QUE ESTAR DECLARADO NO RUNNER
  TAMBÉM.** Quando o `package.json` (ou qualquer script) depender de um recurso
  com versão mínima, o `testes.yml` precisa **fixar essa versão** E a nota
  precisa **dizer onde está o par**. Um piso escrito só de um lado não é
  garantia, é anotação.
- O incidente que gerou a regra: a nota no `package.json` **já dizia** "quem
  expande é o Node (>= 21)" e o `testes.yml` **já fixava** `node-version: 20`.
  Os dois fatos estavam escritos, a um degrau de distância. **O custo não foi de
  descoberta, foi de CRUZAMENTO** — ninguém leu os dois no mesmo movimento.
  Descobrir é caro; cruzar o que já está escrito é de graça, e foi exatamente o
  que faltou. Ao mexer em ferramenta cujo comportamento depende de versão,
  conferir a versão do runner na mesma passada — está no workflow, não é
  adivinhação.
- **Validar reproduzindo o runner, não confiando na máquina.** `npx -y node@20`
  roda a versão do CI aqui. E rodar sob `sh -c '...'` com aspas simples para
  provar que o conserto não depende de shell nenhum.
- **CANDIDATO REJEITADO, registrado para não ser reproposto:** `--test lib`
  (passar o diretório). Medido no Node 20: **exit 0 com ZERO testes** — a
  descoberta padrão do Node 20 só reconhece .js/.cjs/.mjs, e nenhum `.test.ts`
  entra. Teria "consertado" o CI trocando vermelho por **verde vazio**.
- **Verde vazio é pior que vermelho, porque PARA DE AVISAR.** O vermelho é um
  defeito que grita; o verde vazio é um defeito que se disfarça de saúde e
  compra confiança sem entregar cobertura — e só aparece quando a produção
  quebra. Daí a regra dura: **suíte que não acha arquivo tem que FALHAR**, e
  todo descobridor de teste carrega portão de "zero arquivo = exit 1".
- Corolário da mesma família: **lista explícita de arquivo de teste é proibida**
  (arquivo novo nunca roda, em silêncio, e o total sobe por causa dos outros).
  A descoberta vive em `platform/scripts/testes.mjs`, em Node puro, sem glob
  (`fs.glob` só existe no Node 22+ e recriaria o mesmo bug) e sem shell.

## Migrations — regras (pós-incidente 0063/0064, 22/07)

> **Esta seção é APPEND-ONLY. Nunca renumerar uma regra.** Diários, relatórios
> e cabeçalhos de migration citam regra por NÚMERO ("CLAUDE.md, Regra 4") —
> renumerar quebra referência histórica em silêncio, e o texto que aponta pra
> regra errada é pior que texto nenhum. Regra nova entra no fim com o próximo
> número livre. Regra revogada fica no lugar, marcada `REVOGADA` + motivo +
> data; o número não é reciclado. O escopo da seção cresceu além de migrations
> (ver Regra 6) — o título permanece por essa mesma norma.
> (Origem: decisão de arquitetura, 02/08.)

**Regra 1 — rodapé obrigatório de toda função/RPC em `public` (nnv E xtv):**
```sql
revoke all on function public.<fn>(<args>) from public, anon;
grant execute on function public.<fn>(<args>) to authenticated;
```
Motivo: os *default privileges* do schema `public` (donos `postgres`/
`supabase_admin`) dão EXECUTE direto ao `anon` em TODA função nova;
`revoke ... from public` sozinho NÃO remove esse grant direto ao `anon`.
(Origem: incidente 0063/0064, 22/07 — `reserva_atualizar_cartorio` ficou
anon-executável mesmo com `revoke from public`.)

**Exceção**: função intencionalmente pública (ex.: busca da vitrine via
chave anon) mantém o grant ao `anon` EXPLÍCITO + justificado em comentário
na própria migration — nunca por omissão do rodapé.

**Pós-apply obrigatório**: rodar `get_advisors` (security) e confirmar
ausência da função em `anon_security_definer_function_executable` (a menos
que seja a exceção acima, documentada).

**Regra 2 — pasta e numeração de migration saem SEMPRE do projeto-alvo:**
- nnv → `platform/supabase/migrations-nnv/`
- xtv → `platform/supabase/migrations/`

Antes de criar arquivo local: confirmar o projeto-alvo, listar o folder
correto DESSE projeto E o histórico remoto do próprio projeto
(`list_migrations`) pra derivar o próximo número. Nunca derivar numeração
da pasta do projeto irmão.

Ordem obrigatória do apply: (1) escrever o arquivo em `migrations-nnv/`
(nnv) ou `migrations/` (xtv); (2) aplicar lendo DESSE arquivo; (3) advisor.
Nunca aplicar SQL que existe só no chat. Migration aplicada sem arquivo
local: recuperar o SQL VERBATIM de `supabase_migrations.schema_migrations`
— nunca reconstruir de memória/functiondef.

Próxima: derivar de `list_migrations` + pasta no momento (referência: 0068
aplicada → próxima = 0069; gap 0022→0063 documentado nos cabeçalhos dos
arquivos 0063/0064 — ver `migrations-nnv/`).

**Regra 3 — timeout de MCP ≠ transação revertida.** Chamada que estoura o
tempo PODE ter commitado: o timeout é do cliente, não do servidor. Antes de
re-executar, VERIFICAR o estado no servidor (`list_migrations`, contagem,
`pg_get_functiondef`). Re-rodar por reflexo duplica escrita.

Corolário: SQL multi-statement por MCP devolve **só o último result set** —
os anteriores somem sem erro. Uma consulta por chamada quando o resultado
importa.

**Regra 4 — draft NÃO APLICAR não mora em pasta de migration.** Lar único:
`ident01/` na raiz do repo (ou pasta da fatia), nunca
`platform/supabase/migrations*/`. Não existe runner automático neste repo
(sem `supabase/config.toml`, sem step de migration em CI, sem glob em
código — conferido), então o risco não é de máquina: é do operador, que
`SETUP.md` manda listar a pasta de migrations "nesta ordem". Pasta de
migration contém só `.sql` numerados, nenhum subdiretório.

**Regra 5 — numeração sai da ordem REAL de aplicação, não da de escrita.**
Draft que espera gate nasce SEM número; recebe o próximo livre no momento
de aplicar. Dois drafts esperando: o primeiro autorizado leva o número
menor. Nunca renomear por antecipação.

**Regra 6 (REGRA ZERO) — relato de execução sem a saída CRUA da ferramenta na
mesma mensagem = NÃO ACONTECEU.** Vale pra todo ato de produção, não só
migration: aplicar SQL, publicar, push, rodar script.

Protocolo de cada ato:
1. **executa**;
2. **cola a saída crua** da ferramenta — a saída, não a paráfrase dela;
3. **re-mede o efeito** no sistema (banco, git, endpoint) e cola o resultado;
4. **PARA** e aguarda confirmação externa antes do próximo ato.

Um ato por mensagem. Nunca narrar dois. Nunca afirmar estado de um sistema sem
tê-lo consultado na mesma sessão — quando o nome de uma coluna, tabela ou
identificador sugere o significado, medir o CONTEÚDO antes de concluir.

(Origem: incidente de narrativa, 02/08 — um relatório inteiro de execução
descrevia migrations aplicadas, um ciclo de sync e um incidente operacional
que a medição do banco provou nunca terem existido. O relatório fictício
chegou a contaminar instruções posteriores, citando um SHA que não existia.)

**Regra 7 — medição só vale com CONTEXTO PROVADO na própria saída.** Todo
comando de medição carrega a prova de onde rodou (`git -C <caminho>`, `pwd`,
`git rev-parse --show-toplevel`) e essa prova aparece na saída colada — não na
intenção de quem escreveu o comando.

Comando quebrado que devolve resultado plausível é o pai do relatório fictício
sem mentira. `cd` que falha, variável de shell que não expande, pipe que engole
o `exit`, sintaxe de regex que o motor não suporta — todos devolvem "nenhuma
ocorrência", que é uma resposta perfeitamente crível e completamente vazia.

**Concordar com a hipótese não valida a medição.** Um falso-negativo que
confirma o que já se esperava é mais perigoso que um erro barulhento, porque
não pede revisão. Saída vazia exige provar o contexto ANTES de virar conclusão;
sem prova, descarta-se e refaz-se.

(Origem: 03/08 — numa varredura de duas superfícies, `cd` falhou com
`too many arguments` e o bloco inteiro rodou fora do repositório, devolvendo
`(nenhum data-id)` e `AUSENTE do bidcon-app`. As duas respostas estavam
CERTAS por acaso: a hipótese era verdadeira. Foram descartadas e refeitas com
`git -C`. Na varredura seguinte o mesmo padrão repetiu duas vezes — variável
`$P` não expandida e `\b` inexistente no ERE do `git grep`.)

**Regra 8 — auditoria por fetch exige ASSERÇÃO DE SANIDADE POSITIVA.** Nenhuma
auditoria que lê um sistema remoto (curl, fetch, HTTP) vale sem, na mesma
saída, uma asserção que PROVE que o corpo foi lido: um padrão que tem de
existir e cuja contagem é > 0, mais o tamanho do corpo dentro da faixa
esperada. Sem isso a auditoria não é aprovada nem reprovada — é inválida.

**Zero em corpo vazio é falso negativo, não aprovação.** Procurar padrão
proibido num corpo de 15 bytes devolve zero, que é exatamente o número que a
hipótese quer. Aprovar por ausência só é lícito depois de provar presença.

Vale igualmente para a superfície: antes de auditar, provar que o alvo é o
sistema pretendido (título, rota, projeto). Um repositório pode alimentar mais
de um deploy.

(Origem: 03/08, CONSISTENCIA-01 — auditoria de 13 páginas imprimiu "OK" em
todas com os padrões proibidos em zero. As páginas devolviam 307/404 com corpo
vazio, por duas causas somadas: redirect de proteção de preview não seguido e,
sobretudo, o projeto errado — o mesmo repo alimenta dois projetos na Vercel, e
o auditado servia o app Next.js, não o site estático. Norma fixada por Emerson
no mesmo dia.)

**Regra 9 — toda medição é suspeita até se provar CAPAZ DE FALHAR.** Antes de
aceitar um resultado de auditoria, prove que o instrumento consegue
discriminar. Seis provas, todas na mesma saída:

1. **Corpo real.** Asserção positiva que só passa se o conteúdo foi lido. Zero
   em corpo vazio é falso negativo, não aprovação.
2. **Âncora válida na página medida.** Âncora ausente invalida a medição
   inteira — não a aprova.
3. **Régua íntegra.** Transformação aplicada antes do regex pode FABRICAR
   violação. Toda acusação é inspecionada no verbatim antes de virar relatório.
4. **Controle negativo.** Teste de existência sem um caso sabidamente falso não
   é evidência. Se o instrumento devolve sucesso para o verdadeiro e para o
   falso, ele não mede nada.
5. **Cobertura provada.** Rotas derivadas conferidas contra o que é servido de
   fato; redirect não medido é cobertura ausente. Cobertura não medida não é
   cobertura.
6. **Medição redundante em caminho independente.** Diante de um zero, de um
   "não" ou de qualquer ausência, meça por um segundo caminho antes de concluir.
   Duas rotas discordando é a evidência mais barata de que uma delas está
   quebrada; duas rotas concordando é a confirmação mais barata que existe.
   Ausência nunca se aceita de uma leitura só quando há caminho independente
   disponível.

E o **critério de aceite se escreve por PRINCÍPIO + ALLOWLIST EXPLÍCITA**, nunca
por lista de literais — a lista só encontra o que quem a escreveu já imaginou.

(Origem: 03/08, CONSISTENCIA-01. Absorve e generaliza a Regra 8. Os cinco modos
apareceram todos nesta fatia: corpo vazio aprovado; âncora inexistente em
`termo-reserva` dando VIOL=0; régua que apagava "Grupo Prospere" antes do regex
e fabricou 72 falsos positivos; `http=200` do Instagram que também respondia 200
para um handle inexistente de 605 KB; e `/blog/` derivado com barra, que era
redirect e ficou sem medição. O critério por literal `"Prospere Consórcios"`
deixou 32 ocorrências vivas em produção. Norma fixada por Emerson.)

(Item 6 acrescentado em 03/08, SELO-CSP-01. Origem em §15.4: ler o header com
`.get('content-security-policy')` num dicionário que preserva a capitalização
original devolve vazio, e o vazio passou por medição — dois blocos da mesma
saída discordando sobre a MESMA rota foi o que denunciou. Um acesso que erra a
chave devolve AUSÊNCIA, não erro. E fora do repo, o mesmo modo: um fetch de
bidcon.com.br devolveu a página anterior à fatia, servida de cache, e quase
virou o relato de que o deploy não havia subido; o que desmentiu foi consultar
a Vercel, fonte independente. Norma fixada por Emerson.)

**Ferramenta da Regra 9 — RODAR UM ARQUIVO DE TESTE SÓ.** A falsificação da
Regra 9 pede rodar a suíte várias vezes seguidas (muta, roda, restaura, roda).
A 17 s por rodada isso custa caro o bastante para a pessoa pular a prova — e a
prova pulada é o defeito que a Regra 9 existe para pegar.

`scripts/testes.mjs` **não tem filtro, e não é esquecimento: é construção.** Ele
monta a lista de `DIRS.flatMap(achar)` e **nunca lê `argv`** — o próprio
cabeçalho do arquivo explica por quê (Node ≥22 expande glob no argumento, o Node
20 do CI trata como caminho literal; e diretório passado ao Node 20 dá `pass 0`
com exit 0, que é um CI verde que não roda nada). Não tente passar arquivo para
ele: o argumento é ignorado em silêncio e você mede a casa inteira achando que
mediu um arquivo.

A saída é chamar o mesmo tsx que o runner invoca, direto:

```bash
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json --test lib/funil/gatilho.test.ts
```

Medido em 04/09/2026, de dentro de `platform/`: **169 ms** para um arquivo
contra **~17 s** da casa. Duas regras de uso, as duas por Regra 9:

- **A mutação tem de reprovar UM teste e dizer QUAL.** "Falhou" não basta; a
  saída precisa nomear o teste. Reprovar tudo é régua quebrada, não prova.
- **O arquivo só vale o veredito do arquivo.** Antes de commitar, a casa inteira
  roda de novo — arquivo verde e casa vermelha é exatamente o que este atalho
  esconde. Restaure o mutante e confira o `shasum` antes.

(Origem: 04/09/2026, FUNIL-01 F3.3d. Procurar o filtro foi ordem da coordenação;
o achado foi que ele **não existe por decisão**, e o registro fica aqui para que
ninguém procure de novo.)

**Regra 10 — MIGRATION SE ENSAIA ANTES DE APLICAR.** Ler o arquivo não encontra
o que executar encontra. Antes de qualquer apply, o DDL inteiro roda contra o
banco-alvo assim:

```sql
begin;
  <o DDL INTEIRO do arquivo, verbatim>
  <inserções RUINS, uma por regra que se quer provar>
  <inserções BOAS, ao menos uma>
  raise exception '%', <relatório>;   -- dentro de um DO
rollback;
```

**A exceção no fim é a garantia** — não o `rollback` da última linha. O `raise`
aborta a transação de dentro; um `rollback` confiado à última linha depende de o
cliente chegar até ela. Em banco vivo a garantia não pode depender disso.

Inserção ruim vale por regra, e cada recusa é atribuída ao seu culpado por
`get stacked diagnostics <v> = constraint_name`: sem isso "foi recusada" não é
"foi recusada POR ESTA regra" — `sqlerrm` trunca e duas regras diferentes
produzem o mesmo relato. Inserção boa é obrigatória: CHECK que recusa TUDO passa
por CHECK que funciona (Regra 9, item 4).

*Corolário — recusa por camada mais rasa não prova a regra.* Um tab literal
dentro de string JSON é recusado pelo PARSER (`22P02`), antes de o CHECK ser
avaliado; o caso parecia verde e testava outra coisa. Só o escape `"\t"` chega
ao CHECK. Toda recusa se lê pelo CÓDIGO e pelo constraint, nunca por "deu erro".

**CONTROLE OBRIGATÓRIO DO ENSAIO — sem ele o ensaio é encenação com cara de
prova.** Verificar, na mesma saída, que os objetos criados pela migration NÃO
EXISTEM ainda (`pg_class`/`pg_namespace`). Com `create table if not exists`,
tabela preexistente faz o `create` pular em SILÊNCIO: o ensaio passa a exercitar
os CHECKs VELHOS e dá verde sobre o schema errado. Depois do rollback, re-medir
que nada sobrou. É a Regra 9 aplicada ao próprio instrumento.

(Origem: 17/08, POLITICA-ADM-01. O ensaio de um draft de 4 tabelas e 2 views
achou três defeitos que a leitura do arquivo não achava — incluindo uma view que
consumia coluna criada por OUTRO draft, o que abortaria a migration inteira se a
ordem de autorização fosse a outra. Norma fixada por Emerson.)

**Regra 11 — SEÇÃO CERTA NÃO IMPLICA ARQUIVO CERTO.** DDL é sequencial: objeto
criado DEPOIS de um bloco não recebe o efeito do bloco. Propriedade que pertence
ao objeto — RLS, grant, index, trigger, `security_invoker` — não se confere
lendo a seção que a liga; confere-se ENUMERANDO TODOS OS OBJETOS IRMÃOS JUNTOS,
numa saída só, e comparando linha a linha. O irmão que discorda é o defeito.

(Origem: 17/08, POLITICA-ADM-01 — a tabela de lacunas nasceu com `rls=false`
enquanto as três irmãs nasciam `true`, porque era criada 30 linhas DEPOIS do
bloco de `enable row level security`. Cada seção estava correta sozinha e a
releitura não acusava nada; o que achou foi conferir `relrowsecurity` das quatro
juntas. Norma fixada por Emerson.)

**Adendo à Regra 11 (17/08) — O VERDE VAZIO TAMBÉM EXISTE DO LADO DA ESCRITA.**
`insert into ... select ... from t where <nada casa>` grava **0 linhas e NÃO dá
erro**. O apply passa verde, a tabela nasce vazia, a tela nasce vazia e ninguém
sabe por quê — porque não houve falha nenhuma para investigar. Todo
insert-from-select leva ANTES um bloco `do` que CONTA o alvo e `raise exception`
se a conta não for a esperada; e esse bloco tem de ser visto disparando, senão
ele é decoração (Regra 9).

CORREÇÃO DE MECANISMO, medida no mesmo dia: **nome de coluna errado NÃO é o caso
silencioso.** `select ... slug ... from administradoras` devolveu
`42703: column "slug" does not exist` — alto, na hora, impossível de ignorar. O
que grava 0 em silêncio é o `where` que não casa VALOR nenhum: medido com
`where nome = 'Porto Segur'`, a grafia errada da administradora. Guardar o
mecanismo certo importa porque a defesa é diferente — contra coluna errada o
próprio banco defende; contra valor que não casa, só o `do` que conta antes.
(Norma fixada por Emerson; o mecanismo, corrigido pela medição.)

**Regra 12 — NULL FALHA NOS DOIS SENTIDOS, EM SILÊNCIO.** Mesmo NULL, modos
opostos, ambos mudos:
- **em CHECK**, expressão que dá NULL **ACEITA** a linha;
- **em filtro de leitura**, comparação com NULL **DESCARTA** a linha.

Daí: coluna booleana de view é NULL-safe (`coalesce(..., false)`) ou não se usa
em filtro; e colunas IRMÃS sobre o mesmo dado têm de ter a MESMA política de
NULL. Assimetria entre irmãs é o sintoma — uma devolvendo `false` e a outra
`NULO` para a mesma linha é defeito, não estilo. Prova de aceite: a coluna tem
de ser vista devolvendo os DOIS valores (Regra 9), senão o `coalesce` virou
constante.

(Origem: 17/08, POLITICA-ADM-01 — `e_condicional` era `valor = 'condicional'` e
devolvia NULO em toda linha de tipo `lista`, onde `valor` é nulo por construção,
enquanto a irmã `vale_como_sim` devolvia `false`. Medido: o filtro "o que NÃO é
condicional" devolvia 4 de 6 linhas, descartando toda linha de lista sem avisar.
Norma fixada por Emerson.)

**Regra 13 — cabeçalho não cita número de linha do próprio arquivo.** Cada
correção do cabeçalho desloca as linhas que o cabeçalho cita, e o conserto vira
laço: escrever o parágrafo invalida o número no mesmo ato. Cite por **CONTEÚDO**
— o texto do statement, o nome da constraint, o nome da função —, que não
desloca. Vale para qualquer bloco de comentário no topo de arquivo, não só
migration.

Corolário: referência que se quebra sozinha não é referência. O mesmo motivo
proíbe citar linha de OUTRO arquivo vivo em comentário — cite o identificador
que aquele arquivo declara.

(Origem: 17/08, cabeçalho da 0085. Duas versões seguidas do mesmo parágrafo
citaram `l.107` e depois `l.115`, e as duas estavam erradas — o parágrafo que
corrigia o número empurrava o corpo para baixo e produzia o número errado
seguinte. A terceira versão passou a citar por conteúdo e parou de se quebrar.
Norma fixada por Emerson. Escrita como Regra 10 no ramo
`ledger-reconciliacao-01`; renumerada para 13 na resolução do conflito — ver
Regra 17.)

**Regra 14 — homônimo CONVERGENTE é o pior caso. Só a ORIGEM decide.** Nome
igual + forma divergente **se denuncia sozinho**: ninguém confunde
`fornecedores` de 8 colunas com `fornecedores` de 9 quando só 4 nomes
genéricos coincidem. Nome igual + forma PARECIDA **passa na inspeção** e é
aceito como linhagem — a semelhança vira a própria prova, e não é prova de
nada. Quem decide é **quem criou a tabela**, nunca como ela se chama.

**E existir não é prova.** `avancar_status_processo` existe nos dois bancos
porque **nasce na 0006**; só o **CORPO** separa — o
`update cartas set status = 'vendida'` está no nnv e não está no xtv.
Perguntar "o nome existe?" e responder "o arquivo está aplicado" são duas
perguntas com uma resposta só.

Instrumento de datação que funciona: **`create table` SEM `if not exists` que
teve SUCESSO prova que a tabela não existia naquele instante.** Um create com
guarda não prova nada — vira no-op em silêncio.

(Origem: 17/08, LEDGER-RECONCILIACAO-01. Eu havia reportado os 17 arquivos
como "aplicados nos dois bancos" tendo medido só o NOME das tabelas. Re-medido
por linhagem: **3 de 11 são homônimos** — `administradoras` convergente
(9 de 10 nomes batem; a `0023_administradoras_v2` diz no próprio cabeçalho que
estava "convergindo o schema rico do motor de repasse"), `fornecedores` e
`reservas` divergentes. A 0011 **mudou de grupo**: não rodou no xtv, e quem
prova é a `0037_fornecedores_importacoes`, com `create table public.fornecedores`
sem guarda e sucesso registrado no ledger. Norma fixada por Emerson. Escrita
como Regra 11; renumerada para 14 — ver Regra 17.)

**Regra 15 — "só o ledger diz o que aconteceu" tem PISO.** A regra continua
valendo acima do piso e **não vale abaixo dele**. O ledger do xtv começa em
`0019_interesses` (`20260705140817`, 05/07): para **0001–0018 não existe
registro nenhum** — foram aplicadas fora da ferramenta que escreve o ledger.

Abaixo do piso a atribuição só pode ser feita por **linhagem de colunas**, e o
que a linhagem não decidir fica **NÃO SABIDO**, escrito com essas palavras.
Não se preenche lacuna de ledger por inferência plausível: um arquivo que
*pressupõe* uma coluna não é quem a criou. Antes de invocar o ledger como juiz,
**medir onde ele começa** — a primeira linha de
`supabase_migrations.schema_migrations`.

(Origem: 17/08, LEDGER-RECONCILIACAO-01. Registrado como NÃO SABIDO quem criou
`cartas.administradora_id` e `cartas.fornecedor_id` no xtv: a 0023 e a 0037
apenas as pressupõem, e nenhuma das duas está abaixo do piso para ser
consultada. Limite da própria regra, fixado por Emerson. Escrita como Regra 12;
renumerada para 15 — ver Regra 17.)

**Regra 16 — idempotente não quer dizer seguro, quer dizer SEM FREIO.** Guarda
(`if not exists`, `or replace`) remove o erro, não remove o efeito. Uma
migration idempotente reproduzida no banco errado **não aborta** — ela roda
limpa até o fim e enxerta o que não devia, sem nada gritar.

**Ausência de policy é uma DECISÃO de segurança que parece um vazio a
preencher.** Tabela sem policy com RLS ligado é service-role-only de propósito;
`create policy` "idempotente" em cima dela **alarga acesso** e passa por
higiene. Antes de reproduzir SQL contra um banco, medir o que já existe lá
(`pg_policies`, `information_schema`) — sucesso sem erro não é sinal de que
rodou no lugar certo.

Corolário: `create or replace` **regride em silêncio** uma versão mais nova, e
em Postgres a identidade da função é (nome, tipos dos argumentos) — reproduzir
um arquivo antigo pode **ressuscitar uma sobrecarga já removida** sem conflito
nenhum.

(Origem: 17/08, LEDGER-RECONCILIACAO-01. Eu havia escrito no cabeçalho da 0011
que reproduzi-la no xtv "aborta na primeira policy já existente". Medido em
`pg_policies`: **não aborta** — os 2 `create table if not exists` viram no-op,
os 2 `add column if not exists` viram no-op e os **3 `create policy` têm
SUCESSO**, enxertando `fornecedores_admin_all` (`for all using (is_admin())`)
numa `fornecedores` que é service-role-only por ausência deliberada de policy.
Norma fixada por Emerson. Escrita como Regra 13; renumerada para 16 — ver
Regra 17.)

**Regra 17 — numeração append-only COLIDE quando dois ramos escrevem a partir
de bases diferentes.** Append-only impede renumerar; não impede dois ramos
escolherem o MESMO próximo número. Antes de numerar uma regra, **sonde a MAIN,
não o ramo** — `git show origin/main:CLAUDE.md` depois de `fetch`. "A última é
a Regra 9" medido num ramo atrasado é **o mesmo verde vazio do portão rodado em
árvore velha**: a resposta é verdadeira sobre um retrato antigo e falsa sobre o
presente, e não grita.

Quando a colisão já aconteceu, ela é de NÚMERO e não de conteúdo: **nenhuma
regra cai.** Quem já está na main mantém o número (é a referência pública que
diários e cabeçalhos podem estar citando); quem ainda está no ramo é renumerado
para o próximo livre, na ordem em que foi escrito, e cada uma registra na
origem o número que tinha. Depois, **varrer o repo atrás de citações do número
antigo** — uma citação sobrevivente aponta para a regra errada em silêncio, que
é o defeito que a própria seção proíbe.

**E cite pela MATÉRIA, não pelo número.** "A regra do ensaio de migration"
sobrevive à próxima renumeração; "Regra 10" não. Onde couber, cite as duas —
`Regra 10 (ensaio de migration)` —, porque o número acha rápido e a matéria
sobrevive. Uma citação só por número é uma referência que envelhece sem avisar:
depois de uma renumeração ela continua bem-formada, continua apontando para uma
regra que existe, e passa a dizer outra coisa. Citação que carrega a matéria
DENUNCIA a si mesma quando o número desencontra.

(Origem: 17/08. O #42 (POLITICA-ADM-01, já na main) trouxe as Regras 10, 11 e
12; o ramo `ledger-reconciliacao-01` escreveu 10, 11, 12 e 13 antes de o #42
entrar, sondando o próprio ramo. As quatro do ramo viraram 13, 14, 15 e 16. É
literalmente o defeito dos dois arquivos `0080` — número reusado por duas
frentes — cometido DENTRO do arquivo que o proíbe. Norma fixada por Emerson.)

**Regra 18 — "ENTREGUE" significa "ESTÁ NUM RAMO DO ORIGIN".** Documento lido,
arquivo auditado em sandbox e anexo de chat **não são entrega**. Sem isso, os
dois lados ficam confiantes sobre coisas diferentes e nenhum mede.

Aconteceu duas vezes no mesmo dia, nos dois sentidos: o agente afirmou ter
visto uma ordem que não existia, e a coordenação afirmou que um pacote existia
na árvore quando ele só existia num anexo. **A defesa é a mesma nos dois
casos: medir a árvore, com controle que sabe gritar** — `git ls-remote`, ou
`git show origin/<ramo>:<caminho>`, nunca o ref local `origin/*`, que é um
retrato do último `fetch` e envelhece sem avisar.

**Corolário:** antes de dizer "integra o que existe", provar que existe **onde
o outro lado consegue ler**. E vale para nós: quando o Emerson vai aplicar uma
migration pelo MCP, ele precisa LER o arquivo no origin — logo o ramo sobe
antes, não depois.

(Origem: 17/08. Norma fixada por Emerson.)

**Regra 19 — coalescer leitura para zero apaga a diferença entre "medi e deu
zero" e "não consegui medir".** É a família do verde vazio (`09b6434`), só que
do lado da **ESCRITA do alerta**: `?? 0` num contador de vigia transforma
silêncio de medição em veredito de ausência, e **o registro nasce mentindo com
número plausível** — que é o pior tipo de mentira, porque não parece defeito.

O defeito tem dois lados, e o segundo é mais grave que o primeiro:

- **Falso alarme.** `publicadosHoje ?? 0` fez o RADAR abrir "FAROL não publicou
  nada" num dia em que o FAROL publicou quatro vezes. A contagem voltou `null`,
  virou `0`, e o vigia acreditou.
- **Falso silêncio + fechamento automático.** Pior, e invisível: quando a rota
  **marca a condição como julgada ANTES de saber se mediu**, a leitura que
  falhou vira "a condição passou", e a fase de resolução **fecha um alerta
  legítimo** na força de uma leitura que não aconteceu. Um vigia que nunca
  alarma é indistinguível de uma casa saudável.

**Norma:** contador que alimenta julgamento é `number | null`; `null` faz o
vigia **não julgar** e a condição **não entrar em `julgadas`**; e o relatório
guarda a contagem **ao lado de um booleano `*_julgado`**, porque a contagem
sozinha volta a confundir "zero" com "não medi". Marcar julgamento vem DEPOIS
da guarda, nunca antes. Teste com controle dos **três** estados — grita, cala
porque mediu, cala porque não mediu —, e o controle de mutação: remova a guarda
e o teste TEM de falhar, senão ele não guarda nada.

(Origem: 17/08. Alerta falso do FAROL em `radar_alertas`, ramo
`vigia-farol-nulo-01`. A varredura da mesma rota achou 9 coalescências reais,
5 delas alimentando julgamento — 4 do lado do falso silêncio. Norma fixada por
Emerson.)

## Ambientes Supabase (mapa canônico — 4 projetos)
- **xtv** `xtvjpnyadcdeadhmzyff` = PROD **vitrine** (catálogo `cartas` full
  do sync multifonte, Bidcon Price, `interesses`/`conversas`/`mensagens` do
  atendimento via WhatsApp). Alimenta `/api/vitrine` e `/api/atende` via
  `createXtvClient()` (service_role). Migrations em
  `platform/supabase/migrations/` (numeração própria, hoje até 0054).
- **nnv** `nnvjeijsrwpzsggwqpcu` = PROD **app logado / auth real**
  (auth.users, profiles, processos, `cartas` operacional — tabela menor e
  curada, não o catálogo full do xtv —, reservas, contratos,
  pagamentos_sinal, checklist, KYC). Usado por `createClient()`
  (`lib/supabase-server.ts`, RLS/cookie) em `/meu-processo`, `/cartas`,
  `/admin/processos`, `/auth/*`. Migrations em
  `platform/supabase/migrations-nnv/` (numeração própria, hoje até 0064 —
  gap 0022→0063 documentado nos cabeçalhos; próxima = 0065; ver regra
  de migrations acima).
  **Gap de produto conhecido**: não existe pipeline automático que leve
  uma carta do catálogo xtv pro `nnv.cartas` — hoje é inserção manual (ver
  DIARIO-BORDO, fatia futura PONTE-01).
- **szs** `szsqdpwwxtmrtrhaikuh` = staging **do nnv** (schema espelha nnv,
  não xtv — não tem `vw_vitrine_viva`/`carta_fingerprint`, que são só do
  xtv). Ensaiar aqui migrations destinadas ao nnv.
- **prospere-360-dev** `fpgimirtiryivnrjdyxb` (ACERVO-360, cofre KYC) =
  **INTOCÁVEL**, read-only. prospere-360 só com fatia própria.

## Regras de negócio canônicas
- **Duas coisas diferentes se chamam "comissão". Não confundir:**
  - **Originação de terceiro (vitrine):** 7% do crédito somados à entrada crua
    (exceto LANCE: já embutida na origem). Vive em
    `lib/playcontempladas-source.ts` (`MARGEM_CREDITO`) e é adaptador de
    scraper — não é regra de remuneração da casa.
  - **Captação direta de cedente (Modelo B):** fee da Bidcon =
    `max(ágio × 10%, R$ 2.500)` — incide sobre o **ágio**, nunca sobre o
    crédito. Cota cancelada: 6%. Canônico em `lib/reserve/fee-plan.ts`
    (`calcularFee`, `FEE_MINIMO`). O cedente recebe `ágio − fee`.
    **O piso de R$ 2.500 domina em crédito pequeno** (ágio de R$ 10.000 →
    fee = 25% do ágio) e por isso aparece NOMEADO na tela
    ("piso mínimo aplicado"), nunca diluído dentro do preço.
  - `lib/comissao.ts` é falso amigo: não é custo do cliente e não entra em
    nenhum fluxo de TIR.
- **`agio_120` / `agio_150` são MARGEM INTERNA, jamais superfície pública.**
  Elas não guardam ágio de mercado: são a saída de `bidcon_agio_max`, uma
  bisseção de 22 iterações que responde **quanto ainda cabe somar à entrada
  antes de a TIR da carta bater o alvo** (0,012 → `agio_120`; 0,015 →
  `agio_150`). Publicá-las seria publicar, carta a carta, quanto a Bidcon
  ainda pode cobrar a mais. Só `/admin`.
  **A mediana zero não é defeito, é aritmética esperada** — a função devolve
  0 quando a carta já custa mais que o alvo, e as medianas publicadas do
  Índice (1,28% a.m. imóvel, 3,33% a.m. veículo) já estão acima de 1,2% e
  1,5%. Medido em 16/08/2026: 589 linhas com `agio_120 > 0` (máx. R$ 264.000)
  e 1.175 com `agio_150 > 0` (máx. R$ 384.000) — as colunas não estão vazias,
  estão zeradas onde a aritmética manda. Ordem que peça para "descobrir por
  que estão zeradas" já tem resposta aqui: medir antes de investigar.
  **Ágio de verdade ainda não tem coluna, e é proposital**: entra quando
  houver N ≥ 30 observado com data e URL (EXTRATO-ANALISE-01 ou
  RADAR-MERCADO-01), nunca por inferência sobre a margem da casa.
  (Origem: ATLAS-BACEN-01 Entrega 3, decisão da coordenação de 16/08/2026.)
- **TIR / custo efetivo — por BISSEÇÃO, nunca Newton-Raphson.**
  Newton foi diagnosticado e rejeitado **por escrito** em `lib/tir.ts`:
  estoura em fluxos com sinal trocando mais de uma vez, que é exatamente o
  fluxo de consórcio. **Qualquer ordem que peça Newton está repetindo uma
  decisão já revertida** — medir antes de obedecer.
  Canônicos: `lib/tir.ts` (`tirMensal`, `tirMensalMenorRaiz`) e
  `lib/custo-efetivo.ts` (`taxaEfetivaMensal`) — os dois por bisseção.
  Sempre "% a.m.", nunca % nominal, nunca "juros"/"CET".
- **Arredondar duas vezes cria empates que não existiam. Arredonde uma vez, no
  fim.** Medido em 14/08: `bidcon_tir_mensal_serie` devolve `round(r, 6)` e a
  trigger `bidcon_price_calcular` grava `round(v_tir * 100, 2)`. A rodada do
  meio empurra `0,0117495…` para `0,011750` — que É o empate — e o empate sobe.
  **23 cartas publicadas com meio centésimo a mais.**
  Dois fatos que só a medição dá, e que mudam a conclusão:
  - **O desvio é sempre PARA CIMA, nunca para baixo.** A coluna publicada nunca
    fica abaixo da verdade. Logo o defeito não escondia carta boa: ele
    **admitia carta cara**. Um fundo pedindo "até 1,00% a.m." recebia 5 cartas
    acima de 1,00%. Medido em seis tetos: "entra só pela coluna" = 2..10;
    "entra só pelo canônico" = **0** em todos.
  - **O motor está exonerado.** Newton cru e bisseção crua concordam a
    6,6e-15; o desvio inteiro (≤ 5,0e-3 p.p.) nasce do arredondamento duplo.
    Não confundir empate fabricado com motor instável.
  Consequência de arquitetura, já em produção: **a coluna crua é pré-filtro
  barato, nunca juiz.** Quem decide é o motor canônico, em memória —
  `dentroDoTeto` (`lib/farol/selecao.ts`) e `peneirarPorCusto`
  (`lib/fidc-vitrine.ts`), os dois filtrando no banco com
  `MARGEM_TETO_VIEW` e **repeneirando** depois. Superfície que compara a coluna
  com um teto sem repeneirar é defeito; superfície que só EXIBE, ORDENA ou
  testa presença (`is not null`) está fora da regra.
- **`ref` NÃO é chave única.** Medido: duas cartas vivas com `ref 779` —
  Magalu e Bradesco, administradoras diferentes. A identidade é o `id` (uuid).
  **Qualquer relatório, `Map`, dedup ou `group by` que use `ref` como chave
  mistura cartas de administradoras diferentes** e o resultado parece certo.
  É o mesmo defeito de identidade que o PR #28 consertou na vitrine, agora
  vivo em relatório. `ref` serve para o humano citar uma carta em conversa —
  e mesmo aí pede a administradora junto.
- **`taxaEfetivaMensal` devolve `null` por dois motivos OPOSTOS:** dado
  faltando, e `parcela × prazo <= saldo` ("paga ≤ que recebe: sem custo").
  Na vitrine os dois viram "—" e tudo bem, porque a carta já foi conferida.
  Em tela de análise/triagem é obrigatório separar `incompleta` de
  `sem_custo` — senão um extrato ilegível e uma cota excelente ficam
  idênticos na tela (o "verde vazio", `09b6434`).
- Administradora exposta no card (pré-requisito da junção).
- Nunca prometer ou sugerir data de contemplação.

## Compliance de linguagem (varrer TODO diff)
PROIBIDO: investimento, investidor, rendimento, retorno, lucro, CDI.
USAR: planejamento, compra programada, carta de crédito, poder de compra, patrimônio.

## Higiene de sessão
- 1 fatia = 1 sessão. /clear ao trocar de tarefa. /compact em marcos, não no teto.
