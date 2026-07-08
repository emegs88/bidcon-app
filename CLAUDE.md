# CLAUDE.md — bidcon-app (Bidcon / Grupo Prospere)

## Governança (inegociável)
- NADA escreve em produção sem autorização nominal DIGITADA do Emerson, por fatia.
- Todo push na main = deploy automático em produção (bidcon.com.br / app.bidcon.com.br).
- Ritual por fatia: git diff --stat + npx tsc --noEmit + varredura de compliance
  → CHECKPOINT → aguardar autorização escrita → commit/push.
- fpg (ACERVO-360, cofre KYC) é INTOCÁVEL. prospere-360 só com fatia própria.
- Migrations: ensaiar no szs antes do xtv. Nunca mudar assinatura de função
  usada em produção (lição do drift de 03/jul).

## Ambientes Supabase
- xtv xtvjpnyadcdeadhmzyff = PROD vitrine (cartas, sync, Bidcon Price)
- nnv nnvjeijsrwpzsggwqpcu = PROD app logado (auth)
- szs szsqdpwwxtmrtrhaikuh = ensaio
- fpg = ACERVO-360: read-only, NUNCA tocar

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
