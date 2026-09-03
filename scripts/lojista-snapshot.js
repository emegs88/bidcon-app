// ============================================================================
// LOJISTA-MULTI-01 — captura do snapshot de estoque de uma loja pelo LINK.
// AUTORIZADO: Emerson Gomes dos Santos — "pode fazer o melhor", 03/09/2026.
// ----------------------------------------------------------------------------
// POR QUE RODA NO NAVEGADOR: a API de busca da Webmotors responde 403 a
// qualquer chamada de servidor (medido em 02/09/2026, inclusive de IP
// residencial) — só a sessão do navegador, com o anti-bot dela, passa. Então
// o snapshot nasce onde a API responde: no console do Chrome, na página da
// loja. Loja WooCommerce NÃO precisa disto — o motor lê ao vivo.
//
// COMO USAR (1 minuto):
//   1. Abra no Chrome a página da loja na Webmotors (link com idrevendedor).
//   2. F12 → Console → cole este arquivo inteiro → Enter.
//   3. Responda o prompt com o link da loja (ou aceite o da aba) e o slug.
//   4. O navegador baixa <slug>.json. Salve em public/bidcon-lojista/.
//   5. Cole no lojas.json a entrada impressa no console. Commit + PR.
//
// FIPE-01: para anúncios sem FipePercent (zero-km), tenta a tabela FIPE
// (parallelum, mesma fonte da /api/fipe do motor) casando marca/modelo/ano por
// aproximação; grava fipe_fonte = "webmotors" | "tabela-fipe" | "" (a página
// marca "FIPE a confirmar" quando vazio). Coleção (índice > 150%) fica para a
// página tratar — o snapshot só registra o índice.
// ============================================================================
(async function lojistaSnapshot() {
  const WM_API = 'https://www.webmotors.com.br/api/search/car';
  const WM_IMG = 'https://image.webmotors.com.br/_fotos/anunciousados/gigante/';
  const FIPE = 'https://parallelum.com.br/fipe/api/v1/carros/marcas';

  const url = (prompt('Link da loja na Webmotors:', location.href) || '').trim();
  const rev = (url.match(/idrevendedor=(\d+)/) || url.match(/-(\d{5,})(?:\?|$)/) || [])[1];
  if (!rev) { alert('Não achei o idrevendedor no link.'); return; }
  const slug = (prompt('Slug da loja (letras, números e hífen):', 'nome-da-loja') || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) { alert('Slug inválido.'); return; }
  const nome = (prompt('Nome da loja:', document.title.split(' carros ')[0].trim()) || '').trim();
  const cidade = (prompt('Cidade (UF):', 'São Paulo (SP)') || '').trim();

  const tc = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());
  const val = (o) => (o && typeof o === 'object' ? o.Value : o) || '';
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  // 1) estoque, paginado
  const anuncios = [];
  for (let page = 1; page <= 10; page++) {
    const q = new URLSearchParams({ url, actualPage: String(page), displayPerPage: '48', order: '1', showMenu: 'false', showCount: 'true', showBreadCrumb: 'false', testAB: 'false', returnUrl: 'false' });
    const j = await (await fetch(`${WM_API}?${q}`)).json();
    const arr = (j && j.SearchResults) || [];
    anuncios.push(...arr);
    if (arr.length < 48 || anuncios.length >= (j.Count || 0)) break;
  }
  if (!anuncios.length) { alert('Nenhum anúncio veio da API — a página está logada/carregada?'); return; }

  // 2) tabela FIPE (só para quem não tem índice)
  let marcas = null, ultimoModeloFipe = '';
  async function fipeTabela(marca, modelo, versao, anoModelo) {
    try {
      marcas = marcas || await (await fetch(FIPE)).json();
      // A tabela grafa algumas marcas do seu jeito ("GM - Chevrolet", "VW - VolksWagen",
      // "Kia Motors"); sem o alias o Corvette ficou sem FIPE na captura de 03/09/2026.
      const ALIAS = { chevrolet: 'gm chevrolet', volkswagen: 'vw volkswagen', kia: 'kia motors', 'mercedes benz': 'mercedes benz', 'land rover': 'land rover', byd: 'byd' };
      const alvoMarca = ALIAS[norm(marca)] || norm(marca);
      const m = marcas.find((x) => norm(x.nome) === alvoMarca) || marcas.find((x) => norm(x.nome) === norm(marca)) || marcas.find((x) => norm(x.nome).includes(norm(marca).split(' ')[0]));
      if (!m) return 0;
      const mods = (await (await fetch(`${FIPE}/${m.codigo}/modelos`)).json()).modelos || [];
      const alvo = norm(modelo + ' ' + versao).split(' ');
      let best = null, bestScore = 0;
      for (const md of mods) {
        const t = norm(md.nome).split(' ');
        const score = alvo.filter((w) => t.includes(w)).length + (norm(md.nome).startsWith(norm(modelo)) ? 2 : 0);
        if (score > bestScore) { bestScore = score; best = md; }
      }
      if (!best || bestScore < 3) return 0;
      const anos = await (await fetch(`${FIPE}/${m.codigo}/modelos/${best.codigo}/anos`)).json();
      const a = anos.find((x) => String(x.nome).startsWith(String(anoModelo))) || anos.find((x) => /zero/i.test(x.nome)) || anos[0];
      if (!a) return 0;
      const v = await (await fetch(`${FIPE}/${m.codigo}/modelos/${best.codigo}/anos/${a.codigo}`)).json();
      const n = Number(String(v.Valor || '').replace(/[^\d,]/g, '').replace(',', '.'));
      // registra QUAL modelo da tabela casou — sem isso a FIPE aproximada não é auditável
      ultimoModeloFipe = `${v.Marca} ${v.Modelo} ${v.AnoModelo}`;
      return Number.isFinite(n) && n > 0 ? Math.round(n / 100) * 100 : 0;
    } catch { return 0; }
  }

  // 3) normaliza no contrato do motor
  const veiculos = [];
  for (const a of anuncios) {
    const spec = a.Specification || {};
    const fotos = ((a.Media && a.Media.Photos) || []).slice().sort((x, y) => (x.Order || 0) - (y.Order || 0)).map((f) => WM_IMG + f.PhotoPath);
    const preco = Number((a.Prices && a.Prices.Price) || 0);
    const pct = Number(a.FipePercent || 0);
    const marca = tc(val(spec.Make)), modelo = tc(val(spec.Model)), versao = tc(val(spec.Version));
    const anoFab = Number(spec.YearFabrication) || 0, anoMod = Number(spec.YearModel) || anoFab;
    let fipe = 0, fipe_fonte = '', fipe_modelo = '';
    if (pct > 0) { fipe = Math.round((preco * 100) / pct / 100) * 100; fipe_fonte = 'webmotors'; }
    else if (!pct) { ultimoModeloFipe = ''; fipe = await fipeTabela(marca, modelo, versao, anoMod); if (fipe) { fipe_fonte = 'tabela-fipe'; fipe_modelo = ultimoModeloFipe; } }
    veiculos.push({ id: String(a.UniqueId), nome: `${marca} ${modelo} ${versao}`.replace(/\s+/g, ' ').trim(), preco, ano: anoMod, ano_fab: anoFab, km: Number(val(spec.Odometer)) || 0, sku: '', link: `https://www.webmotors.com.br/comprar/${a.UniqueId}`, img: fotos[0] || '', fotos, fipe, fipe_pct: pct, fipe_fonte, fipe_modelo, categorias: [marca], estoque: true });
  }

  const snap = { ok: true, custom: true, parceiro: 'webmotors.com.br', fonte: url, revendedor: rev, atualizado: new Date().toISOString(), origem: 'snapshot via navegador (scripts/lojista-snapshot.js)', total: veiculos.length, veiculos };
  const blob = new Blob([JSON.stringify(snap, null, 1)], { type: 'application/json' });
  const aEl = document.createElement('a'); aEl.href = URL.createObjectURL(blob); aEl.download = `${slug}.json`; aEl.click();

  const [cid, uf] = cidade.match(/^(.*?)\s*\(?([A-Z]{2})?\)?$/).slice(1);
  const entrada = { slug, nome, titulo: nome, cidade: (cid || cidade).trim(), uf: uf || '', url, fonte: 'webmotors', snapshot: `/bidcon-lojista/${slug}.json` };
  console.log(`%cSnapshot ${slug}.json baixado: ${veiculos.length} veículos (${veiculos.filter((v) => v.fipe).length} com FIPE). Entrada para public/bidcon-lojista/lojas.json:`, 'font-weight:bold');
  console.log(JSON.stringify(entrada, null, 2));
})();
