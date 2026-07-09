# IndexNow — ping de indexação (Bing/Yandex/Seznam etc.)

## Chave hospedada

- Chave: `60173d06f3ebda16cc9c1879f52a1285`
- Arquivo: `public/60173d06f3ebda16cc9c1879f52a1285.txt` (conteúdo = a chave, sem quebra de linha)
- URL pública: https://www.bidcon.com.br/60173d06f3ebda16cc9c1879f52a1285.txt (deve responder 200 com a chave crua)

A chave é permanente — não precisa gerar uma nova a cada ping. Se algum dia
precisar trocar, gere com `openssl rand -hex 16` (8-128 chars hex são aceitos
pelo protocolo) e hospede o novo arquivo em `public/`.

## Quando pingar

Só quando uma página **mudar de conteúdo de verdade** (landing nova, post novo
no blog, alteração relevante de copy/preço/serviço). **Não** pingar a cada
deploy de código/CSS/JS que não muda o conteúdo indexável.

## Comando

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json" \
  -d '{"host":"www.bidcon.com.br","key":"60173d06f3ebda16cc9c1879f52a1285","keyLocation":"https://www.bidcon.com.br/60173d06f3ebda16cc9c1879f52a1285.txt","urlList":["https://www.bidcon.com.br/PAGINA-1","https://www.bidcon.com.br/PAGINA-2"]}'
```

Substitua `urlList` pelas URLs que de fato mudaram nesse deploy (máximo
recomendado: 10.000 URLs por chamada, mas normalmente será só 1-3 páginas).

## Resposta esperada

- `200` ou `202` → aceito.
- `400` → JSON malformado.
- `403` → chave não confere com o arquivo hospedado (verificar `keyLocation`).
- `422` → URLs não pertencem ao host informado, ou `urlList` vazia.
- `429` → muitos pings, esperar antes de tentar de novo.

## Teste realizado (referência)

Ping de teste rodado em produção após o deploy da chave, cobrindo `/`,
`/conta-notarial` e `/repasse` — resposta `202 Accepted`.
