# Teste manual — Reserva de carta (DEV)

Roteiro end-to-end pra validar o fluxo de reserva (commit `5e258f7`). **Só DEV**
(`fpgimirtiryivnrjdyxb`). Nada de PROD/push. Você roda os SQLs; eu não opero o banco.

Arquivos do fluxo:
- `supabase/migrations/0009_reserva.sql` — RPC `reservar_carta` (gates + escrita atômica)
- `app/api/reservar/route.ts` — rota fina (client RLS → RPC)
- `app/reservar/page.tsx` + `ReservarWizard.tsx` — gate de KYC + wizard 3 passos
- CTA em `app/cartas/[id]/page.tsx` e item "Reservar" no `ShellNav`

---

## 0) Pré-requisitos (uma vez)

1. **Aplicar a migration no DEV** (SQL editor do Supabase DEV):
   - cole e rode o conteúdo de `supabase/migrations/0009_reserva.sql`.
   - sanity: a função existe?
     ```sql
     select proname from pg_proc where proname = 'reservar_carta';
     ```

2. **Seed presente?** As cartas de teste vêm de `supabase/seed_dev.sql`
   (numero_externo 900001–900014 `disponivel`). Confirme:
   ```sql
   select numero_externo, tipo, valor_credito, status
     from cartas where numero_externo in (900001, 900010) order by numero_externo;
   ```
   Esperado: 900001 (veiculo, 55000, disponivel) e 900010 (imovel, 180000, disponivel).

3. **Subir o app:** `npm run dev` em `platform/`.

---

## 1) Cliente de teste com KYC = verificado

A reserva exige `status_kyc = 'verificado'`. Caminho de produto: cliente faz `/kyc`,
admin verifica em `/admin/perfis/[id]`. Pra teste rápido em DEV, dá pra forçar por SQL.

1. Crie/entre com um cliente comum (cadastro `/cadastro` → confirma e-mail → login).
2. Pegue o `user_id` dele:
   ```sql
   select id, email, tipo, status from profiles where email = 'SEU_EMAIL_DE_TESTE';
   ```
3. Garanta a linha de KYC e marque verificado (**DEV-only**, atalho de teste):
   ```sql
   insert into kyc_perfis (user_id, status_kyc)
   values ('UID_DO_CLIENTE', 'verificado')
   on conflict (user_id) do update set status_kyc = 'verificado';
   ```
   > Em produto real isso é feito pelo admin via RPC `kyc_decidir` — aqui é só agilizar o teste.

---

## 2) Caminho feliz (pela tela)

1. Logado como o cliente verificado, abra **`/cartas`** → clique numa carta (ex.: 900001).
2. No detalhe, clique **"Reservar esta carta"** → cai em `/reservar?carta=<id>` já no **passo 2**.
3. Confira o resumo (crédito da carta / recursos próprios). **Nenhuma** menção a
   administradora/taxa/fundo. Clique **"Confirmar reserva ✓"**.
4. Passo 3 "Reserva iniciada!" → clique **"Acompanhar meu processo →"** (`/meu-processo`).
   - O processo deve aparecer com status **Reservada** e a timeline com o 1º evento.
5. Volte em **`/cartas`**: a carta reservada **saiu da vitrine** (não aparece mais como disponível).

---

## 3) Conferência por SQL (o que a RPC gravou)

Use o `user_id` do cliente.

1. **Processo criado** (valores copiados da carta; sem taxa/fundo):
   ```sql
   select p.id, p.status, p.valor_carta, p.valor_entrada, c.numero_externo
     from processos p
     join cartas c on c.id = p.carta_id
    where p.cliente_id = 'UID_DO_CLIENTE'
    order by p.criado_em desc limit 1;
   ```
   Esperado: `status = 'reservada'`, `valor_carta`/`valor_entrada` iguais aos da carta.

2. **Evento inicial da timeline** (`de_status` null = criação):
   ```sql
   select de_status, para_status, nota, em
     from processo_eventos
    where processo_id = 'PROCESSO_ID_ACIMA'
    order by em;
   ```
   Esperado: 1 linha → `de_status = NULL`, `para_status = 'reservada'`,
   `nota = 'Reserva iniciada pelo cliente.'`.

3. **Carta saiu da vitrine:**
   ```sql
   select numero_externo, status from cartas where id = 'CARTA_ID';
   ```
   Esperado: `status = 'reservada'`.

---

## 4) Testes negativos (as travas)

1. **Idempotência** — reservar a MESMA carta de novo (mesmo cliente) deve devolver o
   processo já existente, sem duplicar. Repita o passo 2 da seção 2 e confira que NÃO
   surge um 2º `processos`:
   ```sql
   select count(*) from processos
    where cliente_id = 'UID_DO_CLIENTE' and carta_id = 'CARTA_ID' and status <> 'cancelado';
   ```
   Esperado: `1`.

2. **Carta indisponível** — tentar reservar uma carta que já está `reservada`/`vendida`
   (por outro cliente) deve falhar com **409** ("Não foi possível reservar esta carta agora.").
   Simule pegando uma carta `reservada` e chamando a rota direto:
   ```bash
   # logado no navegador; pegue uma CARTA_ID com status 'reservada'
   curl -X POST http://localhost:3000/api/reservar \
     -H 'content-type: application/json' \
     --cookie "<cookies da sessão>" \
     -d '{"carta_id":"CARTA_ID_RESERVADA"}'
   ```
   Esperado: HTTP 409.

3. **KYC não verificado** — com um cliente cujo `status_kyc` ≠ verificado, abrir `/reservar`
   deve mostrar o estado de bloqueio (CTA pra `/kyc` ou acompanhar), **sem** grade de cartas.
   Pra cobrir o servidor, chame a rota direto e espere **409**:
   ```sql
   update kyc_perfis set status_kyc = 'pendente' where user_id = 'UID_DO_CLIENTE';
   ```
   (depois volte pra `verificado` se for repetir o caminho feliz).

4. **Não autenticado** — POST sem sessão → **401** ("Não autenticado.").

5. **carta_id inválido** — body sem `carta_id` → **422** ("Carta inválida.").

---

## 5) Limpeza (reset pra repetir o teste)

```sql
-- apaga o processo de teste e seus eventos (cascade), e devolve a carta à vitrine
delete from processos where cliente_id = 'UID_DO_CLIENTE' and carta_id = 'CARTA_ID';
update cartas set status = 'disponivel' where id = 'CARTA_ID';
```

---

## Checklist de compliance (revisão visual)

- [ ] Em nenhuma tela de cliente aparece **administradora / taxa / fundo** nem nome de adm.
- [ ] Nenhuma promessa de contemplação (o aviso do passo 2 fala em cota **já contemplada**).
- [ ] CPF nunca exibido no fluxo de reserva.
- [ ] `tsc --noEmit` e `next build` limpos (já validado no commit `5e258f7`).
