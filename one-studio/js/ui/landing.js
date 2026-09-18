/* ===== پەڕەی سەرەکی — لەندینگ بەرزکردنەوەی کۆنڤێرژن ===== */
import { L, t } from '../l10n.js';
import { el, icon } from '../utils.js';
import { TOOLS, CATS } from '../effects/registry.js';
import { state, emit } from '../state.js';

export function renderLanding(root) {
  const nav = el('nav', { class: 'nav' });
  nav.innerHTML = `
    <div class="nav-in">
      <div class="brand" data-go="studio" role="button" tabindex="0" aria-label="${t('app')}">
        <div class="mark">١</div>
        <div class="name">وان ستۆدیۆ<small>ستۆدیۆی دەنگی وێب</small></div>
      </div>
      <div class="nav-links">
        <a data-scroll="tools">${t('navFeatures')}</a>
        <a data-scroll="quran" class="nl-hide">${t('navQuran')}</a>
        <a data-scroll="how" class="nl-hide">${t('navHow')}</a>
        <a data-scroll="faq">${t('navFaq')}</a>
        <a data-go="privacy" class="nl-hide">${t('navPrivacy')}</a>
        <button class="btn primary" data-go="studio">${t('navStart')}</button>
      </div>
    </div>`;
  root.append(nav);

  /* ---- هیڕۆ ---- */
  const hero = el('section', { class: 'hero' });
  hero.innerHTML = `
    <div>
      <span class="hero-kicker">${icon('wave', 15)} ${t('heroKicker')}</span>
      <h1>${t('heroTitle1')}<br><span class="hl">${t('heroTitle2')}</span></h1>
      <p class="sub">${t('heroSub')}</p>
      <div class="hero-cta">
        <button class="btn primary big" data-go="studio">${icon('play', 17)} ${t('heroCta')}</button>
        <button class="btn big ghost" data-scroll="tools">${icon('sliders', 17)} ${t('heroCta2')}</button>
      </div>
      <div class="hero-meta">
        <span class="m">${icon('check', 15)} ${t('heroMeta1')}</span>
        <span class="m">${icon('check', 15)} ${t('heroMeta2')}</span>
        <span class="m">${icon('shield', 15)} ${t('heroMeta3')}</span>
      </div>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <div class="frame">
        <div class="fv-top"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="t">${t('fvTitle')}</span></div>
        <canvas id="hero-wave"></canvas>
        <div class="fv-controls">
          <button class="fv-play" id="hero-play" aria-label="${t('play')}">${icon('play', 18)}</button>
          <div class="fv-bars" id="hero-bars"></div>
        </div>
      </div>
    </div>`;
  root.append(hero);

  /* ---- ئامرازەکان ---- */
  const tools = el('section', { class: 'section', id: 'sec-tools' });
  tools.innerHTML = `
    <div class="section-head">
      <div class="k">${t('toolsKicker')}</div>
      <h2>${t('toolsTitle')}</h2>
      <p>${t('toolsSub')}</p>
    </div>`;
  const grid = el('div', { class: 'grid-tools' });
  const shown = ['quickEnhance', 'voiceEnhancer', 'noiseReduce', 'eq', 'compressor', 'limiter', 'reverb', 'delay', 'deesser', 'gate', 'stereoWidth', 'pitch', 'speed', 'silenceRemove', 'clickClean', 'saturation'];
  for (const id of shown) {
    const tool = TOOLS.find(x => x.id === id);
    if (!tool) continue;
    const card = el('button', { class: 'tool-card', html: `
      <span class="ic">${icon(tool.icon, 20)}</span>
      <b>${t(tool.label)}</b>
      <span>${t(tool.desc)}</span>` });
    card.addEventListener('click', () => { location.hash = '#/studio'; sessionStorage.setItem('os-pending-tool', tool.id); });
    grid.append(card);
  }
  tools.append(grid);
  root.append(tools);

  /* ---- قیرائەت ---- */
  const quran = el('section', { class: 'quran-band', id: 'sec-quran' });
  const qTools = ['noiseReduce', 'eq', 'compressor', 'deesser', 'reverb', 'delay', 'limiter', 'normalize', 'voiceEnhancer', 'hiss', 'multiband'];
  const listItems = qTools.map(id => {
    const tool = TOOLS.find(x => x.id === id);
    if (!tool) return '';
    return `<div class="q">${icon('check', 13)} ${t(tool.label)}</div>`;
  }).join('');
  quran.innerHTML = `
    <div class="quran-card">
      <div>
        <span class="chip gold">${icon('quran', 14)} ${t('quranKicker')}</span>
        <h2 style="margin-top:14px">${t('quranTitle')}</h2>
        <p class="lead">${t('quranLead')}</p>
        <p style="color:var(--tx2);font-size:12.5px">${icon('info', 13)} ${t('quranNote')}</p>
        <button class="btn primary" data-go="studio" style="margin-top:8px">${icon('voice', 16)} ${t('heroCta')}</button>
      </div>
      <div class="quran-list">${listItems}</div>
    </div>`;
  root.append(quran);

  /* ---- چۆن کار دەکات ---- */
  const how = el('section', { class: 'section', id: 'sec-how' });
  how.innerHTML = `
    <div class="section-head">
      <div class="k">${t('howKicker')}</div>
      <h2>${t('howTitle')}</h2>
    </div>
    <div class="steps">
      ${[1, 2, 3, 4, 5, 6].map(i => `<div class="step"><b>${t('step' + i)}</b><p>${t('step' + i + 'd')}</p></div>`).join('')}
    </div>`;
  root.append(how);

  /* ---- FAQ ---- */
  const faq = el('section', { class: 'section', id: 'sec-faq' });
  faq.innerHTML = `
    <div class="section-head">
      <div class="k">${t('faqKicker')}</div>
      <h2>${t('faqTitle')}</h2>
    </div>`;
  const faqList = el('div', { class: 'faq' });
  for (let i = 1; i <= 8; i++) {
    const item = el('div', { class: 'faq-item' });
    const q = el('button', { class: 'faq-q', html: `<span>${t('faq' + i + 'q')}</span> ${icon('chevDown', 16)}`, 'aria-expanded': 'false' });
    const a = el('div', { class: 'faq-a' });
    a.append(el('div', { text: t('faq' + i + 'a') }));
    q.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      q.setAttribute('aria-expanded', String(open));
      a.style.maxHeight = open ? a.scrollHeight + 'px' : '0';
    });
    item.append(q, a);
    faqList.append(item);
  }
  faq.append(faqList);
  root.append(faq);

  /* ---- فوتەر ---- */
  const footer = el('footer', { class: 'footer' });
  footer.innerHTML = `
    <div class="footer-in">
      <div class="brand" data-go="studio" role="button" tabindex="0">
        <div class="mark">١</div>
        <div class="name">وان ستۆدیۆ<small>ستۆدیۆی دەنگی وێب</small></div>
      </div>
      <div class="cols">
        <a data-go="studio">${t('navStudio')}</a>
        <a data-go="dashboard">${t('navDashboard')}</a>
        <a data-go="privacy">${t('navPrivacy')}</a>
        <a data-scroll="faq">${t('navFaq')}</a>
      </div>
      <div class="note">وان ستۆدیۆ — هەموو پڕۆسەکردنێک لە ناو وێبگەڕەکەتدا دەکرێت.</div>
    </div>`;
  root.append(footer);

  // ڕاگەیاندنەکان
  root.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { location.hash = '#/' + go.dataset.go; return; }
    const sc = e.target.closest('[data-scroll]');
    if (sc) {
      const map = { tools: 'sec-tools', quran: 'sec-quran', how: 'sec-how', faq: 'sec-faq' };
      document.getElementById(map[sc.dataset.scroll])?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // شێوەپەلی هیڕۆ
  const waveCv = document.getElementById('hero-wave');
  if (waveCv) {
    const c = waveCv.getContext('2d');
    let t0 = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = waveCv.clientWidth, H = waveCv.clientHeight;
      if (waveCv.width !== Math.round(W * dpr)) { waveCv.width = Math.round(W * dpr); waveCv.height = Math.round(H * dpr); }
      c.save(); c.scale(dpr, dpr);
      c.fillStyle = '#080b11';
      c.fillRect(0, 0, W, H);
      const grad = c.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#3dd6f5');
      grad.addColorStop(1, '#f0b429');
      c.strokeStyle = grad;
      c.lineWidth = 2;
      c.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const n = Math.sin(x * 0.02 + t0) * Math.sin(x * 0.007 - t0 * 0.7) * 0.5 + 0.5;
        const y = H / 2 + Math.sin(x * 0.045 + t0 * 1.3) * n * H * 0.32;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
      c.globalAlpha = 0.25;
      c.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const n = Math.sin(x * 0.02 + t0 + 2) * Math.sin(x * 0.007 - t0 * 0.7 + 1) * 0.5 + 0.5;
        const y = H / 2 + Math.cos(x * 0.045 + t0) * n * H * 0.3;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
      c.globalAlpha = 1;
      c.restore();
      t0 += 0.022;
      if (state.view === 'landing') requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    const bars = document.getElementById('hero-bars');
    if (bars) {
      for (let i = 0; i < 42; i++) {
        const b = document.createElement('i');
        b.style.animationDelay = (i * 0.06) + 's';
        b.style.animationDuration = (0.7 + (i % 5) * 0.14) + 's';
        b.style.transformOrigin = 'center';
        bars.append(b);
      }
    }
    const hp = document.getElementById('hero-play');
    hp?.addEventListener('click', () => { location.hash = '#/studio'; });
  }
}
