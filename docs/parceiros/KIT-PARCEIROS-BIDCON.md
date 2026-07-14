# KIT DE EMBARQUE DE PARCEIROS — BIDCON
*Versão 1 · 12/07/2026 · Válido para Servopa, Play Consórcio e futuros parceiros de estoque*

---

## PARTE A — PÁGINA DO PARCEIRO (encaminhar como está)

### Suas cotas na vitrine da Bidcon — e nos assistentes de IA

A Bidcon (bidcon.com.br) é o marketplace de cartas de crédito contempladas da
Prospere Consórcios. As cotas publicadas aparecem no site, no Google (com
preço e disponibilidade), no GPT público da Bidcon no ChatGPT e no conector
da Bidcon para o Claude — atendimento por IA, 24h, com as **melhores
condições sempre no topo** (ranqueamento automático pelo custo efetivo).

### O que enviar

Uma planilha (Excel ou CSV) com **uma linha por cota** e estas colunas
(use o modelo `modelo-cartas-parceiro.csv` anexo):

| Coluna | O que é |
|---|---|
| `tipo` | `imovel` ou `veiculo` |
| `administradora` | Nome da administradora do grupo |
| `credito` | Valor do crédito da carta (R$) |
| `entrada_pedida_vendedor` | **Valor líquido que o vendedor deseja receber de entrada** — sem taxas da Bidcon (a intermediação é acrescentada por nós na publicação) |
| `parcela` | Valor da parcela mensal (R$) |
| `parcelas` | Quantidade de parcelas restantes |
| `cota_grupo_parceiro` | Sua referência interna (grupo/cota) — usada só para conciliação |
| `observacoes` | Livre (situação, prazos, condições) |

Números no formato brasileiro normal (`180.000,00`) funcionam. Pode ser o
export direto do seu sistema — sem formatação especial.

### Como enviar e atualizar

- **E-mail:** contato@bidcon.com.br · **WhatsApp:** (11) 97320-2967
- **Atualizou o estoque? Reenvie a planilha inteira.** Nosso sistema
  identifica sozinho o que é novo, o que mudou e o que já existe — nada
  duplica.
- Cotas vendidas/indisponíveis: basta não constarem no próximo envio, ou
  sinalizar em `observacoes`.

### Regras da casa (transparência)

- A administradora de cada cota fica **sempre visível** ao comprador.
- A Bidcon **nunca promete prazo ou data de contemplação** — as cotas são
  contempladas, e a transferência está sujeita à análise da administradora.
- O pagamento do comprador é protegido por **Conta Notarial** — conta
  vinculada (escrow) no Banco Safra, administrada pelo 5º Tabelionato de
  Notas de Campinas (Provimento CNJ 197/2025): o valor só é liberado ao
  vendedor após a administradora aprovar a transferência.

### Mensagem pronta (para o comercial usar no WhatsApp)

> Fechado! Pra colocar as cotas de vocês na vitrine da Bidcon (site + os
> assistentes de IA que atendem nossos clientes), me manda a lista em
> planilha com estas colunas: tipo (imóvel/veículo), administradora, valor
> do crédito, **entrada líquida que o vendedor quer receber** (nossas taxas
> são somadas por aqui), valor da parcela, parcelas restantes e a referência
> do grupo/cota de vocês. Pode ser export do sistema, sem formatação.
> Sempre que o estoque mudar, é só reenviar a planilha — o sistema
> identifica sozinho o que é novo. As melhores condições sobem pro topo
> automaticamente.

---

## PARTE B — CHECKLIST INTERNO (equipe Bidcon — NÃO encaminhar)

**Regra de ouro (fantasma dos 7%):** o importador grava a entrada
EXATAMENTE como está na planilha — ele **não** soma comissão. A conta é
passo humano, uma vez por lote, antes do import:

1. **Receber e conferir** a planilha do parceiro (valores absurdos, colunas
   trocadas, entrada ≥ crédito — o preview bloqueia, mas conferir antes
   poupa retrabalho).
2. **Criar a coluna `entrada`** (a que o sistema lê) com a fórmula:
   `entrada = entrada_pedida_vendedor + 0,07 × credito`
   No modelo (colunas C=credito, D=entrada_pedida): célula `=D2+0,07*C2`,
   arrastar para baixo.
3. **Cabeçalhos que o sistema lê:** `tipo`, `administradora`, `credito`,
   `entrada`, `parcela`, `parcelas`. As colunas `entrada_pedida_vendedor`,
   `cota_grupo_parceiro` e `observacoes` são ignoradas pelo importador
   (de propósito — a referência do parceiro NÃO deve virar ref pública).
   **Nunca** renomear colunas para `ref`, `numero`, `n` ou `id`.
4. **Importar:** /admin/importar → colar ou subir o arquivo → conferir o
   preview (nova / alterada / já existe / rejeitada + aviso de TIR) →
   **Publicar**.
5. **Refs de curadoria (faixa 9xxx):** enquanto a fatia IMPORTADOR-REF-01
   não automatiza, as cartas novas do importador nascem sem ref. Após
   publicar, pedir na janela de chat: *"AUTORIZO refs de curadoria"* — o
   backfill atribui os próximos números da faixa 9000–9999.
6. **Conferir na vitrine:** as melhores condições sobem sozinhas (ordenação
   canônica pelo custo efetivo desde a migration 0043). Custo alto demais?
   O Bidcon Price está só sendo honesto — renegociar a entrada com o
   parceiro é o remédio.

**Fatias futuras já registradas no ledger:**
- `IMPORTADOR-COMISSAO-01` — toggle no importador: "entrada informada é a
  pedida pelo vendedor → somar intermediação automaticamente" (mata o
  passo 2 manual).
- `IMPORTADOR-REF-01` — ref automático da faixa 9xxx na publicação (mata o
  passo 5 manual). Já em fila na janela Code.

