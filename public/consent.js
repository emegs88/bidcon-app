/* bidcon — consentimento de cookies + analytics consent-gated (LGPD)
   Analytics (GA4 + Microsoft Clarity) só carregam APÓS consentimento explícito.
   Preencha os IDs reais abaixo para ativar a medição. Sem IDs, nada é carregado. */
(function(){
  'use strict';

  // === PREENCHER: IDs reais de medição ===
  var GA4_ID     = '';   // [PREENCHER: ex. G-XXXXXXXXXX] — deixe '' para não ativar GA4
  var CLARITY_ID = '';   // [PREENCHER: ex. abcdefghij] — deixe '' para não ativar Clarity

  var KEY = 'bidcon_consent_v1';
  var store = {
    get: function(){ try { return localStorage.getItem(KEY); } catch(e){ return null; } },
    set: function(v){ try { localStorage.setItem(KEY, v); } catch(e){} }
  };

  function loadGA4(){
    if(!GA4_ID) return;
    var s=document.createElement('script');
    s.async=true; s.src='https://www.googletagmanager.com/gtag/js?id='+GA4_ID;
    document.head.appendChild(s);
    window.dataLayer=window.dataLayer||[];
    window.gtag=function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID, { anonymize_ip: true });
  }

  function loadClarity(){
    if(!CLARITY_ID) return;
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){ (c[a].q=c[a].q||[]).push(arguments); };
      t=l.createElement(r); t.async=1; t.src='https://www.clarity.ms/tag/'+i;
      y=l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t,y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
  }

  function enableAnalytics(){ loadGA4(); loadClarity(); }

  // Helper de evento exposto às páginas (no-op se sem consentimento/sem GA4)
  window.bidconTrack=function(name, params){
    if(store.get()==='granted' && typeof window.gtag==='function'){
      window.gtag('event', name, params||{});
    }
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
