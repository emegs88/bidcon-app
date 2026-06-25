# bidcon

Marketplace de **cotas contempladas** da Prospere Consórcios (Grupo Âncora).
Site **estático** e **independente** do 360 — mas os dados continuam vindo dele.

```
bidcon.com.br/                 → marketplace (index.html)
bidcon.com.br/bidcon-lojista   → veículos × cartas + simulador FIPE
bidcon.com.br/bidcon-imobiliaria → imóveis × cartas
```

## Como os dados chegam aqui

A bidcon não tem banco nem API próprios. Ela lê tudo do projeto **360**
(`https://360prospere.vercel.app`), que é a fonte única de verdade:

| Dado | Origem no 360 |
|------|----------------|
| Cotas contempladas | `/cotas.js` (`window.PROSPERE_COTAS`) |
| Estoque de veículos | `/api/estoque` |
| Tabela FIPE | `/api/fipe` |
| Imóveis das imobiliárias | `/api/imoveis` |

Para mudar a origem dos dados, edite **uma linha** em `public/config.js`:

```js
window.BIDCON_API = 'https://360prospere.vercel.app';
```

> O 360 libera CORS nesses endpoints (`next.config.mjs`), então a bidcon pode
> lê-los de outro domínio. Atualizou cotas no 360? A bidcon reflete na hora.

## Publicar (passo a passo)

1. **Criar o repositório** (no GitHub):
   - `git init && git add -A && git commit -m "bidcon: site estático"`
   - crie um repo novo (ex.: `bidcon`) e dê `git push`.
2. **Importar no Vercel**: New Project → selecione o repo `bidcon`.
   - Framework: **Other** · Output Directory: `public` (já está no `vercel.json`).
3. **Apontar o domínio** `bidcon.com.br`:
   - No Vercel: Project → **Settings → Domains** → adicione `bidcon.com.br` e `www.bidcon.com.br`.
   - No **registro.br** (zona DNS do domínio):
     - **A** `@` → `76.76.21.21`
     - **CNAME** `www` → `cname.vercel-dns.com`
   - O Vercel emite o HTTPS automaticamente em alguns minutos.

Pronto: `bidcon.com.br` abre o marketplace na raiz; veículos e imóveis nas subpáginas.

## Desenvolvimento local

É só HTML. Sirva a pasta `public/` com qualquer servidor estático:

```bash
npx serve public
# ou
python3 -m http.server -d public 3000
```

Os dados virão do 360 em produção (via `config.js`). Localmente funciona igual,
desde que o 360 esteja no ar.
