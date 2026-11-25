import DOMPurify from 'dompurify';

// Windows 스티커 메모와 같은 7가지 색 (swatch = 메뉴의 색상 버튼)
export const COLORS = {
  yellow:   { name: '노랑',   swatch: '#FFE66E', body: '#FFF7D1', bar: '#FFF2AB' },
  green:    { name: '초록',   swatch: '#A1EF9B', body: '#E4F9E0', bar: '#CBF1C4' },
  pink:     { name: '분홍',   swatch: '#FFAFDF', body: '#FFE4F1', bar: '#FFCCE5' },
  purple:   { name: '보라',   swatch: '#D7AFFF', body: '#F2E6FF', bar: '#E7CFFF' },
  blue:     { name: '파랑',   swatch: '#9EDFFF', body: '#E2F1FF', bar: '#CDE9FF' },
  gray:     { name: '회색',   swatch: '#E0E0E0', body: '#F3F2F1', bar: '#E1DFDD' },
  charcoal: { name: '차콜',   swatch: '#767676', body: '#696969', bar: '#494745', dark: true },
};
export const colorOf = (key) => COLORS[key] || COLORS.yellow;

export function applyNoteColor(el, key) {
  const c = colorOf(key);
  el.style.setProperty('--note-body', c.body);
  el.style.setProperty('--note-bar', c.bar);
  el.style.setProperty('--note-accent', c.swatch);
  el.classList.toggle('note-dark', !!c.dark);
}

// 서식에 필요한 스타일만 남기고 나머지는 지움 (글자색·형광펜·글씨체·크기·굵기 등)
const STYLE_PROPS = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line']);
const SAFE_VALUE = /^(?:[#\w\s,.'"%-]+|rgba?\([\d\s.,%]+\))$/;
export function filterStyle(style) {
  return style.split(';').map((d) => {
    const i = d.indexOf(':');
    if (i < 0) return '';
    const prop = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).trim();
    return STYLE_PROPS.has(prop) && SAFE_VALUE.test(val) && !/url|expression/i.test(val) ? `${prop}: ${val}` : '';
  }).filter(Boolean).join('; ');
}
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'style') {
    data.attrValue = filterStyle(data.attrValue);
    if (!data.attrValue) data.keepAttr = false;
  } else if (data.attrName === 'class') {
    data.attrValue = data.attrValue.split(/\s+/).filter((c) => c === 'todo').join(' '); // 체크박스 줄만 허용
    if (!data.attrValue) data.keepAttr = false;
  }
});
const PURIFY = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li', 'img', 'a', 'font'],
  ALLOWED_ATTR: ['src', 'href', 'alt', 'style', 'class', 'data-done', 'color', 'face'],
  ALLOW_DATA_ATTR: false, // data-* 는 위에 적은 것(data-done)만
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
};
export const sanitize = (html) => DOMPurify.sanitize(html || '', PURIFY);

export function htmlToText(html) {
  const d = document.createElement('div');
  d.innerHTML = sanitize(html).replace(/<(br|\/p|\/div|\/li)>/gi, '$&\n');
  return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
export const isEmptyHtml = (html) => !htmlToText(html) && !/<img/i.test(html || '');

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 오늘이면 "오후 7:16", 올해면 "10월 30일", 그 외 "2025. 10. 30."
export function formatTime(ms) {
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  return d.toLocaleDateString('ko-KR');
}

// 사진은 Firestore 문서(최대 1MB) 안에 들어가도록 줄여서 저장
export function compressImage(file, maxSide = 1280, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = quality, out = c.toDataURL('image/jpeg', q);
      while (out.length > 350_000 && q > 0.35) out = c.toDataURL('image/jpeg', (q -= 0.1));
      resolve(out);
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/* 기기별 설정 (동기화하지 않음) */
const SETTINGS_KEY = 'sticky.settings.v1';
const DEFAULTS = { theme: 'system', confirmDelete: true, sort: 'updated', layout: 'grid', mode: null };
export const settings = {
  get() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; } catch { return { ...DEFAULTS }; } },
  set(patch) { const s = { ...this.get(), ...patch }; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); applyTheme(); return s; },
};
export function applyTheme() {
  const t = settings.get().theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
window.addEventListener('storage', (e) => e.key === SETTINGS_KEY && applyTheme());

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export function toast(msg, ms = 2200) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}
