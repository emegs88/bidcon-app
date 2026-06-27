# Plataforma Bidcon (área logada) — Documento de Arquitetura

> Artefato de PLANEJAMENTO para aprovação (seção 10 do briefing). Nada aqui foi
> executado: nenhum projeto Supabase/Vercel criado, nenhuma credencial usada,
> nenhuma chave no repositório. Aguarda OK do Emerson antes de qualquer código.
>
> Decisões já tomadas nesta rodada:
> - **Quando:** só planejar agora (não montar Fase 0 ainda).
> - **Login cliente:** decidir na fase de telas — o schema prevê os DOIS caminhos
>   (convite/magic link E auto-cadastro) sem se comprometer.
> - **Dados financeiros do parceiro:** RLS estrito + **sem dado bancário** no banco
>   da plataforma. PIX/transferência ficam por fora; a plataforma só rastreia status.
> - **Política de privacidade:** rascunho preparado em paralelo (commit separado).

---

## 1. Conexão site público ↔ app logado

**Recomendação: `app.bidcon.com.br` (subdomínio), projeto Vercel separado.**

Por quê (não `/app` no mesmo projeto):
- O site é pure-static com `cleanUrls:true`, `trailingSlash:false`, `outputDirectory:public`,
  sem build step, e tem CSP própria. Pôr um Next.js dinâmico em `/app` no mesmo deploy
  obrigaria a misturar build + estático e relaxar/duplicar a CSP.
- Subdomínio = deploy/rollback independentes, CSP e cookies de sessão isolados.
  O site de marketing continua intocado.

Ponto de contato: um link **"Entrar"** no header do site público → `https://app.bidcon.com.br`.
Sem SSO entre os dois (não é necessário). DNS (CNAME) é criado pelo Emerson.

```
bidcon.com.br            → Vercel projeto A (estático atual, intocado)
app.bidcon.com.br        → Vercel projeto B (Next.js + Supabase) [NOVO, futuro]
360prospere.vercel.app   → API Next.js existente (lead/cotas) [inalterada]
```

---

## 2. Stack (confirmada, sem divergência)

| Camada | Escolha |
|---|---|
| Frontend app | Next.js (App Router) |
| Auth + Banco | Supabase (Postgres + Auth + RLS) |
| Hospedagem | Vercel (projeto separado) |
| Segurança linha | Supabase RLS em TODAS as tabelas |

Segredos: `anon key` pode ir ao frontend; **`service_role key` só em env var de servidor**,
nunca no repo nem no client. `.gitignore` cobre `.env*`.

---

## 3. Schema (migrations SQL comentadas — rascunho para revisão)

Enums primeiro, depois tabelas. `profiles` estende `auth.users` do Supabase.

```sql
-- ENUMS
create type tipo_perfil   as enum ('cliente','parceiro','admin');
create type status_perfil as enum ('ativo','pendente_aprovacao','suspenso');
create type status_processo as enum
  ('reservada','documentacao','analise_administradora','transferencia','concluido','cancelado');
create type tipo_bem      as enum ('imovel','veiculo');
create type status_carta  as enum ('disponivel','reservada','vendida');
create type status_comissao as enum ('prevista','liberada','paga','cancelada');

-- PROFILES (1:1 com auth.users)
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text,
  telefone    text,
  email       text,
  tipo        tipo_perfil   not null default 'cliente',
  status      status_perfil not null default 'ativo',  -- parceiro vira 'pendente_aprovacao' no cadastro
  criado_em   timestamptz   not null default now()
);

-- CARTAS (carteira do parceiro + estoque Bidcon quando parceiro_id is null)
create table cartas (
  id            uuid primary key default gen_random_uuid(),
  parceiro_id   uuid references profiles(id) on delete set null,
  tipo          tipo_bem     not null,
  valor_credito numeric(14,2) not null,
  valor_entrada numeric(14,2),
  status        status_carta not null default 'disponivel',
  criado_em     timestamptz  not null default now()
);

-- PROCESSOS (jornada de compra do cliente)
create table processos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references profiles(id) on delete restrict,
  parceiro_id   uuid references profiles(id) on delete set null,  -- quem indicou/vendeu
  carta_id      uuid references cartas(id)   on delete set null,
  status        status_processo not null default 'reservada',
  valor_carta   numeric(14,2),
  valor_entrada numeric(14,2),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- INDICACOES (rastreio de quem indicou)
create table indicacoes (
  id          uuid primary key default gen_random_uuid(),
  parceiro_id uuid not null references profiles(id) on delete cascade,
  cliente_id  uuid references profiles(id) on delete set null,
  origem      text,  -- link/código de indicação
  criado_em   timestamptz not null default now()
);

-- COMISSOES (sem dado bancário — decisão: plataforma só rastreia)
create table comissoes (
  id            uuid primary key default gen_random_uuid(),
  parceiro_id   uuid not null references profiles(id) on delete restrict,
  processo_id   uuid not null references processos(id) on delete cascade,
  percentual    numeric(5,2),
  valor_base    numeric(14,2),
  valor_comissao numeric(14,2),
  status        status_comissao not null default 'prevista',
  liberada_em   timestamptz   -- preenchido quando processo conclui
);
```

Observações:
- **Sem chave PIX / dado bancário** em nenhuma tabela (decisão desta rodada).
- `prevista → liberada` será disparado por trigger/lógica de servidor quando o
  `processos.status` virar `concluido` — detalhado na Fase 3 (depende dos números da seção 6 do briefing).
- Login cliente: o schema serve tanto para magic link (perfil criado pela Prospere
  e vinculado ao processo) quanto para auto-cadastro (perfil cria-se e depois vincula).
  A escolha fica para a fase de telas.

---

## 4. Matriz de RLS (políticas por tabela)

`enable row level security` em TODAS. Helper: `auth.uid()` = id do usuário logado;
`is_admin()` = função `security definer` que checa `profiles.tipo='admin'`.

| Tabela | cliente | parceiro | admin |
|---|---|---|---|
| `profiles` | SELECT/UPDATE só o próprio (`id = auth.uid()`) | idem próprio | tudo |
| `processos` | SELECT só onde `cliente_id = auth.uid()` | SELECT só onde `parceiro_id = auth.uid()` | tudo (inclui UPDATE de status) |
| `cartas` | — (não vê) | SELECT/INSERT/UPDATE só `parceiro_id = auth.uid()` | tudo |
| `indicacoes` | — | SELECT só `parceiro_id = auth.uid()` | tudo |
| `comissoes` | — | **SELECT-only** onde `parceiro_id = auth.uid()` | tudo (libera/marca paga) |

Princípios:
- Parceiro **nunca** dá `UPDATE` em `comissoes` (evita auto-liberação) — só leitura.
- Mudança de `status` de processo e de comissão = **server-side** com `service_role`
  (rota protegida), nunca direto do client.
- Estoque Bidcon (`cartas.parceiro_id is null`) visível publicamente? **NÃO** pela
  plataforma logada — o marketplace público continua no site estático. (A decidir se
  algum dia o app logado expõe estoque; fora de escopo agora.)

---

## 5. Esqueleto de telas por fase (wireframe textual)

### FASE 0 — Fundação (pré-requisito)
- Projeto Supabase (auth + tabelas + RLS) + projeto Next.js vazio na Vercel.
- Sem telas de negócio; só login/logout funcionando e um "Olá, {nome}".

### FASE 1 — Área do cliente
- `/login` (Supabase Auth UI).
- `/meu-processo` — timeline visual de status:
  `reservada → documentação → análise → transferência → concluído`
  (estado atual destacado; nunca promete data de contemplação).
- `/meu-processo` mostra dados da carta (tipo, crédito, entrada) e histórico de mudanças.

### FASE 2 — Parceiro (básico) + Admin
- `/parceiro/cadastro` → perfil nasce `pendente_aprovacao`.
- `/admin/parceiros` → aprovar/recusar/suspender.
- `/admin/processos` → ver todos, mudar status.
- `/parceiro/cartas` → CRUD das próprias cartas.
- `/parceiro/indicar` → link/código de indicação.
- Sem cálculo de comissão ainda — só rastreio.

### FASE 3 — Comissão + Dashboard
- Lógica `prevista → liberada` no gatilho `concluido` (server-side).
- `/parceiro/dashboard` → indicações, vendas, comissões previstas/liberadas/pagas.
- `/admin/comissoes` → liberar / marcar como paga (pagamento feito por fora).
- **Bloqueado até** Emerson definir percentual/base/teto/escalonamento/quem libera (seção 6).

---

## 6. Compliance (vale na plataforma toda)
- Nenhuma tela/status/e-mail/notificação promete data de contemplação.
- Proibidos em qualquer texto: investimento, investidor, rendimento, garantido
  (exceto negação explícita).
- `analise_administradora` / `transferencia` descrevem o processo real — ok.
  Nunca redigir como "aprovação garantida".

---

## 7. Pendências que travam fases (do briefing, seção 11)
- [ ] Percentual e base de comissão; teto/piso/escalonamento → trava Fase 3.
- [ ] Liberação de comissão automática vs. manual → trava Fase 3.
- [ ] Confirmar: plataforma NÃO movimenta dinheiro, só rastreia status `paga`.
- [ ] Contrato de parceiro + tratamento fiscal (Valdemir/Ebenezer) — jurídico, fora do software.
- [ ] DNS `app.bidcon.com.br` (Emerson).

## 8. O agente NÃO fez / NÃO fará sem OK
- Não criou conta Supabase/Vercel, não logou em nada.
- Não pôs nenhuma chave (anon/service_role) no repo.
- Não escreveu código de app ainda — só este plano.
- Não move dinheiro em hipótese alguma.
