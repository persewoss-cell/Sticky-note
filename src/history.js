// 수정 기록(버전)
//  - 편집이 1분 멈추면 기록, 같은 메모는 최소 5분 간격
//  - 편집을 새로 시작할 때(10분 이상 쉬었다가) 고치기 전 내용을 한 번 기록 → 실수로 지워도 되돌릴 수 있음
//  - 되돌리기 직전의 내용도 기록
import { h, sanitize, htmlToText, toast } from './util.js';
import { I } from './icons.js';
import { sheet, confirmDialog } from './ui.js';
import { HISTORY_DAYS } from './store.js';
import { ensureFontsIn } from './fonts.js';

const IDLE = 60_000, MIN_GAP = 5 * 60_000, SESSION_GAP = 10 * 60_000;
const isEmpty = (html) => !htmlToText(html) && !/<img/i.test(html || '');

export class VersionKeeper {
  constructor(store, id, getHtml) {
    Object.assign(this, { store, id, getHtml });
    this.lastEditAt = 0;
    this.lastVersionAt = 0;
    this.lastVersionHtml = null;
    this.dirty = false;
  }
  canRecord() { return typeof this.store.addVersion === 'function'; }

  async loadLatest() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const [v] = await this.store.listVersions(this.id, 1, { prune: false });
      if (v) { this.lastVersionAt = Math.max(this.lastVersionAt, v.savedAt); this.lastVersionHtml ??= v.html; }
    } catch {}
  }

  // 저장될 때마다 호출 (prev = 고치기 전 내용)
  noteEdit(prevHtml) {
    if (!this.canRecord()) return;
    const now = Date.now();
    if (now - this.lastEditAt > SESSION_GAP && prevHtml != null) this.recordBefore(prevHtml);
    this.lastEditAt = now;
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.snapshot(), IDLE);
  }

  async recordBefore(prevHtml) {
    await this.loadLatest();
    if (isEmpty(prevHtml) || prevHtml === this.lastVersionHtml) return;
    this.write(prevHtml, 'before-edit');
  }

  snapshot({ force = false, reason = 'auto', retry = true } = {}) {
    if (!this.canRecord() || (!this.dirty && !force)) return;
    const wait = this.lastVersionAt + MIN_GAP - Date.now();
    if (!force && wait > 0) { // 5분이 안 지났으면 그때 다시
      if (retry) { clearTimeout(this.timer); this.timer = setTimeout(() => this.snapshot(), wait + 1000); }
      return;
    }
    const html = this.getHtml();
    this.dirty = false;
    if (isEmpty(html) || html === this.lastVersionHtml) return;
    this.write(html, reason);
  }

  write(html, reason) {
    this.lastVersionAt = Date.now();
    this.lastVersionHtml = html;
    this.store.addVersion(this.id, { html, text: htmlToText(html).slice(0, 300), savedAt: this.lastVersionAt, reason });
  }

  // 창을 닫거나 화면을 나갈 때
  flush() { clearTimeout(this.timer); this.snapshot({ retry: false }); }
}

/* ───────── 기록 보기 화면 ───────── */
const REASON = { 'before-edit': '편집 전', 'before-restore': '되돌리기 전', auto: '' };

function when(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const diff = Date.now() - ms, m = Math.round(diff / 60000);
  const rel = m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
  return { label: `${date} ${time}`, rel };
}

export function openHistory({ store, id, keeper, onRestore }) {
  if (typeof store.listVersions !== 'function') return toast('이 버전에서는 기록을 쓸 수 없습니다');
  keeper?.flush(); // 방금까지 고친 내용도 기록에 반영 (5분 간격 규칙 안에서)
  const box = h('div', { class: 'history' }, h('p', { class: 'muted' }, '불러오는 중...'));
  const close = sheet('수정 기록', box);

  let versions = [];
  const showList = () => {
    box.replaceChildren(
      h('p', { class: 'muted small history-info' }, `편집을 멈추면 최소 5분 간격으로 자동 기록되고, ${HISTORY_DAYS}일 동안 보관됩니다.`),
      versions.length
        ? h('div', { class: 'history-list' }, versions.map((v) => {
          const t = when(v.savedAt);
          return h('button', { class: 'history-item', onClick: () => showOne(v) },
            h('div', { class: 'hi-top' }, h('b', {}, t.label), h('span', { class: 'muted' }, t.rel),
              REASON[v.reason] ? h('span', { class: 'hi-tag' }, REASON[v.reason]) : null),
            h('div', { class: 'hi-text' }, (v.text || htmlToText(v.html)).split('\n').filter(Boolean).slice(0, 2).join(' · ') || '(사진만 있음)'));
        }))
        : h('div', { class: 'empty-state' }, '아직 기록이 없습니다.', h('p', { class: 'muted small' }, '메모를 고치고 1분쯤 지나면 첫 기록이 생깁니다.')));
  };
  const showOne = (v) => {
    const t = when(v.savedAt);
    const html = sanitize(v.html);
    ensureFontsIn(html);
    const copy = async () => {
      try {
        if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([htmlToText(html)], { type: 'text/plain' }) })]);
        else await navigator.clipboard.writeText(htmlToText(html));
        toast('이 버전의 내용을 복사했습니다');
      } catch { toast('복사하지 못했습니다. 내용을 드래그해서 복사하세요'); }
    };
    const restore = async () => {
      if (!(await confirmDialog(`${t.label} 시점으로 되돌릴까요?\n지금 내용은 기록에 남겨 둡니다.`, { ok: '되돌리기', danger: false }))) return;
      keeper?.snapshot({ force: true, reason: 'before-restore' });
      onRestore(html);
      close();
      toast('되돌렸습니다');
    };
    box.replaceChildren(
      h('div', { class: 'history-bar' },
        h('button', { class: 'btn', onClick: showList }, '← 목록'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn', onClick: copy }, '복사'),
        h('button', { class: 'btn btn-primary', onClick: restore }, '되돌리기')),
      h('div', { class: 'hi-top hi-one' }, h('b', {}, t.label), h('span', { class: 'muted' }, t.rel)),
      h('div', { class: 'history-view', html: html || '<span class="muted">빈 내용</span>' }));
  };

  store.listVersions(id).then((list) => { versions = list; showList(); })
    .catch((e) => box.replaceChildren(h('p', { class: 'auth-error' },
      e.code === 'permission-denied' ? '기록을 불러올 권한이 없습니다. 잠시 후 다시 시도하세요 (보안 규칙 배포 중일 수 있어요).' : '기록을 불러오지 못했습니다: ' + e.message)));
}

export const historyIcon = I.history;
