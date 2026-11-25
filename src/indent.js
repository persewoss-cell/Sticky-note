// 내어쓰기: 줄이 "- 사과", "1. 사과" 처럼 기호 + 띄어쓰기로 시작하면
// 다음 줄로 넘어간 글자가 기호 뒤 첫 글자에 맞춰 정렬되도록 (화면에만 적용, 메모 내용은 그대로)
import { leafBlocks, blockText } from './lines.js';

const BULLET = '[-•·*→※]';
const NUMBER = '\\d{1,3}[.)]|\\(\\d{1,3}\\)|[①-⑳]';
export const MARKER_RE = new RegExp(`^\\s*(${BULLET}|${NUMBER})[ \\u00a0]`);

/** 다음 줄에 이어 붙일 기호 (숫자는 다음 번호) */
export function nextMarker(marker) {
  let m;
  if ((m = marker.match(/^(\d+)([.)])$/))) return `${+m[1] + 1}${m[2]}`;
  if ((m = marker.match(/^\((\d+)\)$/))) return `(${+m[1] + 1})`;
  if (/^[①-⑲]$/.test(marker)) return String.fromCharCode(marker.charCodeAt(0) + 1);
  if (marker === '⑳') return '⑳';
  return marker;
}

/** 줄 맨 앞 기호 (없으면 null) */
export function markerOf(text) {
  const m = text.match(MARKER_RE);
  return m ? { marker: m[1], length: m[0].length } : null;
}

// 글자 위치(offset)까지의 실제 폭을 잼
function prefixWidth(block, length) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let node, left = length, started = false;
  while ((node = walker.nextNode())) {
    if (!started) { r.setStart(node, 0); started = true; }
    if (left <= node.length) { r.setEnd(node, left); return r.getBoundingClientRect().width; }
    left -= node.length;
  }
  return 0;
}

/** 화면의 모든 줄에 내어쓰기 적용 / 해제 */
export function applyHanging(root) {
  for (const b of leafBlocks(root)) {
    if (b.classList.contains('todo') || b.tagName === 'LI') continue;
    const mk = markerOf(blockText(b));
    if (!mk) {
      if (b.dataset.hang) { b.style.removeProperty('padding-left'); b.style.removeProperty('text-indent'); delete b.dataset.hang; }
      continue;
    }
    // 화면 배율(목록 미리보기 축소 등)과 상관없이 맞도록 CSS 픽셀로 환산
    const rect = b.getBoundingClientRect();
    const scale = b.offsetWidth ? rect.width / b.offsetWidth : 1;
    const w = prefixWidth(b, mk.length) / (scale || 1);
    if (!w) continue;
    const px = Math.round(w * 10) / 10 + 'px';
    if (b.style.paddingLeft !== px) { b.style.paddingLeft = px; b.style.textIndent = '-' + px; }
    b.dataset.hang = '1';
  }
}
