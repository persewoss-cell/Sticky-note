// 지운 내용 기록
//  - 원래 있던 내용에서 지운 것만 기록 (새로 입력하거나 서식만 바꾼 건 기록 안 함)
//  - 편집을 1분 멈추거나 메모를 닫을 때, 그 전 기록 시점(또는 편집 시작 전)과 비교
//  - 3글자 이상 지운 경우만, 원래 줄과 지운 부분을 함께 저장
//  - 기간 제한 없음 (1명당 약 200MB 넘으면 오래된 것부터 자동 정리)
import { h, toast, escapeHtml } from './util.js';
import { sheet } from './ui.js';
import { I } from './icons.js';
import { findDeletions } from './lines.js';

const IDLE = 60_000, SESSION_GAP = 10 * 60_000;

export class DeletionLog {
  constructor(store, id, getHtml) {
    Object.assign(this, { store, id, getHtml });
    this.base = null;     // 비교 기준 (편집 시작 전 / 마지막 기록 시점의 내용)
    this.lastEditAt = 0;
  }
  canRecord() { return typeof this.store.addDeletion === 'function'; }

  // 저장될 때마다 호출 (prev = 고치기 전 내용)
  noteEdit(prevHtml) {
    if (!this.canRecord()) return;
    const now = Date.now();
    if (this.base == null || now - this.lastEditAt > SESSION_GAP) {
      if (this.base != null) this.check(); // 오래 쉬었으면 앞부분 먼저 정리
      this.base = prevHtml ?? '';
    }
    this.lastEditAt = now;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), IDLE);
  }

  check() {
    clearTimeout(this.timer);
    if (this.base == null) return;
    const now = this.getHtml();
    let items = [];
    try { items = findDeletions(this.base, now); } catch (e) { console.error(e); }
    this.base = now; // 이후로는 지금 내용이 기준
    if (!items.length) return;
    this.store.addDeletion({ noteId: this.id, savedAt: Date.now(), items });
  }

  flush() { this.check(); }
}

/* ───────── 기록 보기 ───────── */
function when(ms) {
  const d = new Date(ms);
  const now = new Date();
  const date = d.toLocaleDateString('ko-KR', d.getFullYear() === now.getFullYear()
    ? { month: 'long', day: 'numeric', weekday: 'short' } : { year: 'numeric', month: 'long', day: 'numeric' });
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const m = Math.round((Date.now() - ms) / 60000);
  const rel = m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : m < 43200 ? `${Math.round(m / 1440)}일 전` : '';
  return { label: `${date} ${time}`, rel };
}

// 원래 줄에서 지운 부분을 빨간색으로 표시 (검색어는 노란 배경)
const mark = (text, q) => {
  const esc = escapeHtml(text);
  if (!q) return esc;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[&<>"']/g, (c) => escapeHtml(c)), 'gi');
  return esc.replace(re, (m) => `<mark>${m}</mark>`);
};
function renderItem(it, q = '') {
  if (it.type === 'line') {
    return it.lines.map((l) => `<div class="del-line"><span class="gone">${mark(l, q) || '&nbsp;'}</span></div>`).join('');
  }
  let html = '', pos = 0;
  for (const [s, e] of it.spans) {
    html += mark(it.line.slice(pos, s), q) + `<span class="gone">${mark(it.line.slice(s, e), q)}</span>`;
    pos = e;
  }
  return `<div class="del-line">${html + mark(it.line.slice(pos), q)}</div>`;
}
const deletedText = (it) => (it.type === 'line' ? it.lines.join('\n') : it.spans.map(([s, e]) => it.line.slice(s, e)).join(' '));

export function openHistory({ store, id, log, editor }) {
  if (typeof store.listDeletions !== 'function') return toast('이 버전에서는 기록을 쓸 수 없습니다');
  log?.flush(); // 방금 지운 것도 바로 반영
  const box = h('div', { class: 'history' }, h('p', { class: 'muted' }, '불러오는 중...'));
  const close = sheet('지운 내용', box);

  const copy = async (it) => {
    try { await navigator.clipboard.writeText(deletedText(it)); toast('복사했습니다'); }
    catch { toast('복사하지 못했습니다'); }
  };
  const reinsert = (it) => {
    const where = editor.reinsert(it);
    toast(where === 'same' ? '원래 자리에 다시 넣었습니다' : where === 'near' ? '원래 있던 줄 근처에 다시 넣었습니다' : '원래 자리를 찾지 못해 맨 아래에 넣었습니다', 2600);
    close();
  };

  // 검색: 지운 글자나 그 줄 내용에 검색어가 들어 있는 기록만
  const search = h('input', { type: 'search', class: 'search-input', placeholder: '지운 내용 검색...' });
  const listBox = h('div');
  let all = [];
  const textOf = (it) => (it.type === 'line' ? it.lines.join('\n') : it.line).toLowerCase();
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const items = q ? all.filter(({ it }) => textOf(it).includes(q)) : all;
    listBox.replaceChildren(items.length
      ? h('div', { class: 'history-list' }, items.map(({ it, savedAt }) => {
        const t = when(savedAt);
        return h('div', { class: 'history-item' },
          h('div', { class: 'hi-top' }, h('b', {}, t.label), t.rel ? h('span', { class: 'muted' }, t.rel) : null,
            h('span', { class: 'hi-tag' }, it.type === 'line' ? `줄 ${it.lines.length}개 삭제` : '일부 삭제')),
          h('div', { class: 'del-view', html: renderItem(it, q) }),
          h('div', { class: 'hi-actions' },
            h('button', { class: 'btn', onClick: () => copy(it) }, '복사'),
            editor ? h('button', { class: 'btn btn-primary', onClick: () => reinsert(it) }, '메모에 다시 넣기') : null));
      }))
      : h('div', { class: 'empty-state' }, q ? `'${search.value.trim()}' 이(가) 들어간 지운 기록이 없습니다.` : '지운 기록이 없습니다.',
        q ? null : h('p', { class: 'muted small' }, '예전에 써 둔 내용을 지우면 1분쯤 뒤에 여기에 나타납니다.')));
  };
  search.addEventListener('input', draw);
  const render = (records) => {
    all = records.flatMap((r) => r.items.map((it) => ({ it, savedAt: r.savedAt })));
    box.replaceChildren(
      h('div', { class: 'search-row open history-search' }, search, h('span', { class: 'search-icon', html: I.search })),
      h('p', { class: 'muted small history-info' }, '예전에 써 둔 내용 중 3글자 이상 지운 것을 빨간색으로 보여줍니다. 기간 제한 없이 보관돼요.'),
      listBox);
    draw();
    if (matchMedia('(pointer: fine)').matches) search.focus();
  };

  store.listDeletions(id).then(render)
    .catch((e) => box.replaceChildren(h('p', { class: 'auth-error' },
      e.code === 'permission-denied' ? 'Firebase 보안 규칙을 새로 게시해야 기록을 볼 수 있습니다 (안내받은 규칙을 Firestore → 규칙 탭에 붙여넣기).' : '기록을 불러오지 못했습니다: ' + e.message)));
}
