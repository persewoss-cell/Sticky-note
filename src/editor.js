// 메모 본문 편집기 (휴대폰 편집 화면과 Windows 메모 창이 함께 사용)
import { I } from './icons.js';
import { h, sanitize, htmlToText, compressImage, debounce, toast } from './util.js';

const FORMATS = [
  { cmd: 'bold', icon: I.bold, title: '굵게 (Ctrl+B)' },
  { cmd: 'italic', icon: I.italic, title: '기울임꼴 (Ctrl+I)' },
  { cmd: 'underline', icon: I.underline, title: '밑줄 (Ctrl+U)' },
  { cmd: 'strikeThrough', icon: I.strike, title: '취소선 (Ctrl+T)' },
  { cmd: 'insertUnorderedList', icon: I.bullets, title: '글머리 기호 (Ctrl+Shift+L)' },
];

export class Editor {
  constructor(store, id) {
    this.store = store;
    this.id = id;
    this.lastSaved = null;
    this.save = debounce(() => this.saveNow(), 400);

    this.body = h('div', {
      class: 'editor-body', contenteditable: 'true', spellcheck: 'false',
      'data-placeholder': '메모하기...',
    });
    this.fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onChange: (e) => this.insertImages(e.target.files) });
    this.buttons = FORMATS.map((f) =>
      h('button', {
        class: 'fmt-btn', title: f.title, html: f.icon, 'data-cmd': f.cmd,
        onMousedown: (e) => { e.preventDefault(); this.exec(f.cmd); },
      }));
    this.toolbar = h('div', { class: 'format-bar' }, ...this.buttons,
      h('button', { class: 'fmt-btn', title: '이미지 추가', html: I.image,
        onMousedown: (e) => e.preventDefault(), onClick: () => this.fileInput.click() }),
      this.fileInput);

    this.body.addEventListener('input', () => { this.updateEmpty(); this.save(); });
    this.body.addEventListener('paste', (e) => this.onPaste(e));
    this.body.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); this.insertImages(files); }
    });
    this.body.addEventListener('keydown', (e) => this.onKey(e));
    this.body.addEventListener('blur', () => this.save.flush());
    this.body.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank');
    });
    this.onSel = () => this.refreshButtons();
    document.addEventListener('selectionchange', this.onSel);
    window.addEventListener('beforeunload', () => this.save.flush());
  }

  destroy() {
    this.save.flush();
    document.removeEventListener('selectionchange', this.onSel);
  }

  // 원격(다른 기기) 변경을 반영. 이 기기에서 입력 중인 내용이 있으면 덮어쓰지 않음.
  setNote(note) {
    const html = sanitize(note.html);
    if (html === this.lastSaved || html === this.currentHtml()) { this.lastSaved = html; return; }
    if (this.lastSaved !== null && this.currentHtml() !== this.lastSaved) return; // 저장 대기 중인 로컬 편집 우선
    const focused = document.activeElement === this.body;
    const caret = focused ? getCaret(this.body) : null;
    this.body.innerHTML = html;
    this.lastSaved = this.currentHtml(); // 브라우저가 정규화한 형태로 기억
    if (caret != null) setCaret(this.body, caret);
    this.updateEmpty();
  }

  currentHtml() { return sanitize(this.body.innerHTML); }
  updateEmpty() { this.body.classList.toggle('empty', !this.body.textContent.trim() && !this.body.querySelector('img')); }

  saveNow() {
    const html = this.currentHtml();
    if (html === this.lastSaved) return;
    if (html.length > 850_000) { toast('메모가 너무 큽니다. 사진을 줄여주세요.'); return; }
    this.lastSaved = html;
    this.store.update(this.id, { html, text: htmlToText(html) });
  }

  exec(cmd) {
    if (document.activeElement !== this.body) this.body.focus();
    document.execCommand(cmd, false);
    this.refreshButtons();
    this.save();
  }

  refreshButtons() {
    if (!this.body.contains(document.getSelection()?.anchorNode)) return;
    this.buttons.forEach((b) => {
      try { b.classList.toggle('active', document.queryCommandState(b.dataset.cmd)); } catch {}
    });
  }

  onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); this.exec('strikeThrough'); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); this.exec('insertUnorderedList'); }
  }

  async onPaste(e) {
    const cd = e.clipboardData;
    const images = [...(cd?.files || [])].filter((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (images.length) return this.insertImages(images);
    const html = cd.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitize(html));
    else document.execCommand('insertText', false, cd.getData('text/plain'));
  }

  async insertImages(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const src = await compressImage(f);
        this.body.focus();
        document.execCommand('insertHTML', false, `<img src="${src}" alt=""><br>`);
      } catch { toast('이미지를 불러오지 못했습니다'); }
    }
    this.fileInput.value = '';
    this.updateEmpty();
    this.save.flush();
  }
}

// 커서 위치를 '텍스트 글자 수'로 저장/복원 (원격 변경 반영 시 커서가 튀지 않도록)
function getCaret(root) {
  const sel = document.getSelection();
  if (!sel.rangeCount || !root.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(root);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length;
}
function setCaret(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node, left = offset;
  while ((node = walker.nextNode())) {
    if (left <= node.length) {
      const r = document.createRange();
      r.setStart(node, left); r.collapse(true);
      const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return;
    }
    left -= node.length;
  }
}
