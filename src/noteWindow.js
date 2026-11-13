// Windows 앱의 메모 한 장짜리 창 (Windows 스티커 메모처럼 바탕화면에 띄워두는 창)
import { h, applyNoteColor, settings, isEmptyHtml, htmlToText } from './util.js';
import { I } from './icons.js';
import { Editor } from './editor.js';
import { showMenu, confirmDialog } from './ui.js';

export function renderNoteWindow(root, store, id, isNew) {
  const desktop = window.desktop;
  const ed = new Editor(store, id);
  let note = null, seen = false, closing = false;

  const win = h('div', { class: 'note-window' });
  const bar = h('div', { class: 'note-titlebar' },
    h('button', { class: 'icon-btn', title: '새 메모 (Ctrl+N)', html: I.plus, onClick: () => desktop.newNote() }),
    h('div', { class: 'drag' }),
    h('button', { class: 'icon-btn', title: '메뉴', html: I.more, onClick: (e) => openMenu(e.currentTarget) }),
    h('button', { class: 'icon-btn', title: '닫기 (Ctrl+W)', html: I.close, onClick: () => close() }));
  win.append(bar, h('div', { class: 'note-scroll' }, ed.body), ed.toolbar);
  root.replaceChildren(win);
  applyNoteColor(win, 'yellow');

  function openMenu(anchor) {
    showMenu(anchor, [
      { colors: note?.color || 'yellow', onPick: (c) => { store.update(id, { color: c }); localStorage.setItem('sticky.lastColor', c); } },
      { label: '노트 목록', icon: I.list, onClick: () => desktop.openList() },
      { label: note?.pinned ? '목록에서 고정 해제' : '목록 상단에 고정', icon: I.pin, onClick: () => store.update(id, { pinned: !note?.pinned, updatedAt: note?.updatedAt }) },
      { label: '메모 삭제', icon: I.trash, danger: true, onClick: del },
    ], { align: 'left' });
  }

  async function del() {
    if (settings.get().confirmDelete && !(await confirmDialog('이 메모를 휴지통으로 옮길까요?'))) return;
    closing = true;
    store.trash(id);
    desktop.closeWindow();
  }

  function close() {
    if (closing) return;
    closing = true;
    ed.save.flush();
    if (isEmptyHtml(ed.currentHtml())) store.remove(id); // 빈 메모는 닫을 때 자동 삭제
    setTimeout(() => desktop.closeWindow(), 80);
  }

  if (isNew) {
    store.create(id, { color: localStorage.getItem('sticky.lastColor') || 'yellow' });
    history.replaceState(null, '', '#note=' + id); // 새로고침 시 다시 만들지 않도록
    ed.body.focus();
  }

  store.subscribe((list) => {
    const n = list.find((x) => x.id === id && !x.deletedAt); // 휴지통에 들어간 메모는 없는 것으로 취급
    if (!n) { if (seen && !closing) { closing = true; desktop.closeWindow(); } return; } // 다른 곳에서 삭제됨
    seen = true; note = n;
    applyNoteColor(win, n.color);
    ed.setNote(n);
    document.title = (htmlToText(n.html).split('\n')[0] || '새 메모').slice(0, 60);
  });
  // 존재하지 않는 메모로 열린 창은 정리
  setTimeout(() => { if (!seen && !closing) { closing = true; desktop.closeWindow(); } }, isNew ? 15000 : 8000);

  window.addEventListener('focus', () => document.body.classList.remove('blurred'));
  window.addEventListener('blur', () => document.body.classList.add('blurred'));
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'n') { e.preventDefault(); desktop.newNote(); }
    else if (mod && k === 'w') { e.preventDefault(); close(); }
    else if (mod && k === 'd') { e.preventDefault(); del(); }
    else if (mod && k === 'h') { e.preventDefault(); desktop.openList(); }
  });
  desktop.onRequestClose?.(() => close());
  if (!isNew) ed.body.focus();
}
