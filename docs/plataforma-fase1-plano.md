# Plataforma Bidcon — Fase 1 (Área do cliente) · PLANO para aprovação

> Artefato de PLANEJAMENTO. Nada aqui foi executado: nenhum código de Fase 1
> escrito, nenhum projeto Supabase/Vercel tocado, nenhuma chave usada. Aguarda OK
> do Emerson. Depende de a Fase 0 estar de pé (migrations rodadas + .env preenchido).

## Objetivo
Dar ao **cliente** logado uma tela onde ele acompanha o andamento do processo de
compra da carta contemplada, sem nunca prometer data de contemplação.

---

## 1. Pré-requisitos (travados no Emerson)
- [ ] Projeto Supabase criado e migrations `0001`/`0002` aplicadas.
- [ ] `.env.local` da Vercel com `NEXT_PUBLIC_SUPABASE_URL` + `ANON_KEY`.
- [ ] Pelo menos 1 `profile` cliente + 1 `processo` de teste (seed) para validar.
- DNS `app.bidcon.com.br` ajuda, mas não bloqueia o dev local.

## 2. Telas / rotas (todas dentro de `platform/`)
| Rota | O que faz |
|---|---|
| `/login` | já existe (Fase 0, magic link). Sem mudança estrutural. |
| `/` | já existe ("Olá, {nome}"). Vira **hub**: link para "Meu processo". |
| `/meu-processo` | **NOVA** — timeline de status + dados da carta + histórico. |

Sem rotas de parceiro/admin nesta fase (ficam para a Fase 2).

## 3. `/meu-processo` — conteúdo
1. **Timeline visual** dos 5 status reais:
   `reservada → documentação → análise (administradora) → transferência → concluído`
   - estado atual destacado; anteriores marcados como concluídos; futuros em cinza.
   - estado `cancelado` mostra aviso neutro ("processo encerrado"), fora da régua.
   - **NUNCA** texto de data/garantia de contemplação (ver §6 compliance).
2. **Dados da carta** vinculada (via `processos.carta_id`): tipo (imóvel/veículo),
   valor de crédito, valor de entrada — somente leitura.
3. **Histórico de mudanças** (lista do que já avançou). Fonte de dados: ver §4.
4. Estado vazio: se o cliente não tem processo, mensagem amigável + WhatsApp de
   atendimento (mesmo número do site).

## 4. Dados e leitura (RLS faz o filtro)
- Cliente lê **apenas** seus próprios processos (policy `processos_select_envolvidos`
  já criada na migration 0002: `cliente_id = auth.uid()`).
- Leitura via Server Component com o client de servidor (`lib/supabase-server.ts`),
  que respeita a sessão e a RLS — cliente nunca vê processo de outro.
- **Histórico de mudanças:** o schema atual NÃO tem tabela de histórico. Duas opções
  (a decidir com o Emerson):
  - **(A) Mínimo agora:** mostrar só `status` atual + `atualizado_em`. Zero schema novo.
  - **(B) Histórico real (migration 0003):** nova tabela `processo_eventos`
    (`processo_id`, `de_status`, `para_status`, `em`, `nota`) preenchida server-side
    quando o admin muda o status (Fase 2). Recomendo (B), mas a tabela só passa a
    ter linhas quando a Fase 2 existir; até lá a tela cai no comportamento (A).
- **Mudança de status é sempre server-side** (admin/Fase 2). O cliente só LÊ — nenhuma
  policy de UPDATE para o client.

## 5. Componentes a criar (sem libs visuais novas; CSS inline simples)
- `app/meu-processo/page.tsx` — Server Component: busca processo + carta, renderiza.
- `app/meu-processo/Timeline.tsx` — Client/Server Component de apresentação da régua.
- (se opção B) `supabase/migrations/0003_processo_eventos.sql` — tabela + RLS
  (cliente SELECT-only dos eventos dos próprios processos; insert server-side).
- Pequeno helper de labels de status PT-BR (mapa enum→texto humano).

## 6. Compliance (recheca em cada string da tela)
- Régua descreve o **processo real**; `analise_administradora`/`transferencia` ok.
- Proibido: investimento, investidor, rendimento, garantido (exceto negação);
  "aprovação/limite de crédito"; promessa de data ou de contemplação.
- Rótulos sugeridos (revisáveis): "Reservada", "Documentação", "Em análise",
  "Transferência", "Concluído". Nada de "aprovado"/"garantido".

## 7. Verificação planejada (antes de qualquer commit de Fase 1)
- `npm run build` (type-check) passa localmente.
- Com seed: cliente A vê só o processo A; cliente B não vê o de A (teste RLS).
- Grep de termos proibidos nas telas novas = 0 (exceto negação).
- Sem chave secreta em nenhum arquivo; `.env*` continua no `.gitignore`.
- Commit separado `feat(platform): Fase 1 — área do cliente`.

## 8. Decisões que preciso de você (destravam a Fase 1)
1. **Histórico:** opção (A) só status atual, ou (B) tabela `processo_eventos` (recomendo B)?
2. **Rótulos PT-BR** dos 5 status: usar os sugeridos no §6 ou ajustar?
3. **Seed de teste:** você cria 1 cliente+processo no Supabase, ou quero um script
   SQL de seed (sem dados reais) junto?
4. Confirmar que a Fase 1 roda só em **dev local** por enquanto (deploy do app só
   quando o DNS `app.bidcon.com.br` estiver pronto).

## 9. O que o agente NÃO fará na Fase 1
- Não loga em Supabase/Vercel, não roda migration em conta real.
- Não põe chave no repo. Não move dinheiro (não há comissão nesta fase).
- Não cria telas de parceiro/admin (Fase 2). Não promete contemplação.
