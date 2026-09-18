/* ===== پانێڵی ئامرازەکان — گەڕان، دڵخواز و دوا بەکارهێنان ===== */
import { TOOLS, CATS } from '../effects/registry.js';
import { t } from '../l10n.js';
import { el, icon } from '../utils.js';
import { handleToolClick, favTools, recentTools } from './tool-actions.js';
import { busOn } from '../state.js';

export function createToolsPanel() {
  const root = el('aside', { class: 'side left', id: 'tools-panel' });
  const head = el('div', { class: 'side-head' });
  head.innerHTML = `${icon('sliders', 16)} <span>${t('allTools')}</span>`;
  const count = el('span', { class: 'count' });
  head.append(count);
  const body = el('div', { class: 'side-body' });

  const searchBox = el('div', { class: 'search-box' });
  const searchInput = el('input', { type: 'search', placeholder: t('searchTool'), 'aria-label': t('search') });
  searchBox.append(searchInput, el('span', { html: icon('search', 15) }));
  body.append(searchBox);

  const listWrap = el('div');
  body.append(listWrap);
  root.append(head, body);

  let query = '';
  searchInput.addEventListener('input', () => { query = searchInput.value.trim(); render(); });

  function matchTool(tool) {
    if (!query) return true;
    const q = query.toLowerCase();
    return t(tool.label).toLowerCase().includes(q)
      || t(tool.desc).toLowerCase().includes(q)
      || (tool.id.toLowerCase().includes(q));
  }

  function toolItem(tool) {
    const isFav = !!favTools.get()[tool.id];
    const item = el('div', { class: 'tool-item', role: 'button', tabindex: '0' });
    item.innerHTML = `
      <span class="ti-ic">${icon(tool.icon, 16)}</span>
      <span class="ti-main"><span class="ti-name">${t(tool.label)}</span><span class="ti-desc">${t(tool.desc)}</span></span>`;
    if (tool.kind === 'unavailable') item.classList.add('disabled');
    const star = el('button', {
      class: 'ti-star' + (isFav ? ' on' : ''),
      'aria-label': t('presetFav'), 'aria-pressed': String(isFav),
      html: icon('star', 14),
    });
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      favTools.toggle(tool.id);
      render();
    });
    item.append(star);
    item.addEventListener('click', () => handleToolClick(tool));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleToolClick(tool); });
    return item;
  }

  function group(title, tools) {
    if (!tools.length) return null;
    const g = el('div', { class: 'tool-group' });
    g.append(el('div', { class: 'tg-title', text: title }));
    for (const tool of tools) g.append(toolItem(tool));
    return g;
  }

  function render() {
    listWrap.innerHTML = '';
    const favs = TOOLS.filter(x => favTools.get()[x.id]);
    if (favs.length && !query) {
      const g = group('★ ' + t('favorites'), favs);
      if (g) listWrap.append(g);
    }
    const recents = recentTools.get().map(id => TOOLS.find(x => x.id === id)).filter(Boolean);
    if (recents.length && !query) {
      const g = group(t('recentTools'), recents.slice(0, 4));
      if (g) listWrap.append(g);
    }
    for (const cat of CATS) {
      const tools = TOOLS.filter(x => x.cat === cat && matchTool(x));
      const g = group(t(cat), tools);
      if (g) listWrap.append(g);
    }
    if (!listWrap.children.length) {
      listWrap.append(el('div', { class: 'empty-note', text: t('noFavorites') }));
    }
    count.textContent = String(TOOLS.length);
  }
  render();
  busOn('tools-changed', render);
  return { root, render };
}
