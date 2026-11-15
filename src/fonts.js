// 글씨체 목록: PC와 휴대폰에서 똑같이 보이도록 Google 무료 한글 글꼴을 필요할 때만 불러옵니다.
export const DEFAULT_FONT = { name: '기본 글씨체', family: null };

export const FONT_GROUPS = [
  ['고딕', [
    ['나눔고딕', 'Nanum Gothic'], ['본고딕 (Noto Sans)', 'Noto Sans KR'], ['고딕 A1', 'Gothic A1'],
    ['IBM 플렉스 산스', 'IBM Plex Sans KR'], ['고운돋움', 'Gowun Dodum'], ['해바라기', 'Sunflower'], ['오르빗', 'Orbit'],
  ]],
  ['명조', [
    ['나눔명조', 'Nanum Myeongjo'], ['본명조 (Noto Serif)', 'Noto Serif KR'], ['고운바탕', 'Gowun Batang'],
    ['송명', 'Song Myung'], ['함렛', 'Hahmlet'],
  ]],
  ['손글씨', [
    ['나눔손글씨 펜', 'Nanum Pen Script'], ['나눔손글씨 붓', 'Nanum Brush Script'], ['감자꽃', 'Gamja Flower'],
    ['개구', 'Gaegu'], ['하이멜로디', 'Hi Melody'], ['푸어스토리', 'Poor Story'], ['싱글데이', 'Single Day'],
    ['연성', 'Yeon Sung'], ['동해독도', 'East Sea Dokdo'], ['독도', 'Dokdo'], ['기랑해랑', 'Kirang Haerang'],
    ['큐트폰트', 'Cute Font'], ['스타일리시', 'Stylish'],
  ]],
  ['귀여운·제목', [
    ['주아', 'Jua'], ['도현', 'Do Hyeon'], ['검은고딕', 'Black Han Sans'], ['구기', 'Gugi'],
    ['동글', 'Dongle'], ['베이글', 'Bagel Fat One'],
  ]],
  ['고정폭 (코딩체)', [
    ['나눔고딕코딩', 'Nanum Gothic Coding'],
  ]],
];
export const FONTS = FONT_GROUPS.flatMap(([, list]) => list.map(([name, family]) => ({ name, family })));
const FAMILIES = new Set(FONTS.map((f) => f.family));

const loaded = new Set();
const cssUrl = (family, text) =>
  `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap` +
  (text ? `&text=${encodeURIComponent(text)}` : '');

function addLink(href) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.append(l);
}

/** 글꼴 전체를 불러옴 (메모에 실제로 쓸 때) */
export function ensureFont(family) {
  if (!family || !FAMILIES.has(family) || loaded.has(family)) return;
  loaded.add(family);
  addLink(cssUrl(family));
}

/** 메뉴 미리보기용: 글꼴 이름 글자만 아주 작게 불러옴 */
const previewed = new Set();
export function previewFont(f) {
  if (!f.family || loaded.has(f.family) || previewed.has(f.family)) return;
  previewed.add(f.family);
  addLink(cssUrl(f.family, f.name));
}

/** 메모 HTML 안에서 쓰인 글꼴을 찾아 불러옴 */
export function ensureFontsIn(html) {
  if (!html || !html.includes('font-family')) return;
  for (const m of html.matchAll(/font-family:\s*([^;"]+)/g)) {
    const fam = m[1].split(',')[0].trim().replace(/^['"]|['"]$/g, '').replace(/&quot;/g, '');
    ensureFont(fam);
  }
}

export const fontStack = (family) => `"${family}"`;
