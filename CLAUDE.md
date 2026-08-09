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
- Comissão 7% do crédito somada à entrada (exceto LANCE: já embutida na origem).
- Custo financeiro = TIR ao mês (Newton-Raphson). Nunca % nominal.
- Administradora exposta no card (pré-requisito da junção).
- Nunca prometer ou sugerir data de contemplação.

## Compliance de linguagem (varrer TODO diff)
PROIBIDO: investimento, investidor, rendimento, retorno, lucro, CDI.
USAR: planejamento, compra programada, carta de crédito, poder de compra, patrimônio.

## Higiene de sessão
- 1 fatia = 1 sessão. /clear ao trocar de tarefa. /compact em marcos, não no teto.
