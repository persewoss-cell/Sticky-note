// 메모 HTML 을 '한 줄 = 한 블록' 구조로 정리하고, 두 시점을 비교해 지운 부분만 찾아냄
const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE)$/;
const LEAF_SEL = 'div, p, li, h1, h2, h3, h4, h5, h6, blockquote';
const isBlock = (n) => n?.nodeType === 1 && BLOCK.test(n.tagName);

/** 블록과 글자가 섞인 곳의 글자 묶음을 div 로 감쌈 */
export function wrapInlineRuns(container, isRoot = true) {
  if (!isRoot && ![...container.childNodes].some(isBlock)) return;
  let run = [];
  const flush = () => {
    if (run.length && run.some((n) => n.nodeType !== 3 || n.data.trim() || run.length > 1)) {
      const d = document.createElement('div'); run[0].before(d); d.append(...run);
    }
    run = [];
  };
  for (const n of [...container.childNodes]) {
    if (isBlock(n)) { flush(); if (!/^(UL|OL)$/.test(n.tagName)) wrapInlineRuns(n, false); }
    else run.push(n);
  }
  flush();
}

/** 한 블록 안의 <br> 줄바꿈마다 블록을 나눔 (서식은 복제되어 유지) */
export function splitAtBreaks(block) {
  const out = [block];
  let cur = block, br;
  while ((br = cur.querySelector('br'))) {
    const rest = document.createRange();
    rest.setStartAfter(br); rest.setEnd(cur, cur.childNodes.length);
    const hasAfter = !rest.collapsed && (rest.toString().length > 0 || rest.cloneContents().querySelector?.('img, br'));
    if (!hasAfter) break; // 줄 끝 자리표시용 <br>
    const frag = rest.extractContents();
    br.remove();
    const next = cur.cloneNode(false);
    next.removeAttribute('data-done');
    next.append(frag);
    if (!next.textContent && !next.querySelector('img, br')) next.append(document.createElement('br'));
    if (!cur.textContent && !cur.querySelector('img, br')) cur.append(document.createElement('br'));
    cur.after(next);
    out.push(next); cur = next;
  }
  return out;
}

export const leafBlocks = (root) =>
  [...root.querySelectorAll(LEAF_SEL)].filter((b) => !b.querySelector(LEAF_SEL + ', ul, ol'));

/** 전체를 한 줄 = 한 블록으로 정리 */
export function normalizeAll(root) {
  wrapInlineRuns(root);
  leafBlocks(root).forEach(splitAtBreaks);
}

const PHOTO = '[사진]';
export function blockText(b) {
  let t = '';
  const walk = (n) => {
    if (n.nodeType === 3) t += n.data;
    else if (n.nodeName === 'IMG') t += PHOTO;
    else n.childNodes.forEach(walk);
  };
  walk(b);
  return t.replace(/ /g, ' ');
}

/** HTML → 줄 목록 (원본은 건드리지 않음) */
export function htmlToLines(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  normalizeAll(d);
  const blocks = leafBlocks(d);
  if (!blocks.length) return d.textContent ? [blockText(d)] : [];
  return blocks.map(blockText);
}

/* ───────── 비교 ───────── */
function lcsPairs(a, b, eq = (x, y) => x === y) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

const count = (s) => s.replace(/\s/g, '').length;
const similarity = (a, b) => {
  if (!a || !b) return 0;
  const A = [...a].slice(0, 400), B = [...b].slice(0, 400);
  return (2 * lcsPairs(A, B).length) / (A.length + B.length);
};

// 한 줄 안에서 지운 글자 구간 [시작, 끝] 목록 (원래 줄 기준 위치)
function deletedSpans(before, after) {
  const A = [...before], B = [...after];
  const keep = new Set(lcsPairs(A, B).map(([i]) => i));
  const spans = [];
  for (let i = 0; i < A.length; i++) {
    if (keep.has(i)) continue;
    const last = spans[spans.length - 1];
    if (last && last[1] === i) last[1] = i + 1; else spans.push([i, i + 1]);
  }
  // 위치를 JS 문자열 기준으로 변환 (이모지 등 대비)
  const idx = [0]; A.forEach((c) => idx.push(idx[idx.length - 1] + c.length));
  return spans.map(([s, e]) => [idx[s], idx[e]]);
}

/**
 * 이전(before) → 이후(after) 에서 지운 내용 목록
 *  { type: 'line', lines: [...], prev, next }      줄째로 지움
 *  { type: 'part', line, spans: [[s,e]...], now, prev, next }  줄 일부를 지움
 */
export function findDeletions(beforeHtml, afterHtml, minChars = 3) {
  const A = htmlToLines(beforeHtml), B = htmlToLines(afterHtml);
  if (A.length > 3000 || B.length > 3000) return [];
  const anchors = [[-1, -1], ...lcsPairs(A, B), [A.length, B.length]];
  const out = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [a0, b0] = anchors[k], [a1, b1] = anchors[k + 1];
    const gapA = A.slice(a0 + 1, a1), gapB = B.slice(b0 + 1, b1);
    if (!gapA.length) continue;
    // 바뀐 줄끼리 짝짓기 (비슷한 줄 = 일부만 고친 줄)
    const used = new Set();
    let pendingLines = [], pendingPrev = null;
    const flushLines = (next) => {
      const text = pendingLines.join('');
      if (pendingLines.length && count(text) >= minChars) out.push({ type: 'line', lines: pendingLines, prev: pendingPrev, next });
      pendingLines = [];
    };
    gapA.forEach((line, i) => {
      let best = -1, bestScore = 0.5;
      gapB.forEach((cand, j) => {
        if (used.has(j)) return;
        const sc = similarity(line, cand);
        if (sc > bestScore) { bestScore = sc; best = j; }
      });
      const prevLine = i ? gapA[i - 1] : A[a0] ?? null;
      if (best >= 0) {
        flushLines(line);
        used.add(best);
        const spans = deletedSpans(line, gapB[best]);
        const deleted = spans.map(([s, e]) => line.slice(s, e)).join('');
        if (count(deleted) >= minChars) out.push({ type: 'part', line, spans, now: gapB[best], prev: prevLine, next: gapA[i + 1] ?? A[a1] ?? null });
      } else {
        if (!pendingLines.length) pendingPrev = prevLine;
        pendingLines.push(line);
      }
    });
    flushLines(A[a1] ?? null);
  }
  return out;
}
