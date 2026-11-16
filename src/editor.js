// 메모 본문 편집기 (휴대폰 편집 화면과 Windows 메모 창이 함께 사용)
//  - 하단 서식 막대 (한 줄, 좁으면 좌우 스크롤)
//  - 글자를 드래그하면 뜨는 보조 창 (아이콘만, 좁으면 두 줄)
//  - 글씨체 / 크기(pt) / 글자색·형광펜 / 체크박스 줄
import { I } from './icons.js';
import { h, sanitize, htmlToText, compressImage, debounce, toast } from './util.js';
import { showMenu, closeMenu } from './ui.js';
import { FONT_GROUPS, FONTS, ensureFont, previewFont, ensureFontsIn, fontStack } from './fonts.js';
import { DeletionLog } from './history.js';
import { wrapInlineRuns, splitAtBreaks, leafBlocks, normalizeAll, blockText } from './lines.js';

export const TEXT_COLORS = [
  { name: '기본', value: null }, { name: '빨강', value: '#e03131' }, { name: '주황', value: '#e8590c' },
  { name: '초록', value: '#2f9e44' }, { name: '파랑', value: '#1971c2' }, { name: '남색', value: '#364fc7' },
  { name: '보라', value: '#9c36b5' }, { name: '분홍', value: '#d6336c' }, { name: '갈색', value: '#8d5524' },
  { name: '회색', value: '#868e96' },
];
export const HIGHLIGHTS = [
  { name: '없음', value: null }, { name: '노랑', value: '#fde047' }, { name: '연두', value: '#a7f3a0' },
  { name: '하늘', value: '#a5d8ff' }, { name: '분홍', value: '#fcc2d7' }, { name: '주황', value: '#ffc078' },
];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 60, 72];
// 실행 후 정리용 표시값 (브라우저 기본 명령이 만든 표시를 원하는 값으로 바꿈)
const MARK_COLOR = 'rgb(1, 2, 3)', MARK_FONT = 'sticky-default-font', MARK_SIZE = 'xxx-large';

const isTouch = matchMedia('(pointer: coarse)').matches;

export class Editor {
  constructor(store, id) {
    this.store = store;
    this.id = id;
    this.lastSaved = null;
    this.savedRange = null;
    this.pendingSize = null;
    this.save = debounce(() => this.saveNow(), 400);
    this.history = new DeletionLog(store, id, () => this.currentHtml());

    this.body = h('div', {
      class: 'editor-body', contenteditable: 'true', spellcheck: 'false',
      'data-placeholder': '메모하기...',
    });
    this.fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onChange: (e) => this.insertImages(e.target.files) });

    this.sizeControls = [];
    this.stateButtons = [];
    this.formatBar = this.buildBottomBar();
    this.floatBar = this.buildFloatBar();
    // 글자를 선택하는 동안 하단 막대 자리가 보조 창(두 줄)으로 바뀜 (휴대폰·PC 공통)
    this.docked = true;
    this.toolbar = h('div', { class: 'toolbar-wrap' }, this.formatBar, this.docked ? this.floatBar : null);
    if (this.docked) this.floatBar.classList.add('docked');
    else document.body.append(this.floatBar);

    const b = this.body;
    b.addEventListener('input', (e) => this.onInput(e));
    b.addEventListener('paste', (e) => this.onPaste(e));
    b.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); this.insertImages(files); }
    });
    b.addEventListener('keydown', (e) => this.onKey(e));
    b.addEventListener('blur', () => this.save.flush());
    b.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank');
    });
    // 체크박스 누르기 (마우스 / 터치)
    b.addEventListener('mousedown', (e) => { if (this.hitCheckbox(e)) e.preventDefault(); });
    b.addEventListener('touchstart', (e) => { if (this.hitCheckbox(e.touches[0])) e.preventDefault(); }, { passive: false });
    // 드래그 중에는 보조 창 숨김
    // (휴대폰은 길게 눌러 선택할 때 pointerup 대신 pointercancel 이 오므로 마우스 드래그만 추적)
    b.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { this.dragging = true; this.hideFloat(); } });
    this.onPointerUp = () => { if (this.dragging) { this.dragging = false; this.scheduleFloat(); } };
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);

    this.onSel = () => {
      const sel = document.getSelection();
      if (sel.rangeCount && b.contains(sel.anchorNode)) {
        this.savedRange = sel.getRangeAt(0).cloneRange();
        this.refreshState();
      }
      this.scheduleFloat();
    };
    document.addEventListener('selectionchange', this.onSel);
    this.onScroll = () => this.floatBar.classList.contains('show') && this.positionFloat();
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.onScroll);
    window.addEventListener('beforeunload', () => { this.save.flush(); this.history.flush(); });
    // 글씨체 메뉴가 바로 보이도록 글꼴 이름 미리보기를 조용히 받아 둠 (아주 작은 파일)
    setTimeout(() => FONTS.forEach(previewFont), 2500);
  }

  destroy() {
    this.save.flush();
    this.history.flush();
    document.removeEventListener('selectionchange', this.onSel);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onScroll);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.floatBar.remove();
  }

  /* ───────── 버튼 정의 ───────── */
  actions() {
    return {
      copy: { icon: I.copy, title: '복사 (Ctrl+C)', run: () => { this.restore(); document.execCommand('copy'); this.hideFloat(); toast('복사했습니다', 1200); } },
      cut: { icon: I.cut, title: '잘라내기 (Ctrl+X)', run: () => { this.restore(); document.execCommand('cut'); this.hideFloat(); } },
      paste: { icon: I.paste, title: '붙여넣기 (Ctrl+V)', run: () => this.pasteFromClipboard() },
      selectAll: { icon: I.selectAll, title: '전체 선택 (Ctrl+A)', run: () => this.selectAll() },
      bold: { icon: I.bold, title: '굵게 (Ctrl+B)', cmd: 'bold' },
      italic: { icon: I.italic, title: '기울임꼴 (Ctrl+I)', cmd: 'italic' },
      underline: { icon: I.underline, title: '밑줄 (Ctrl+U)', cmd: 'underline' },
      strike: { icon: I.strike, title: '취소선 (Ctrl+T)', cmd: 'strikeThrough' },
      bullets: { icon: I.bullets, title: '글머리 기호 (Ctrl+Shift+L)', cmd: 'insertUnorderedList' },
      todo: { icon: I.checkbox, title: '체크박스 (Ctrl+Shift+C)', run: () => this.toggleTodo() },
      clear: { icon: I.clearFormat, title: '서식 지우기', run: () => this.clearFormat() },
      font: { icon: I.font, title: '글씨체', run: (btn) => this.fontMenu(btn) },
      color: { icon: I.textColor, title: '글자 색 · 형광펜', run: (btn) => this.colorMenu(btn) },
      image: { icon: I.image, title: '사진 추가', run: () => this.fileInput.click() },
    };
  }

  button(key, a = this.actions()[key]) {
    const btn = h('button', { class: 'fmt-btn', title: a.title, html: a.icon, 'data-key': key, tabindex: -1 });
    // 누를 때 메모의 선택(드래그한 글자)이 풀리지 않도록
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => (a.cmd ? this.exec(a.cmd) : a.run(btn)));
    if (a.cmd) this.stateButtons.push(btn);
    if (key === 'color') this.colorButtons = [...(this.colorButtons || []), btn];
    return btn;
  }

  sizeControl() {
    const input = h('input', { class: 'size-input', type: 'text', inputmode: 'decimal', title: '글씨 크기 (pt)', value: '' });
    const step = (dir) => {
      const cur = parseFloat(input.value) || 12;
      const next = dir > 0 ? SIZES.find((s) => s > cur) ?? 72 : [...SIZES].reverse().find((s) => s < cur) ?? 8;
      this.applySize(next);
    };
    const mk = (dir) => {
      const b = h('button', { class: 'size-step', tabindex: -1, title: dir > 0 ? '크게' : '작게', html: dir > 0 ? I.up : I.down });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => step(dir));
      return b;
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const v = parseFloat(input.value); if (v >= 1 && v <= 200) this.applySize(v); this.restore(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
      if (e.key === 'Escape') this.restore();
    });
    input.addEventListener('focus', () => input.select());
    const el = h('div', { class: 'size-ctl' }, input, h('div', { class: 'size-steps' }, mk(1), mk(-1)), h('span', { class: 'size-unit' }, 'pt'));
    this.sizeControls.push(input);
    return el;
  }

  buildBottomBar() {
    const sep = () => h('span', { class: 'fmt-sep' });
    const bar = h('div', { class: 'format-bar' },
      this.button('font'), this.sizeControl(), this.button('color'), sep(),
      this.button('bold'), this.button('italic'), this.button('underline'), this.button('strike'), sep(),
      this.button('bullets'), this.button('todo'), this.button('image'),
      this.fileInput);
    // 마우스 휠로도 좌우 스크롤
    bar.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { bar.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    // 가려진 버튼이 있으면 가장자리를 흐리게 → 밀어서 볼 수 있다는 표시
    const hint = () => {
      bar.classList.toggle('more-right', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2);
      bar.classList.toggle('more-left', bar.scrollLeft > 2);
    };
    bar.addEventListener('scroll', hint, { passive: true });
    new ResizeObserver(hint).observe(bar);
    return bar;
  }

  buildFloatBar() {
    const g = (...els) => h('div', { class: 'fb-group' }, ...els);
    // 두 줄 구성: 넓으면 한 줄로 이어지고, 좁으면 두 줄로 쌓임
    const bar = h('div', { class: 'float-bar', role: 'toolbar' },
      h('div', { class: 'fb-row' },
        g(this.button('copy'), this.button('cut'), this.button('paste'), this.button('selectAll')),
        g(this.button('bold'), this.button('italic'), this.button('underline'), this.button('strike'))),
      h('div', { class: 'fb-row' },
        g(this.button('color'), this.button('font'), this.sizeControl()),
        g(this.button('todo'), this.button('bullets'), this.button('clear'))));
    bar.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    return bar;
  }

  /* ───────── 드래그 보조 창 ───────── */
  scheduleFloat() {
    clearTimeout(this.floatTimer);
    this.floatTimer = setTimeout(() => this.updateFloat(), isTouch ? 350 : 150);
  }
  updateFloat() {
    if (this.dragging) return;
    const sel = document.getSelection();
    const inside = sel.rangeCount && this.body.contains(sel.anchorNode) && !sel.isCollapsed;
    const usingBar = this.floatBar.contains(document.activeElement) || document.querySelector('.menu');
    if (inside) {
      this.floatBar.classList.add('show');
      this.toolbar.classList.toggle('selecting', this.docked);
      this.positionFloat();
    } else if (!usingBar) this.hideFloat();
  }
  hideFloat() { this.floatBar.classList.remove('show'); this.toolbar?.classList.remove('selecting'); }
  positionFloat() {
    if (this.docked) { // 하단 고정: 한 줄에 다 들어가는지만 확인
      const [r1, r2] = this.floatBar.children;
      this.floatBar.classList.remove('stacked');
      if (r2.offsetTop > r1.offsetTop) this.floatBar.classList.add('stacked');
      return;
    }
    const r = this.savedRange;
    if (!r) return;
    const rect = r.getBoundingClientRect();
    const fb = this.floatBar;
    fb.style.maxWidth = Math.min(innerWidth - 12, 700) + 'px';
    const [r1, r2] = fb.children;
    fb.classList.remove('stacked');
    if (r2.offsetTop > r1.offsetTop) fb.classList.add('stacked');
    const w = fb.offsetWidth, hgt = fb.offsetHeight, gap = 10;
    // 휴대폰은 시스템 메뉴가 위에 뜨므로 아래쪽 우선, PC는 위쪽 우선
    const above = rect.top - hgt - gap, below = rect.bottom + gap + (isTouch ? 14 : 0);
    let top = isTouch ? (below + hgt < innerHeight ? below : above) : (above > 4 ? above : below);
    top = Math.max(4, Math.min(top, innerHeight - hgt - 4));
    const left = Math.max(6, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 6));
    fb.style.top = top + 'px'; fb.style.left = left + 'px';
  }

  /* ───────── 선택 영역 유지 ───────── */
  restore() {
    const sel = document.getSelection();
    if (document.activeElement !== this.body) this.body.focus({ preventScroll: true });
    if (this.savedRange && !(sel.rangeCount && this.body.contains(sel.anchorNode))) {
      sel.removeAllRanges(); sel.addRange(this.savedRange);
    }
  }

  /* ───────── 원격 변경 반영 ───────── */
  setNote(note) {
    const html = sanitize(note.html);
    ensureFontsIn(html);
    if (html === this.lastSaved || html === this.currentHtml()) { this.lastSaved = html; return; }
    if (this.lastSaved !== null && this.currentHtml() !== this.lastSaved) return; // 저장 대기 중인 로컬 편집 우선
    const focused = document.activeElement === this.body;
    const caret = focused ? getOffsets(this.body) : null;
    this.body.innerHTML = html;
    this.lastSaved = this.currentHtml(); // 브라우저가 정규화한 형태로 기억
    if (caret) setOffsets(this.body, caret);
    this.updateEmpty();
  }

  currentHtml() { return sanitize(this.body.innerHTML); }
  // 지운 내용 기록에서 '메모에 다시 넣기' → 'same' | 'near' | 'end'
  reinsert(it) {
    this.save.flush();
    normalizeAll(this.body);
    const blocks = leafBlocks(this.body);
    const find = (text) => (text == null ? null : blocks.find((b) => blockText(b) === text));
    let where = 'end';
    let lines = it.type === 'line' ? it.lines : null;
    if (it.type === 'part') {
      const target = find(it.now);
      if (target) { // 지운 글자를 원래 위치에 다시 끼워 넣음 (뒤쪽부터)
        let removedBefore = it.spans.reduce((t, [s, e]) => t + (e - s), 0);
        for (const [s, e] of [...it.spans].reverse()) {
          removedBefore -= e - s;
          insertTextAt(target, s - removedBefore, it.line.slice(s, e));
        }
        where = 'same';
      } else lines = [it.line]; // 그 줄이 그 뒤로 또 바뀌었으면 원래 줄 전체를 근처에
    }
    if (lines) {
      const mk = () => lines.map((l) => { const d = document.createElement('div'); d.textContent = l; if (!l) d.innerHTML = '<br>'; return d; });
      const prev = find(it.prev), next = find(it.next);
      if (prev) { prev.after(...mk()); where = it.type === 'line' ? 'same' : 'near'; }
      else if (next) { next.before(...mk()); where = it.type === 'line' ? 'same' : 'near'; }
      else this.body.append(...mk());
    }
    this.updateEmpty();
    this.saveNow();
    return where;
  }
  updateEmpty() { this.body.classList.toggle('empty', !this.body.textContent.trim() && !this.body.querySelector('img, .todo')); }

  saveNow() {
    const html = this.currentHtml();
    if (html === this.lastSaved) return;
    if (html.length > 850_000) { toast('메모가 너무 큽니다. 사진을 줄여주세요.'); return; }
    const prev = this.lastSaved;
    this.lastSaved = html;
    this.history.noteEdit(prev);
    this.store.update(this.id, { html, text: htmlToText(html) });
  }
  changed() { this.updateEmpty(); this.save(); }

  onInput(e) {
    this.cleanup();
    if (e.inputType === 'insertParagraph') {
      // 체크된 줄에서 Enter → 새 줄은 체크 안 된 상태로
      const blk = this.blockAtCaret();
      if (blk?.classList.contains('todo') && blk.dataset.done !== undefined && !blk.textContent.trim()) delete blk.dataset.done;
    }
    this.changed();
  }

  /* ───────── 서식 명령 ───────── */
  exec(cmd, value = null, css = false) {
    this.restore();
    document.execCommand('styleWithCSS', false, css);
    document.execCommand(cmd, false, value);
    document.execCommand('styleWithCSS', false, false);
    this.cleanup();
    this.refreshState();
    this.changed();
  }

  // 브라우저 명령이 남긴 표시값을 실제 값으로 바꾸고 빈 span 정리
  cleanup() {
    for (const el of this.body.querySelectorAll('[style], font')) {
      if (el.tagName === 'FONT') { // 혹시 생긴 <font> 를 span 으로
        const span = document.createElement('span');
        if (el.color) span.style.color = el.color;
        if (el.face) span.style.fontFamily = el.face;
        if (el.size === '7') span.style.fontSize = MARK_SIZE;
        span.append(...el.childNodes); el.replaceWith(span);
        continue;
      }
      const st = el.style;
      if (st.fontSize === MARK_SIZE && this.pendingSize) st.fontSize = this.pendingSize + 'pt';
      if (st.color === MARK_COLOR) st.removeProperty('color');
      if (st.backgroundColor === 'transparent' || st.backgroundColor === 'rgba(0, 0, 0, 0)') st.removeProperty('background-color');
      if (st.fontFamily.includes(MARK_FONT)) st.removeProperty('font-family');
    }
    for (const el of this.body.querySelectorAll('span:not([style]), span[style=""]')) el.replaceWith(...el.childNodes);
  }

  applySize(pt) {
    this.pendingSize = pt;
    this.exec('fontSize', '7', true);
    this.sizeControls.forEach((i) => (i.value = fmtPt(pt)));
  }
  applyFont(family) {
    if (family) ensureFont(family);
    this.exec('fontName', family ? fontStack(family) : MARK_FONT, true);
  }
  applyColor(c) { this.exec('foreColor', c || MARK_COLOR, true); }
  applyHighlight(c) { this.exec('hiliteColor', c || 'transparent', true); }

  clearFormat() {
    this.exec('removeFormat');
    // removeFormat 이 남긴 글씨체·크기·색 스타일도 정리
    const r = this.savedRange;
    if (r && !r.collapsed) for (const el of this.body.querySelectorAll('[style]')) if (r.intersectsNode(el)) el.removeAttribute('style');
    this.cleanup(); this.changed();
  }

  fontMenu(btn) {
    const cur = this.currentFont();
    const items = [{ label: '기본 글씨체', checked: !cur, onClick: () => this.applyFont(null) }];
    for (const [group, list] of FONT_GROUPS) {
      items.push({ header: group });
      for (const [name, family] of list) {
        previewFont({ name, family });
        items.push({ label: name, style: `font-family:${fontStack(family)};font-size:16px`, checked: cur === family, onClick: () => this.applyFont(family) });
      }
    }
    showMenu(btn, items, { align: 'left' });
  }
  colorMenu(btn) {
    showMenu(btn, [
      { header: '글자 색' },
      { swatches: TEXT_COLORS, current: this.currentColor(), onPick: (c) => this.applyColor(c) },
      { header: '형광펜' },
      { swatches: HIGHLIGHTS, current: undefined, onPick: (c) => this.applyHighlight(c) },
    ], { align: 'left' });
  }

  selectAll() {
    this.body.focus();
    const r = document.createRange(); r.selectNodeContents(this.body);
    const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    this.savedRange = r.cloneRange();
    this.scheduleFloat();
  }

  async pasteFromClipboard() {
    this.restore();
    try {
      if (navigator.clipboard?.read) {
        for (const item of await navigator.clipboard.read()) {
          const img = item.types.find((t) => t.startsWith('image/'));
          if (img) { const blob = await item.getType(img); return this.insertImages([new File([blob], 'paste', { type: img })]); }
          if (item.types.includes('text/html')) { this.restore(); document.execCommand('insertHTML', false, sanitize(await (await item.getType('text/html')).text())); return this.changed(); }
          if (item.types.includes('text/plain')) { this.restore(); document.execCommand('insertText', false, await (await item.getType('text/plain')).text()); return this.changed(); }
        }
      } else {
        const t = await navigator.clipboard.readText();
        this.restore(); document.execCommand('insertText', false, t); this.changed();
      }
    } catch {
      toast('붙여넣기 권한이 없습니다. Ctrl+V(길게 눌러 붙여넣기)를 사용하세요');
    }
    this.hideFloat();
  }

  /* ───────── 현재 상태 표시 (굵게 버튼 켜짐, 크기 숫자 등) ───────── */
  anchorEl() {
    const n = this.savedRange?.startContainer;
    return n ? (n.nodeType === 1 ? n : n.parentElement) : this.body;
  }
  currentFont() {
    for (let el = this.anchorEl(); el && el !== this.body; el = el.parentElement) {
      const fam = el.style?.fontFamily;
      if (fam) { const f = fam.split(',')[0].replace(/["']/g, '').trim(); return FONTS.some((x) => x.family === f) ? f : null; }
    }
    return null;
  }
  currentColor() {
    for (let el = this.anchorEl(); el && el !== this.body; el = el.parentElement) {
      if (el.style?.color) return TEXT_COLORS.find((c) => c.value && sameColor(c.value, el.style.color))?.value ?? null;
    }
    return null;
  }
  refreshState() {
    if (!this.savedRange) return;
    this.stateButtons.forEach((b) => {
      try { b.classList.toggle('active', document.queryCommandState(this.actions()[b.dataset.key].cmd)); } catch {}
    });
    const px = parseFloat(getComputedStyle(this.anchorEl()).fontSize) || 16;
    const pt = fmtPt(Math.round(px * 0.75 * 2) / 2);
    this.sizeControls.forEach((i) => { if (document.activeElement !== i) i.value = pt; });
    const col = this.currentColor();
    (this.colorButtons || []).forEach((b) => b.style.setProperty('--tc', col || 'currentColor'));
    this.buttonsByKey('todo').forEach((b) => b.classList.toggle('active', !!this.blockAtCaret()?.classList.contains('todo')));
  }
  buttonsByKey(k) { return [...this.toolbar.querySelectorAll(`[data-key="${k}"]`), ...this.floatBar.querySelectorAll(`[data-key="${k}"]`)]; }

  /* ───────── 체크박스 줄 ───────── */
  blockOf(node) {
    let n = node?.nodeType === 1 ? node : node?.parentElement;
    while (n && n !== this.body) {
      if (n.tagName === 'LI' || n.parentElement === this.body) return n;
      n = n.parentElement;
    }
    return null;
  }
  blockAtCaret() { return this.blockOf(this.savedRange?.startContainer); }

  /* 줄 구조 정리
     메모는 "<div>줄</div>" 이 기본이지만, 붙여넣거나 예전에 쓴 메모는
     "<div>줄1<br>줄2<br>줄3</div>" 처럼 여러 줄이 한 덩어리인 경우가 많음.
     체크박스는 한 줄 단위여야 하므로, 필요한 부분만 진짜 한 줄(div)씩 나눔. */
  leafBlocks(range) { return leafBlocks(this.body).filter((b) => range.intersectsNode(b)); }
  // 선택한 범위의 줄들을 한 줄씩 정리하고 그 줄 목록을 돌려줌
  linesInSelection() {
    const off = getOffsets(this.body);
    if (!off) return [];
    wrapInlineRuns(this.body);
    setOffsets(this.body, off);
    let r = document.getSelection().getRangeAt(0);
    this.leafBlocks(r).forEach(splitAtBreaks);
    setOffsets(this.body, off);
    r = document.getSelection().getRangeAt(0);
    return this.leafBlocks(r);
  }

  toggleTodo() {
    this.restore();
    if (!this.body.textContent.trim() && !this.body.querySelector('img')) {
      this.body.innerHTML = '<div class="todo"><br></div>';
      setOffsets(this.body, [0, 0]);
      return this.changed();
    }
    const blocks = this.linesInSelection();
    if (!blocks.length) return;
    const allTodo = blocks.every((b) => b.classList.contains('todo'));
    blocks.forEach((b) => {
      if (allTodo) { b.classList.remove('todo'); delete b.dataset.done; if (!b.className) b.removeAttribute('class'); }
      else b.classList.add('todo');
    });
    this.savedRange = document.getSelection().getRangeAt(0).cloneRange();
    this.refreshState();
    this.changed();
  }

  hitCheckbox(p) {
    const blk = p?.target?.closest?.('.todo') || document.elementFromPoint(p.clientX, p.clientY)?.closest?.('.todo');
    if (!blk || !this.body.contains(blk)) return false;
    const rect = blk.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(blk).paddingLeft) || 24;
    if (p.clientX < rect.left || p.clientX > rect.left + pad) return false;
    if (blk.dataset.done !== undefined) delete blk.dataset.done; else blk.dataset.done = '';
    navigator.vibrate?.(10);
    this.changed();
    return true;
  }

  onKey(e) {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && !e.shiftKey && k === 't') { e.preventDefault(); this.exec('strikeThrough'); }
    else if (mod && e.shiftKey && k === 'l') { e.preventDefault(); this.exec('insertUnorderedList'); }
    else if (mod && e.shiftKey && k === 'c') { e.preventDefault(); this.toggleTodo(); }
    else if (mod && (e.key === ']' || e.key === '>' || e.key === '.')) { e.preventDefault(); this.sizeStep(1); }
    else if (mod && (e.key === '[' || e.key === '<' || e.key === ',')) { e.preventDefault(); this.sizeStep(-1); }
    else if (e.key === 'Escape') this.hideFloat();
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Backspace') {
      const sel = document.getSelection();
      if (!sel.isCollapsed) return;
      const blk = this.blockOf(sel.anchorNode);
      if (!blk?.classList.contains('todo')) return;
      const pre = document.createRange(); pre.selectNodeContents(blk); pre.setEnd(sel.anchorNode, sel.anchorOffset);
      // 빈 체크박스 줄에서 Enter, 줄 맨 앞에서 Backspace → 체크박스만 없앰 (글머리 기호와 같은 동작)
      if ((e.key === 'Enter' && !blk.textContent.trim()) || (e.key === 'Backspace' && pre.toString().length === 0)) {
        e.preventDefault();
        blk.classList.remove('todo'); delete blk.dataset.done; if (!blk.className) blk.removeAttribute('class');
        this.refreshState(); this.changed();
      }
    }
  }
  sizeStep(dir) {
    const cur = parseFloat(this.sizeControls[0].value) || 12;
    this.applySize(dir > 0 ? SIZES.find((s) => s > cur) ?? 72 : [...SIZES].reverse().find((s) => s < cur) ?? 8);
  }

  async onPaste(e) {
    const cd = e.clipboardData;
    const images = [...(cd?.files || [])].filter((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (images.length) return this.insertImages(images);
    const html = cd.getData('text/html');
    if (html) { const clean = sanitize(html); ensureFontsIn(clean); document.execCommand('insertHTML', false, clean); }
    else document.execCommand('insertText', false, cd.getData('text/plain'));
  }

  async insertImages(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const src = await compressImage(f);
        this.restore();
        document.execCommand('insertHTML', false, `<img src="${src}" alt=""><br>`);
      } catch { toast('이미지를 불러오지 못했습니다'); }
    }
    this.fileInput.value = '';
    this.updateEmpty();
    this.save.flush();
    closeMenu();
  }
}

const fmtPt = (pt) => String(Math.round(pt * 2) / 2);
function sameColor(hex, rgb) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})` === rgb.replace(/\s+/g, ' ');
}

// 선택 위치를 '글자 수'로 저장/복원 (원격 변경 반영·줄 정리 후에도 커서·선택 유지)
function getOffsets(root) {
  const sel = document.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  pre.setEnd(r.endContainer, r.endOffset);
  return [start, pre.toString().length];
}
function setOffsets(root, [start, end]) {
  // 줄 경계에서는 시작점은 다음 줄, 끝점은 앞 줄에 붙임 (선택이 옆 줄로 번지지 않도록)
  const find = (target, isStart) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node, left = target, last = null;
    while ((node = walker.nextNode())) {
      if (isStart && start !== end ? left < node.length : left <= node.length) return [node, left];
      left -= node.length; last = node;
    }
    if (last) return [last, last.length];
    const blk = root.querySelector('div, p, li') || root;
    return [blk, 0];
  };
  const r = document.createRange();
  r.setStart(...find(start, true)); r.setEnd(...find(end, false));
  const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}

function insertTextAt(block, offset, text) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node, left = offset, last = null;
  while ((node = walker.nextNode())) {
    if (left <= node.length) { node.insertData(left, text); return; }
    left -= node.length; last = node;
  }
  if (last) last.appendData(text); else block.prepend(document.createTextNode(text));
}
