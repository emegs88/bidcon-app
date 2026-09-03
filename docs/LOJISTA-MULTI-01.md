# LOJISTA-MULTI-01 — lojas parceiras por link

Página por loja em `/bidcon-lojista/<slug>` e índice em `/bidcon-lojista/lojas`,
servidos por `public/bidcon-lojista/loja.html` (rewrite no `vercel.json`).
A loja vem de `public/bidcon-lojista/lojas.json`; o estoque, do snapshot da
loja (`<slug>.json`) ou do motor 360prospere `/api/estoque` (WooCommerce ao
vivo); as cartas, de `app.bidcon.com.br/api/vitrine` (valores finais).

## Adicionar uma loja — só com o link

**Webmotors** (a API só responde a navegador — medido em 02/09/2026):
1. Abra a página da loja no Chrome, F12 → Console, cole `scripts/lojista-snapshot.js`.
2. Responda link, slug, nome e cidade. Baixa `<slug>.json`; salve em `public/bidcon-lojista/`.
3. Cole em `lojas.json` a entrada impressa no console. Commit, PR, merge (clique do Emerson).

**WooCommerce**: só a entrada em `lojas.json` com `"url"` da loja e sem `"snapshot"` —
o motor lê ao vivo.

Atualizar o estoque de uma loja Webmotors = repetir o passo 1–2 (substitui o `.json`).

## Regra de encaixe (palavra do Emerson, 02/09/2026)
Cotas só da mesma administradora, quantas precisar (teto 4); saldo devedor
somado ≤ FIPE; menor custo TIR; score = TIR ponderada + 0,10 p.p./cota extra
+ 0,05 p.p. por 1% de sobra. FIPE-01: sem FIPE confiável → "FIPE a confirmar",
régua = preço; índice preço/FIPE > 150% → veículo de coleção, sem encaixe.
