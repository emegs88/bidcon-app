/* ============================================================================
 *  prosperito-widget.js — Bolha flutuante do Time Prosperito (Bidcon)
 *  Grupo Prospere I Consórcios I Imóveis I Seguros
 * ----------------------------------------------------------------------------
 *  COMO USAR: salvar em public/prosperito-widget.js do site da vitrine e
 *  incluir no layout:  <script src="/prosperito-widget.js" defer></script>
 *  O widget injeta tudo sozinho (CSS + DOM). Sem dependência externa.
 *
 *  Endpoints usados (no app):  POST {API_BASE}/api/interesse
 *                              POST {API_BASE}/api/atende
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__prosperitoWidget) return; // não injeta duas vezes
  window.__prosperitoWidget = true;

  /* ---------------- CONFIG ---------------- */
  var API_BASE = 'https://app.bidcon.com.br'; // mesmo domínio? deixe '' 
  var CANAL = 'site';
  var LS_KEY = 'bidcon_prosperito_v1';        // lembra a conversa do visitante

  /* ---------------- ESTADO ---------------- */
  var state = { aberto: false, interesseId: null, nome: '', enviando: false };
  var cartaFocoAtual = null; // fatia carta-chat: carta clicada na vitrine, vai em toda POST /api/atende
  try {
    var salvo = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (salvo && salvo.interesseId) { state.interesseId = salvo.interesseId; state.nome = salvo.nome || ''; }
  } catch (e) {}

  function persistir() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ interesseId: state.interesseId, nome: state.nome })); } catch (e) {}
  }

  /* ---------------- CSS ---------------- */
  var css = ''
  + '.pw-launcher{position:fixed;right:20px;bottom:20px;z-index:99998;display:flex;align-items:center;gap:10px;cursor:pointer;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif}'
  + '.pw-launcher .pw-tag{background:#0F0F10;color:#fff;font-size:13px;font-weight:600;padding:9px 14px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.25);white-space:nowrap}'
  + '.pw-launcher .pw-bola{width:58px;height:58px;border-radius:50%;background:#E10600;display:grid;place-items:center;box-shadow:0 10px 28px rgba(225,6,0,.45);transition:transform .15s}'
  + '.pw-launcher:hover .pw-bola{transform:scale(1.06)}'
  + '.pw-bola svg{width:28px;height:28px;fill:#fff}'
  + '.pw-panel{position:fixed;right:20px;bottom:92px;z-index:99999;width:378px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif}'
  + '.pw-panel.aberto{display:flex}'
  + '@media(max-width:480px){.pw-panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}}'
  + '@media(max-width:480px){.pw-head{padding:18px 18px 16px}.pw-head .pw-badge{width:42px;height:42px;font-size:19px}.pw-head h3{font-size:17px}.pw-head p{font-size:13px}.pw-close{font-size:26px;padding:6px 8px}.pw-body{padding:20px 18px;gap:14px}.pw-entrada{gap:16px}.pw-entrada h4{font-size:21px}.pw-entrada .pw-sub{font-size:15px;line-height:1.6}.pw-entrada label{font-size:13px;margin-bottom:6px}.pw-entrada input{padding:15px 16px;font-size:16.5px;border-radius:13px}.pw-btn{padding:16px;font-size:16.5px;border-radius:13px}.pw-nota{font-size:12px;line-height:1.6}.pw-msg{font-size:15.5px;padding:11px 15px;max-width:88%}.pw-input{padding:14px}.pw-input textarea{padding:13px 16px;font-size:15.5px;border-radius:22px}.pw-send{width:48px;height:48px}.pw-send svg{width:21px;height:21px}.pw-foot{font-size:10.5px;padding:9px}}'
  + '.pw-head{background:#0F0F10;color:#fff;padding:14px 16px;display:flex;align-items:center;gap:11px;flex:none}'
  + '.pw-head .pw-badge{width:38px;height:38px;border-radius:11px;background:#E10600;display:grid;place-items:center;font-weight:800;font-size:17px;color:#fff}'
  + '.pw-head h3{margin:0;font-size:15px;font-weight:700;line-height:1.1}'
  + '.pw-head p{margin:2px 0 0;font-size:11.5px;color:#B9B9C0}'
  + '.pw-close{margin-left:auto;background:none;border:none;color:#B9B9C0;font-size:22px;cursor:pointer;line-height:1;padding:4px}'
  + '.pw-body{flex:1;overflow-y:auto;padding:16px;background:#FAFAFB;display:flex;flex-direction:column;gap:10px}'
  + '.pw-entrada{margin:auto 0;display:flex;flex-direction:column;gap:12px}'
  + '.pw-entrada h4{margin:0;font-size:18px;font-weight:800;color:#0F0F10}'
  + '.pw-entrada .pw-sub{margin:0;font-size:13.5px;color:#6B6B72;line-height:1.5}'
  + '.pw-entrada label{font-size:11.5px;font-weight:600;color:#3A3A40;margin-bottom:4px;display:block}'
  + '.pw-entrada input{width:100%;box-sizing:border-box;padding:12px 13px;border:1.5px solid #E6E6EA;border-radius:11px;font-size:14.5px;font-family:inherit}'
  + '.pw-entrada input:focus{outline:none;border-color:#0F0F10}'
  + '.pw-entrada input.pw-erro{border-color:#E10600}'
  + '.pw-btn{background:#E10600;color:#fff;border:none;padding:13px;border-radius:11px;font-size:14.5px;font-weight:700;cursor:pointer;font-family:inherit}'
  + '.pw-btn:hover{background:#B60500}.pw-btn:disabled{opacity:.55;cursor:not-allowed}'
  + '.pw-nota{font-size:10.5px;color:#9A9AA2;line-height:1.45;text-align:center;margin:0}'
  + '.pw-msg{max-width:84%;padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}'
  + '.pw-msg.ag{background:#F1F1F3;color:#17171A;align-self:flex-start;border-bottom-left-radius:4px}'
  + '.pw-msg.cl{background:#0F0F10;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}'
  + '.pw-msg.sis{align-self:center;background:transparent;color:#9A9AA2;font-size:12px;text-align:center;max-width:100%}'
  + '.pw-typing{align-self:flex-start;background:#F1F1F3;padding:12px 15px;border-radius:14px;border-bottom-left-radius:4px;display:flex;gap:4px}'
  + '.pw-typing i{width:6px;height:6px;border-radius:50%;background:#B0B0B8;animation:pwB 1.2s infinite}'
  + '.pw-typing i:nth-child(2){animation-delay:.2s}.pw-typing i:nth-child(3){animation-delay:.4s}'
  + '@keyframes pwB{0%,60%,100%{opacity:.3}30%{opacity:1}}'
  + '.pw-input{flex:none;display:flex;gap:8px;padding:10px;border-top:1px solid #E6E6EA;background:#fff}'
  + '.pw-input textarea{flex:1;resize:none;border:1.5px solid #E6E6EA;border-radius:20px;padding:10px 14px;font-size:14px;font-family:inherit;max-height:100px;line-height:1.4}'
  + '.pw-input textarea:focus{outline:none;border-color:#0F0F10}'
  + '.pw-send{width:42px;height:42px;border-radius:50%;background:#E10600;border:none;cursor:pointer;display:grid;place-items:center;flex:none}'
  + '.pw-send:disabled{opacity:.5}.pw-send svg{width:19px;height:19px;fill:#fff}'
  + '.pw-foot{flex:none;text-align:center;font-size:9.5px;letter-spacing:.3px;color:#9A9AA2;padding:7px;background:#fff;border-top:1px solid #E6E6EA}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------------- DOM ---------------- */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  var launcher = el('div', 'pw-launcher');
  launcher.appendChild(el('div', 'pw-tag', 'Fale com o Time Prosperito'));
  var bola = el('div', 'pw-bola', '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.02 2 11c0 2.63 1.24 5 3.24 6.65-.14.98-.55 2.35-1.6 3.35 0 0 2.68-.16 4.74-1.7.86.23 1.74.35 2.62.35 5.52 0 10-4.02 10-8.65S17.52 2 12 2z"/></svg>');
  launcher.appendChild(bola);

  var panel = el('div', 'pw-panel');
  var head = el('div', 'pw-head');
  head.appendChild(el('div', 'pw-badge', 'P'));
  var headTxt = el('div', '', '<h3>Time Prosperito</h3><p>Bidcon · cartas contempladas</p>');
  head.appendChild(headTxt);
  var closeBtn = el('button', 'pw-close', '&times;');
  head.appendChild(closeBtn);
  panel.appendChild(head);

  var body = el('div', 'pw-body');
  panel.appendChild(body);

  var barra = el('div', 'pw-input');
  var txt = document.createElement('textarea');
  txt.rows = 1; txt.placeholder = 'Escreva sua mensagem...';
  var sendBtn = el('button', 'pw-send', '<svg viewBox="0 0 24 24"><path d="M3 20.5v-17L22 12 3 20.5zm2-3.05L16.85 12 5 6.55v3.9L11 12l-6 1.55v3.9z"/></svg>');
  barra.appendChild(txt); barra.appendChild(sendBtn);
  barra.style.display = 'none';
  panel.appendChild(barra);

  panel.appendChild(el('div', 'pw-foot', 'Grupo Prospere &nbsp;I&nbsp; Cons&oacute;rcios &nbsp;I&nbsp; Im&oacute;veis &nbsp;I&nbsp; Seguros'));

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  /* ---------------- TELAS ---------------- */
  function telaEntrada() {
    body.innerHTML = '';
    var box = el('div', 'pw-entrada');
    box.appendChild(el('h4', '', 'Bora conversar?'));
    box.appendChild(el('p', 'pw-sub', 'Deixa seu nome e WhatsApp pra falar com a gente sobre as cartas, planejamento e poder de compra. Sem compromisso.'));
    var f1 = el('div'); f1.innerHTML = '<label>Seu nome</label>';
    var inNome = document.createElement('input'); inNome.type = 'text'; inNome.placeholder = 'Como podemos te chamar?';
    f1.appendChild(inNome); box.appendChild(f1);
    var f2 = el('div'); f2.innerHTML = '<label>Seu WhatsApp</label>';
    var inFone = document.createElement('input'); inFone.type = 'tel'; inFone.placeholder = '(19) 91234-5678';
    f2.appendChild(inFone); box.appendChild(f2);
    var btn = el('button', 'pw-btn', 'Come&ccedil;ar conversa');
    box.appendChild(btn);
    box.appendChild(el('p', 'pw-nota', 'Voc&ecirc; conversa com nosso time sobre planejamento, carta de cr&eacute;dito e patrim&ocirc;nio. N&atilde;o prometemos data de contempla&ccedil;&atilde;o &mdash; ela ocorre por sorteio ou lance.'));
    body.appendChild(box);

    inFone.addEventListener('input', function () {
      var d = inFone.value.replace(/\D/g, '').slice(0, 11), o = d;
      if (d.length > 2) o = '(' + d.slice(0, 2) + ') ' + d.slice(2);
      if (d.length > 7) o = '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
      inFone.value = o;
    });

    btn.addEventListener('click', function () {
      var nome = inNome.value.trim();
      var fone = inFone.value.replace(/\D/g, '');
      var erro = false;
      inNome.classList.toggle('pw-erro', nome.length < 2); if (nome.length < 2) erro = true;
      inFone.classList.toggle('pw-erro', fone.length < 10); if (fone.length < 10) erro = true;
      if (erro) return;
      btn.disabled = true; btn.textContent = 'Abrindo...';
      fetch(API_BASE + '/api/interesse', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome: nome, telefone: fone, origem: 'chat' })
      }).then(function (r) { if (!r.ok) throw new Error('interesse ' + r.status); return r.json(); })
        .then(function (data) {
          state.interesseId = data.interesse_id || data.id;
          state.nome = nome.split(' ')[0];
          if (!state.interesseId) throw new Error('sem id');
          persistir();
          telaChat(true);
        })
        .catch(function (e) {
          console.error('[prosperito]', e);
          btn.disabled = false; btn.innerHTML = 'Come&ccedil;ar conversa';
          alert('N\u00e3o consegui abrir a conversa agora. Tenta de novo em instantes.');
        });
    });
  }

  function telaChat(novo) {
    body.innerHTML = '';
    barra.style.display = 'flex';
    if (novo) {
      addMsg('ag', 'Oi, ' + state.nome + '! Aqui \u00e9 o Prosperito \ud83d\udc4b Que bom te ver na Bidcon. Me conta: viu alguma carta na vitrine que te interessou, ou prefere que eu te ajude a achar o caminho pro que voc\u00ea quer conquistar?');
    } else {
      addMsg('sis', 'Bem-vindo de volta' + (state.nome ? ', ' + state.nome : '') + '! Pode continuar de onde parou.');
    }
    txt.focus();
  }

  function addMsg(tipo, texto) {
    var m = el('div', 'pw-msg ' + tipo);
    m.innerHTML = pwBoldEsc(texto);
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
  }
  function typingOn() {
    var t = el('div', 'pw-typing'); t.id = 'pwTyping';
    t.innerHTML = '<i></i><i></i><i></i>';
    body.appendChild(t); body.scrollTop = body.scrollHeight;
  }
  function typingOff() { var t = document.getElementById('pwTyping'); if (t) t.remove(); }

  function enviar() {
    var texto = txt.value.trim();
    if (!texto || state.enviando || !state.interesseId) return;
    state.enviando = true; sendBtn.disabled = true;
    addMsg('cl', texto);
    txt.value = ''; txt.style.height = 'auto';
    typingOn();
    fetch(API_BASE + '/api/atende', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cartaFocoAtual
        ? { canal: CANAL, interesse_id: state.interesseId, texto: texto, carta_foco: cartaFocoAtual }
        : { canal: CANAL, interesse_id: state.interesseId, texto: texto })
    }).then(function (r) {
      typingOff();
      if (r.status === 400) { // interesse sumiu (ex.: limpeza) -> recomeça
        try { localStorage.removeItem(LS_KEY); } catch (e) {}
        state.interesseId = null;
        addMsg('sis', 'Sua sess\u00e3o expirou. Vamos recome\u00e7ar rapidinho?');
        barra.style.display = 'none';
        telaEntrada();
        throw new Error('sessao expirada');
      }
      if (!r.ok) throw new Error('atende ' + r.status);
      return r.json();
    }).then(function (data) {
      addMsg('ag', data.resposta || 'Recebi sua mensagem! J\u00e1 te respondo.');
    }).catch(function (e) {
      typingOff();
      if (String(e.message).indexOf('sessao') < 0) {
        console.error('[prosperito]', e);
        addMsg('sis', 'Tive um probleminha aqui agora. Pode mandar de novo?');
      }
    }).finally ? null : null;
    // finally manual (compat):
    setTimeout(function () { state.enviando = false; sendBtn.disabled = false; txt.focus(); }, 400);
  }

  txt.addEventListener('input', function () { txt.style.height = 'auto'; txt.style.height = Math.min(txt.scrollHeight, 100) + 'px'; });
  txt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
  sendBtn.addEventListener('click', enviar);

  /* ---------------- ABRIR/FECHAR ---------------- */
  function toggle(abrir) {
    state.aberto = abrir == null ? !state.aberto : abrir;
    panel.classList.toggle('aberto', state.aberto);
    if (state.aberto) {
      if (state.interesseId) { barra.style.display = 'flex'; if (!body.children.length) telaChat(false); }
      else { barra.style.display = 'none'; telaEntrada(); }
    }
  }
  launcher.addEventListener('click', function () { toggle(true); });
  closeBtn.addEventListener('click', function () { toggle(false); });

var pendingCtx = null;
var pendingTimer = null;

function tentarEnviarContexto() {
  if (!pendingCtx) return;
  if (state.interesseId && barra.style.display !== 'none') {
    var texto = pendingCtx;
    pendingCtx = null;
    if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null; }
    setTimeout(function () { txt.value = texto; sendBtn.click(); }, 900);
  }
}

window.abrirProsperito = function (ctx) {
  if (ctx && ctx.texto) {
    pendingCtx = ctx.texto;
    if (pendingTimer) clearInterval(pendingTimer);
    pendingTimer = setInterval(tentarEnviarContexto, 200);
    setTimeout(function () { if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null; } }, 30000);
  }
  toggle(true);
  tentarEnviarContexto();
};

/* fatia carta-chat: abre o widget já focado numa carta específica da vitrine.
 * Se o gate (nome/WhatsApp) ainda não foi passado, telaEntrada() aparece
 * normalmente e a mensagem some de contexto (pendingCtx) só dispara depois,
 * quando o interesseId existir — reaproveita o mecanismo de tentarEnviarContexto. */
window.abrirProsperitoComCarta = function (carta) {
  if (!carta) { toggle(true); return; }
  var ref = carta.ref != null ? String(carta.ref).slice(0, 40) : '';
  var tipo = carta.tipo != null ? String(carta.tipo).slice(0, 20) : '';
  var adm = carta.adm != null ? String(carta.adm).slice(0, 60) : '';
  var credito = Number(carta.credito);
  var entrada = Number(carta.entrada);
  var parcela = Number(carta.parcela);
  var nparcelas = Number(carta.nparcelas);
  var custo = Number(carta.custo);
  cartaFocoAtual = {
    ref: ref, tipo: tipo, adm: adm,
    credito: isNaN(credito) ? 0 : credito,
    entrada: isNaN(entrada) ? 0 : entrada,
    parcela: isNaN(parcela) ? 0 : parcela,
    nparcelas: isNaN(nparcelas) ? 0 : nparcelas,
    custo: (!isNaN(custo) && custo > 0) ? custo : null
  };
  var tipoLbl = tipo.toLowerCase() === 'imovel' ? 'Im\u00f3vel' : 'Ve\u00edculo';
  var custoSufixo = cartaFocoAtual.custo != null ? (', custo efetivo ~' + cartaFocoAtual.custo + '% a.m') : '';
  var texto = 'Quero saber mais sobre esta carta de ' + tipoLbl + ': cr\u00e9dito ' +
    pwBRL(cartaFocoAtual.credito) + ', entrada ' + pwBRL(cartaFocoAtual.entrada) +
    ', parcela ' + pwBRL(cartaFocoAtual.parcela) +
    (cartaFocoAtual.nparcelas > 0 ? '\u00d7' + cartaFocoAtual.nparcelas : '') +
    custoSufixo + '.';
  pendingCtx = texto;
  if (pendingTimer) clearInterval(pendingTimer);
  pendingTimer = setInterval(tentarEnviarContexto, 200);
  setTimeout(function () { if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null; } }, 30000);
  toggle(true);
  tentarEnviarContexto();
};

document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest ? e.target.closest('.js-prosperito') : null;
  if (!a) return;
  e.preventDefault();
  var ref = a.getAttribute('data-ref');
  var tipo = a.getAttribute('data-tipo');
  var valor = a.getAttribute('data-valor');
  var ctx = null;
  if (ref) {
    var partes = ['Tenho interesse na carta ' + ref];
    if (tipo) partes.push('(' + tipo + ')');
    if (valor) partes.push('- cr\u00e9dito ' + valor);
    ctx = { texto: partes.join(' ') };
  }
  window.abrirProsperito(ctx);
});

/* ---- opcoes em botao (quick reply) ---- */
var css2 = ''
  + '.pw-opcoes{display:flex;flex-wrap:wrap;gap:8px;margin:-2px 0 6px;padding:0 2px}'
  + '.pw-opcao{background:#fff;border:1.5px solid #E10600;color:#E10600;font-family:inherit;font-weight:700;font-size:13px;padding:9px 14px;border-radius:999px;cursor:pointer;transition:background .15s,color .15s}'
  + '.pw-opcao:hover:not(:disabled){background:#E10600;color:#fff}'
  + '.pw-opcao:disabled{opacity:.4;cursor:default}';
var style2 = document.createElement('style');
style2.textContent = css2;
document.head.appendChild(style2);

var __addMsgOriginal = addMsg;
addMsg = function (tipo, texto) {
  var A = '[[OPCOES]]', F = '[[/OPCOES]]';
  var iA = texto.indexOf(A), iF = texto.indexOf(F);
  var opcoes = null, textoLimpo = texto;
  if (iA !== -1 && iF !== -1 && iF > iA) {
    var bloco = texto.substring(iA + A.length, iF);
    textoLimpo = (texto.substring(0, iA) + texto.substring(iF + F.length)).trim();
    opcoes = bloco.split('|').map(function (par) {
      var idx = par.indexOf(':');
      if (idx === -1) return null;
      return { valor: par.substring(0, idx).trim(), rotulo: par.substring(idx + 1).trim() };
    }).filter(Boolean);
  }
  __addMsgOriginal(tipo, textoLimpo);
  if (opcoes && opcoes.length) {
    var wrap = el('div', 'pw-opcoes');
    opcoes.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pw-opcao'; b.textContent = o.rotulo;
      b.addEventListener('click', function () {
        wrap.querySelectorAll('.pw-opcao').forEach(function (x) { x.disabled = true; });
        txt.value = o.valor; sendBtn.click();
      });
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }
};

var css3 = ''
  + ".pw-carta{background:#121A2E;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:16px;margin:10px 0;font-family:'IBM Plex Mono',monospace;max-width:100%}"
  + ".pw-carta-eyebrow{font-size:11px;letter-spacing:.08em;color:#8891A5;text-transform:uppercase;margin-bottom:6px}"
  + ".pw-carta-title{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:17px;color:#F2F4F8;margin-bottom:12px}"
  + ".pw-carta-row{display:flex;justify-content:space-between;align-items:baseline;padding:9px 0;border-top:1px solid rgba(255,255,255,.07)}"
  + ".pw-carta-row:first-child{border-top:0}"
  + ".pw-carta-row span{font-family:'Space Grotesk',sans-serif;font-size:13.5px;color:#8891A5}"
  + ".pw-carta-row b{font-weight:600;font-size:14.5px;color:#F2F4F8}"
  + ".pw-green{color:#34D399!important}"
  + ".pw-carta-selo{display:inline-flex;align-items:center;gap:6px;background:rgba(52,211,153,.12);color:#34D399;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:12.5px;padding:6px 12px;border-radius:999px}"
  + ".pw-dot{width:6px;height:6px;border-radius:50%;background:#34D399;display:inline-block;flex:0 0 auto}"
  + ".pw-carta-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:11px}"
  + ".pw-carta-title2{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:15px;color:#F2F4F8}"
  + ".pw-carta-cred{text-align:right}"
  + ".pw-carta-cred b{font-weight:700;font-size:16px;color:#F2F4F8;white-space:nowrap;display:block}"
  + ".pw-carta-cred i{font-style:normal;font-size:9.5px;letter-spacing:.08em;color:#5D6579}"
  + ".pw-carta-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:11px}"
  + ".pw-cell{background:#0B1122;border-radius:8px;padding:8px;min-width:0}"
  + ".pw-cell i{display:block;font-style:normal;font-size:9px;letter-spacing:.07em;color:#5D6579;text-transform:uppercase;margin-bottom:4px}"
  + ".pw-cell b{font-weight:600;font-size:12px;color:#F2F4F8;word-break:break-word}"
  + ".pw-carta-foot{display:flex;justify-content:space-between;align-items:center;gap:8px}"
  + ".pw-carta-info{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-family:'Space Grotesk',sans-serif;font-size:12px;color:#34D399;min-width:0}"
  + ".pw-carta-info em{font-style:normal;color:#5D6579}"
  + ".pw-carta-cta{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:12.5px;color:#fff;background:linear-gradient(180deg,#E2483F,#C93A32);border:0;border-radius:999px;padding:10px 15px;white-space:nowrap;cursor:pointer;flex:0 0 auto}";
var style3 = document.createElement('style');
style3.textContent = css3;
document.head.appendChild(style3);

/* ===== PW CARTAS — render de [[CARTA]] ===== */
var PW_CARTA_RE = /\[\[CARTA\]\]([\s\S]*?)\[\[\/CARTA\]\]/g;
function pwEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
/* negrito simples **texto** -> <b>texto</b>, sempre sobre texto já escapado
 * (pwEsc primeiro) pra nunca abrir brecha de HTML injection via resposta do modelo. */
function pwBoldEsc(s){return pwEsc(s).replace(/\*\*([^\*]+?)\*\*/g,'<b>$1</b>');}
function pwBRL(n){
  var v;
  if (typeof n === 'number') {
    v = Math.round(n);
  } else {
    var s = String(n).trim().replace(/[^\d.,-]/g, '');
    if (s.indexOf(',') !== -1) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    v = Math.round(parseFloat(s));
  }
  return isNaN(v) ? pwEsc(n) : 'R$ ' + v.toLocaleString('pt-BR');
}
function pwParseCarta(body){var c={};body.split('|').forEach(function(p){var i=p.indexOf('=');if(i>0)c[p.slice(0,i).trim().toLowerCase()]=p.slice(i+1).trim();});return c;}
function pwRenderCarta(c){
  var ref=pwEsc(c.ref||''),tipo=pwEsc((c.tipo||'').toUpperCase()),custo=pwEsc(c.custo||''),adm=pwEsc(c.adm||'');
  var eyebrow='REF. '+ref+' &middot; '+tipo+(adm?' &middot; '+adm:'');
  var ctaAttrs='data-id="'+pwEsc(c.id||'')+'" data-ref="'+ref+'" data-tipo="'+pwEsc(c.tipo||'')+'" data-adm="'+adm+'" data-credito="'+pwEsc(c.credito||'')+'" data-entrada="'+pwEsc(c.entrada||'')+'" data-parcela="'+pwEsc(c.parcela||'')+'" data-nparcelas="'+pwEsc(c.nparcelas||'')+'" data-custo="'+pwEsc(c.custo||'')+'"';
  if((c.modo||'').toLowerCase()==='destaque'){
    var selo=c.selo?'<span class="pw-carta-selo"><span class="pw-dot"></span>'+pwEsc(c.selo)+'</span>':'';
    return '<div class="pw-carta pw-carta-feat">'
      +'<div class="pw-carta-eyebrow">'+eyebrow+'</div>'
      +'<div class="pw-carta-title">Carta de cr\u00e9dito contemplada</div>'
      +'<div class="pw-carta-rows">'
      +'<div class="pw-carta-row"><span>Cr\u00e9dito</span><b>'+pwBRL(c.credito)+'</b></div>'
      +'<div class="pw-carta-row"><span>Entrada</span><b>'+pwBRL(c.entrada)+'</b></div>'
      +'<div class="pw-carta-row"><span>Parcelas</span><b>'+pwEsc(c.nparcelas)+'\u00d7 '+pwBRL(c.parcela)+'</b></div>'
      +(custo?'<div class="pw-carta-row"><span>Custo Bidcon</span><b class="pw-green">'+custo+'% a.m.</b></div>':'')
      +'</div>'
      +selo+'</div>';
  }
  var info='';
  if(c.selo)info+='<span class="pw-dot"></span>'+pwEsc(c.selo);
  return '<div class="pw-carta pw-carta-mini">'
    +'<div class="pw-carta-top"><div><div class="pw-carta-eyebrow">'+eyebrow+'</div><div class="pw-carta-title2">Carta contemplada</div></div>'
    +'<div class="pw-carta-cred"><b>'+pwBRL(c.credito)+'</b><i>CR\u00c9DITO</i></div></div>'
    +'<div class="pw-carta-g3">'
    +'<div class="pw-cell"><i>ENTRADA</i><b>'+pwBRL(c.entrada)+'</b></div>'
    +'<div class="pw-cell"><i>PARCELA</i><b>'+pwEsc(c.nparcelas)+'\u00d7 '+pwBRL(c.parcela)+'</b></div>'
    +(custo?'<div class="pw-cell"><i>CUSTO</i><b class="pw-green">'+custo+'% a.m.</b></div>':'')
    +'</div>'
    +'<div class="pw-carta-foot">'
    +'<div class="pw-carta-info">'+info+'</div>'
    +'<button type="button" class="pw-carta-cta" '+ctaAttrs+'>Quero esta</button>'
    +'</div></div>';
}

/* ===== PW CARTAS — patch addMsg pra [[CARTA]] ===== */
var __addMsgComOpcoes = addMsg;
addMsg = function (tipo, texto) {
  var cartas = [], m;
  var limpo = String(texto == null ? '' : texto);
  PW_CARTA_RE.lastIndex = 0;
  while ((m = PW_CARTA_RE.exec(limpo))) { cartas.push(pwParseCarta(m[1])); }
  PW_CARTA_RE.lastIndex = 0;
  limpo = limpo.replace(PW_CARTA_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  if (limpo || !cartas.length) __addMsgComOpcoes(tipo, limpo);
  if (cartas.length) {
    var wrap = el('div', 'pw-cartas');
    var html = '';
    for (var i = 0; i < cartas.length; i++) html += pwRenderCarta(cartas[i]);
    wrap.innerHTML = html;
    var ancora = (body.lastElementChild && body.lastElementChild.classList &&
      body.lastElementChild.classList.contains('pw-opcoes')) ? body.lastElementChild : null;
    body.insertBefore(wrap, ancora);
    body.scrollTop = body.scrollHeight;
  }
};
/* fatia RESERVA-01: o card [[CARTA]] renderizado DENTRO do chat (diferente do
 * clique num card da vitrine, fora do chat) não passava por
 * abrirProsperitoComCarta() e por isso nunca populava cartaFocoAtual — a
 * reserva via chat depende de carta_foco ir em todo POST /api/atende, então
 * sem isso a maioria das conversas reais (cliente vê a carta dentro do
 * próprio chat) chegaria na Serena sem carta_foco. Popula aqui a partir dos
 * data-* já presentes no botão (mesmos dados que o próprio card mostrou —
 * TOM-02: desde então vêm sempre da tool buscar_cartas, nunca do bloco
 * estático "CARTAS DISPONÍVEIS AGORA"; inclui data-adm agora, antes ficava
 * sempre vazio aqui). */
body.addEventListener('click', function (ev) {
  var btn = ev.target && ev.target.closest ? ev.target.closest('.pw-carta-cta') : null;
  if (!btn) return;
  var ref = btn.getAttribute('data-ref') || '';
  var tipo = (btn.getAttribute('data-tipo') || '').slice(0, 20);
  var adm = (btn.getAttribute('data-adm') || '').slice(0, 60);
  var credito = Number(btn.getAttribute('data-credito'));
  var entrada = Number(btn.getAttribute('data-entrada'));
  var parcela = Number(btn.getAttribute('data-parcela'));
  var nparcelas = Number(btn.getAttribute('data-nparcelas'));
  var custo = Number(String(btn.getAttribute('data-custo') || '').replace(',', '.'));
  cartaFocoAtual = {
    ref: ref.slice(0, 40), tipo: tipo, adm: adm,
    credito: isNaN(credito) ? 0 : credito,
    entrada: isNaN(entrada) ? 0 : entrada,
    parcela: isNaN(parcela) ? 0 : parcela,
    nparcelas: isNaN(nparcelas) ? 0 : nparcelas,
    custo: (!isNaN(custo) && custo > 0) ? custo : null
  };
  txt.value = 'Quero esta carta \u2014 REF. ' + ref;
  sendBtn.click();
});

})();
