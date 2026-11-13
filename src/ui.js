// 공용 UI: 팝업 메뉴, 확인 대화상자, 바텀시트
import { h, COLORS } from './util.js';
import { I } from './icons.js';

let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('blur', closeMenu);

// items: { label, icon, danger, onClick } | { colors: currentKey, onPick } | 'sep'
export function showMenu(anchor, items, { align = 'right' } = {}) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === 'sep') { menu.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.colors !== undefined) {
      menu.append(h('div', { class: 'menu-colors' },
        Object.entries(COLORS).map(([key, c]) =>
          h('button', {
            class: 'swatch' + (key === it.colors ? ' on' : ''), title: c.name, style: `background:${c.swatch}`,
            html: key === it.colors ? I.check : '',
            onClick: () => { closeMenu(); it.onPick(key); },
          }))));
      continue;
    }
    menu.append(h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem',
      onClick: () => { closeMenu(); it.onClick(); },
    }, it.icon ? h('span', { class: 'mi-icon', html: it.icon }) : null, h('span', {}, it.label)));
  }
  // 메뉴를 눌러도 편집 중인 메모의 커서(포커스)를 빼앗지 않음
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.append(menu);
  const vw = innerWidth, vh = innerHeight, mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x, y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = align === 'right' ? r.right - mw : r.left; y = r.bottom + 4;
    if (items.some((i) => i.colors !== undefined) && mw >= vw - 16) x = 0;
  } else { x = anchor.x; y = anchor.y; }
  menu.style.left = Math.max(4, Math.min(x, vw - mw - 4)) + 'px';
  menu.style.top = Math.max(4, y + mh > vh ? vh - mh - 4 : y) + 'px';
  openMenu = menu;
  return menu;
}

export function confirmDialog(message, { ok = '삭제', danger = true } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div', { class: 'overlay', onClick: (e) => e.target === overlay && done(false) },
      h('div', { class: 'dialog' },
        h('p', {}, message),
        h('div', { class: 'dialog-btns' },
          h('button', { class: 'btn', onClick: () => done(false) }, '취소'),
          h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onClick: () => done(true) }, ok))));
    document.body.append(overlay);
    overlay.querySelector('.btn-danger, .btn-primary').focus();
  });
}

export function sheet(title, content) {
  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  const overlay = h('div', { class: 'overlay sheet-overlay', onClick: (e) => e.target === overlay && close() },
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, h('h2', {}, title),
        h('button', { class: 'icon-btn', html: I.close, title: '닫기', onClick: close })),
      content));
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  return close;
}
