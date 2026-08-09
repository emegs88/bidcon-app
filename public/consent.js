/* ===========================================================================
   bidcon — consentimento de cookies + medição consent-gated (LGPD)
   MEDICAO-ADS-01 · AUTORIZADO pela coordenação em 09/08/2026, como PRIMEIRA
   fatia e bloqueio de todas as outras: "(a) instalar GA4 e a tag de conversão
   do Google Ads — os IDs vêm do Emerson, deixe o ponto de configuração
   explícito e o código pronto para receber; (c) a conversão respeita o
   consentimento existente — nada dispara antes do aceite; (d) entregar um
   jeito de PROVAR com clique real que a conversão registra, porque
   'instalado' não é 'medindo'."
   ---------------------------------------------------------------------------
   O QUE ESTA FATIA CONSERTA. A auditoria do kit de campanha mediu que o site
   não tinha medição NENHUMA: o banner de consentimento existia, o carregador
   existia, e os dois IDs estavam vazios — então nada disparava. Era o caso
   exato da doutrina da casa: VERDE VAZIO É PIOR QUE VERMELHO, porque para de
   avisar. Um banner de cookies visível dá a impressão de que a medição está de
   pé. A campanha de Pesquisa nasceria cega, e o plano de trocar para
   "Maximizar conversões depois de ~30 conversões" não teria como contar uma.

   NADA AQUI LIGA SOZINHO. Os quatro IDs abaixo continuam vazios de propósito e
   só o Emerson os preenche. Com eles vazios, o comportamento é idêntico ao de
   antes desta fatia: nenhuma requisição a terceiros. Isto é código pronto para
   receber, não medição ligada.
   =========================================================================== */
(function(){
  'use strict';

  /* =========================================================================
     PONTO DE CONFIGURAÇÃO — os quatro IDs, e nada mais, moram aqui.
     -------------------------------------------------------------------------
     Onde cada um é obtido:
      · GA4_ID   → Google Analytics > Admin > Fluxos de dados > ID da métrica.
      · ADS_ID   → Google Ads > Ferramentas > Conversões > a tag: "AW-" + 9-11
                   dígitos. É a CONTA, não a conversão.
      · ADS_CONVERSAO_LEAD → o rótulo da ação de conversão específica, no
                   formato "AW-000000000/AbC-D_efGhIjK". Vem do mesmo painel,
                   em "Instalar a tag você mesmo". SEM ele o ADS_ID sozinho não
                   registra conversão nenhuma — configura a conta e mais nada.
      · CLARITY_ID → Microsoft Clarity > Settings > Overview.

     Todos os quatro são identificadores PÚBLICOS (aparecem no fonte de
     qualquer site que os use). Não são segredo e por isso podem viver no
     repositório — diferente de qualquer chave de API, que nunca entra aqui.
     ========================================================================= */
  var GA4_ID             = '';   // [PREENCHER: ex. G-XXXXXXXXXX]
  var ADS_ID             = '';   // [PREENCHER: ex. AW-123456789]
  var ADS_CONVERSAO_LEAD = '';   // [PREENCHER: ex. AW-123456789/AbC-D_efGhIjK]
  var CLARITY_ID         = '';   // [PREENCHER: ex. abcdefghij]

  var KEY = 'bidcon_consent_v1';
  var store = {
    get: function(){ try { return localStorage.getItem(KEY); } catch(e){ return null; } },
    set: function(v){ try { localStorage.setItem(KEY, v); } catch(e){} }
  };

  /* -------------------------------------------------------------------------
     UM ÚNICO gtag.js, PARA GA4 E ADS.
     O defeito que isto evita era o caminho óbvio: duplicar o `loadGA4` para
     criar um `loadAds`. Os dois produtos usam A MESMA biblioteca
     (googletagmanager.com/gtag/js) — copiar o carregador baixaria o script
     duas vezes e, pior, redefiniria `window.gtag`, trocando a função por uma
     nova e órfã depois que a primeira já tinha enfileirado eventos. A conta do
     GA4 continuaria funcionando e a do Ads pareceria funcionar, que é o modo
     mais caro de errar.

     Carrega com o PRIMEIRO id que existir; os demais entram por `config`, que
     é como o gtag foi feito para atender várias propriedades.
     ------------------------------------------------------------------------- */
  var gtagPronto = false;
  function garantirGtag(idParaCarregar){
    if (gtagPronto) return true;
    if (!idParaCarregar) return false;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(idParaCarregar);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    gtagPronto = true;
    return true;
  }

  function loadGA4(){
    if (!GA4_ID) return;
    if (!garantirGtag(GA4_ID)) return;
    window.gtag('config', GA4_ID, { anonymize_ip: true });
  }

  function loadAds(){
    if (!ADS_ID) return;
    if (!garantirGtag(ADS_ID)) return;
    window.gtag('config', ADS_ID);
  }

  function loadClarity(){
    if (!CLARITY_ID) return;
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){ (c[a].q=c[a].q||[]).push(arguments); };
      t=l.createElement(r); t.async=1; t.src='https://www.clarity.ms/tag/'+i;
      y=l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t,y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
  }

  function enableAnalytics(){ loadGA4(); loadAds(); loadClarity(); }

  /* -------------------------------------------------------------------------
     LEITURA DO COOKIE DE ORIGEM — REUSO, NÃO CADEIA NOVA.
     Ordem literal da coordenação: "quando a fatia de origem vier, é para
     REUSAR essa cadeia, não construir outra". O `bidcon_utm` é gravado pelo
     prosperito-widget.js (first-touch, 90 dias, JSON codificado em URI) e já
     alimenta `vendas_novas.utm` pelo POST /api/atende. Aqui ele é só LIDO,
     para diagnóstico — esta função não grava cookie nenhum.
     ------------------------------------------------------------------------- */
  function lerCookie(nome){
    try {
      var partes = document.cookie ? document.cookie.split('; ') : [];
      for (var i = 0; i < partes.length; i++) {
        var idx = partes[i].indexOf('=');
        if (idx === -1) continue;
        if (partes[i].slice(0, idx) === nome) return decodeURIComponent(partes[i].slice(idx + 1));
      }
    } catch(e){}
    return null;
  }
  function origemGravada(){
    var cru = lerCookie('bidcon_utm');
    if (!cru) return null;
    try { return JSON.parse(cru); } catch(e){ return null; }
  }

  /* Helper de evento genérico (GA4). No-op sem consentimento ou sem gtag. */
  window.bidconTrack = function(name, params){
    if (store.get()==='granted' && typeof window.gtag==='function') {
      window.gtag('event', name, params||{});
    }
  };

  /* -------------------------------------------------------------------------
     A CONVERSÃO DE LEAD — e por que ela DEVOLVE UM MOTIVO LITERAL.
     Não devolve booleano e não devolve "ok". Devolve a string do que
     aconteceu, porque o item (d) da ordem existe justamente contra o
     autoengano de tratar "instalado" como "medindo": quem chama precisa poder
     distinguir "disparado" de "sem_rotulo_configurado" sem abrir o DevTools.
     A página /teste-conversao mostra exatamente esta string.

     ATENÇÃO AO QUE ELA **NÃO** GARANTE: devolver 'disparado' prova que o
     evento entrou no dataLayer, NÃO que o Google recebeu. Rede, bloqueador e
     CSP acontecem depois. A prova de recebimento é o painel do Ads e o
     Diagnóstico de tags — está escrito no passo a passo da página de teste.

     `transaction_id` é aceito e recomendado: é como o Ads deduplica se a mesma
     conversão for enviada duas vezes (recarga de página, clique duplo).
     ------------------------------------------------------------------------- */
  window.bidconConversaoLead = function(extra){
    if (store.get() !== 'granted')          return 'sem_consentimento';
    if (!ADS_CONVERSAO_LEAD)                return 'sem_rotulo_configurado';
    if (typeof window.gtag !== 'function')  return 'gtag_ausente';
    var p = { send_to: ADS_CONVERSAO_LEAD };
    if (extra && typeof extra === 'object') {
      if (typeof extra.value === 'number')        p.value = extra.value;
      if (typeof extra.currency === 'string')     p.currency = extra.currency;
      if (typeof extra.transaction_id === 'string') p.transaction_id = extra.transaction_id;
    }
    window.gtag('event', 'conversion', p);
    return 'disparado';
  };

  /* -------------------------------------------------------------------------
     DIAGNÓSTICO — o que a página de teste lê. Só devolve fatos verificáveis no
     navegador; nunca conclui "está medindo".
     ------------------------------------------------------------------------- */
  window.bidconMedicao = function(){
    var o = origemGravada();
    return {
      consentimento: store.get() || 'nao_respondido',
      ga4_configurado: !!GA4_ID,
      ads_configurado: !!ADS_ID,
      rotulo_configurado: !!ADS_CONVERSAO_LEAD,
      clarity_configurado: !!CLARITY_ID,
      gtag_carregado: typeof window.gtag === 'function',
      dataLayer_eventos: (window.dataLayer && window.dataLayer.length) || 0,
      gclid_no_cookie: !!(o && o.gclid),
      origem_gravada: o
    };
  };

  function removeBanner(){
    var b=document.getElementById('cookieBanner');
    if(b && b.parentNode) b.parentNode.removeChild(b);
  }

  function buildBanner(){
    if(document.getElementById('cookieBanner')) return;
    var wrap=document.createElement('div');
    wrap.id='cookieBanner';
    wrap.setAttribute('role','dialog');
    wrap.setAttribute('aria-live','polite');
    wrap.setAttribute('aria-label','Aviso de cookies');
    wrap.style.cssText='position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:760px;margin:0 auto;background:#16213A;border:1px solid rgba(255,255,255,.15);border-radius:14px;box-shadow:0 18px 48px -12px rgba(0,0,0,.7);padding:16px 18px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-family:Inter,system-ui,sans-serif';
    var txt=document.createElement('p');
    txt.style.cssText='margin:0;flex:1 1 280px;font-size:13px;line-height:1.55;color:#93A0B8';
    txt.innerHTML='Usamos cookies para medir a navegação e melhorar sua experiência. Você decide. Veja a <a href="/privacidade" style="color:#5b93ff;text-decoration:underline">Política de Privacidade</a>.';
    var btns=document.createElement('div');
    btns.style.cssText='display:flex;gap:9px;flex:0 0 auto';
    var rej=document.createElement('button');
    rej.type='button'; rej.textContent='Recusar';
    rej.style.cssText='cursor:pointer;border:1px solid rgba(255,255,255,.22);background:transparent;color:#f6f6f8;font-family:Inter,sans-serif;font-size:13px;font-weight:600;border-radius:999px;padding:10px 18px';
    var acc=document.createElement('button');
    acc.type='button'; acc.textContent='Aceitar';
    acc.style.cssText='cursor:pointer;border:none;background:#2E7BF0;color:#fff;font-family:Inter,sans-serif;font-size:13px;font-weight:700;border-radius:999px;padding:10px 20px';
    rej.addEventListener('click', function(){ store.set('denied'); removeBanner(); });
    acc.addEventListener('click', function(){ store.set('granted'); removeBanner(); enableAnalytics(); });
    btns.appendChild(rej); btns.appendChild(acc);
    wrap.appendChild(txt); wrap.appendChild(btns);
    (document.body||document.documentElement).appendChild(wrap);
  }

  function init(){
    var c=store.get();
    if(c==='granted'){ enableAnalytics(); return; }
    if(c==='denied'){ return; }
    buildBanner();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
