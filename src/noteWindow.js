// Windows 앱의 메모 한 장짜리 창 (Windows 스티커 메모처럼 바탕화면에 띄워두는 창)
import { h, applyNoteColor, settings, isEmptyHtml, htmlToText } from './util.js';
import { I } from './icons.js';
import { Editor } from './editor.js';
import { showMenu, confirmDialog } from './ui.js';
import { maximizeButton, minimizeButton } from './maximize.js';
import { openHistory } from './history.js';

export function renderNoteWindow(root, store, id, isNew) {
  const desktop = window.desktop;
  // 메모가 지워져서 닫는 경우: 다음에 켤 때 이 메모를 다시 띄우지 않도록 알림 (예전 설치 버전은 그냥 닫기)
  const gone = () => (desktop.noteMissing ? desktop.noteMissing() : desktop.closeWindow());
  const ed = new Editor(store, id);
  let note = null, seen = false, closing = false;

  const win = h('div', { class: 'note-window' });
  const pinBtn = h('button', { class: 'icon-btn', title: '목록 상단에 고정', html: I.pin,
    onClick: () => store.update(id, { pinned: !note?.pinned, updatedAt: note?.updatedAt }) });
  const bar = h('div', { class: 'note-titlebar' },
    h('button', { class: 'icon-btn', title: '새 메모 (Ctrl+N)', html: I.plus, onClick: () => desktop.newNote() }),
    h('div', { class: 'drag' }),
    h('button', { class: 'icon-btn', title: '지운 내용 기록 (Ctrl+Shift+H)', html: I.history, onClick: () => showHistory() }),
    h('button', { class: 'icon-btn', title: '메모 색', html: I.rainbow, onClick: (e) => colorMenu(e.currentTarget) }),
    h('button', { class: 'icon-btn', title: '노트 목록 (Ctrl+H)', html: I.list, onClick: () => desktop.openList() }),
    pinBtn,
    h('button', { class: 'icon-btn', title: '메모 삭제 (Ctrl+D)', html: I.trash, onClick: () => del() }),
    minimizeButton(),
    maximizeButton(),
    h('button', { class: 'icon-btn', title: '닫기 (Ctrl+W)', html: I.close, onClick: () => close() }));
  win.append(bar, h('div', { class: 'note-scroll' }, ed.body), ed.toolbar);
  root.replaceChildren(win);
  applyNoteColor(win, 'yellow');

  function showHistory() {
    ed.save.flush();
    openHistory({ store, id, log: ed.history, editor: ed });
  }

  // 무지개 버튼 → 색 고르는 칸만 한 줄로
  function colorMenu(anchor) {
    showMenu(anchor, [
      { colors: note?.color || 'yellow', onPick: (c) => { store.update(id, { color: c }); localStorage.setItem('sticky.lastColor', c); } },
    ], { align: 'right' }).classList.add('menu-color-only');
  }

  async function del() {
    if (settings.get().confirmDelete && !(await confirmDialog('이 메모를 휴지통으로 옮길까요?'))) return;
    closing = true;
    store.trash(id);
    gone();
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
    if (!n) { if (seen && !closing) { closing = true; gone(); } return; } // 다른 곳에서 삭제됨
    seen = true; note = n;
    pinBtn.classList.toggle('active', !!n.pinned);
    pinBtn.title = n.pinned ? '목록 상단 고정 해제' : '목록 상단에 고정';
    applyNoteColor(win, n.color);
    ed.setNote(n);
    document.title = (htmlToText(n.html).split('\n')[0] || '새 메모').slice(0, 60);
  });
  // 존재하지 않는 메모로 열린 창은 정리
  setTimeout(() => { if (!seen && !closing) { closing = true; gone(); } }, isNew ? 15000 : 8000);

  window.addEventListener('focus', () => document.body.classList.remove('blurred'));
  window.addEventListener('blur', () => document.body.classList.add('blurred'));
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'n') { e.preventDefault(); desktop.newNote(); }
    else if (mod && k === 'w') { e.preventDefault(); close(); }
    else if (mod && k === 'd') { e.preventDefault(); del(); }
    else if (mod && e.shiftKey && k === 'h') { e.preventDefault(); showHistory(); }
    else if (mod && k === 'h') { e.preventDefault(); desktop.openList(); }
  });
  desktop.onRequestClose?.(() => close());
  if (!isNew) ed.body.focus();
}
