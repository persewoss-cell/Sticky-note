import './styles.css';
import { LocalStore, CloudStore, cloudConfigured, initFirebase, newId } from './store.js';
import { h, sanitize, formatTime, applyNoteColor, applyTheme, settings, isEmptyHtml, toast } from './util.js';
import { I } from './icons.js';
import { Editor } from './editor.js';
import { showMenu, confirmDialog, sheet, closeMenu } from './ui.js';
import { renderNoteWindow } from './noteWindow.js';

const desktop = window.desktop || null; // Electron preload 가 제공 (Windows 앱일 때만)
const app = document.getElementById('app');
document.body.classList.toggle('is-desktop', !!desktop);
applyTheme();

const params = new URLSearchParams(location.hash.slice(1));
const noteParam = params.get('note');

// 오프라인에서도 열리도록 (휴대폰 웹앱 + 웹 주소에서 불러온 Windows 앱)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
watchForUpdates();

boot();

async function boot() {
  if (!cloudConfigured()) return start(new LocalStore(), null);
  if (settings.get().mode === 'local') return start(new LocalStore(), null);

  let fb;
  try { fb = await initFirebase(); } catch (e) { console.error(e); toast('Firebase 초기화 실패 — 로컬 모드로 실행합니다'); return start(new LocalStore(), null); }
  let current = Symbol('init'); // 첫 호출은 항상 처리
  fb.authMod.onAuthStateChanged(fb.auth, async (user) => {
    const uid = user?.uid ?? null;
    if (uid === current) return;
    current = uid;
    if (!user) {
      if (noteParam) { desktop?.closeWindow(); return; }
      desktop?.closeAllNotes?.();
      return renderAuth(fb);
    }
    const store = new CloudStore(fb, user.uid);
    if (!noteParam) await offerMigration(store);
    start(store, { user, fb });
  });
}

function start(store, session) {
  if (noteParam) return renderNoteWindow(app, store, noteParam, params.get('new') === '1');
  renderList(store, session);
}

/* ───────────────────────── 로그인 ───────────────────────── */
function renderAuth(fb) {
  const { authMod, auth } = fb;
  let signup = false;
  const email = h('input', { type: 'email', placeholder: '이메일', autocomplete: 'email', required: true });
  const pw = h('input', { type: 'password', placeholder: '비밀번호 (6자 이상)', autocomplete: 'current-password', required: true, minlength: 6 });
  const err = h('p', { class: 'auth-error' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '로그인');
  const toggle = h('button', { class: 'link', type: 'button', onClick: () => {
    signup = !signup;
    submit.textContent = signup ? '회원가입' : '로그인';
    toggle.textContent = signup ? '이미 계정이 있어요 → 로그인' : '처음이에요 → 회원가입';
    pw.autocomplete = signup ? 'new-password' : 'current-password';
  } }, '처음이에요 → 회원가입');
  const reset = h('button', { class: 'link', type: 'button', onClick: async () => {
    if (!email.value) return (err.textContent = '이메일을 먼저 입력하세요');
    try { await authMod.sendPasswordResetEmail(auth, email.value); toast('비밀번호 재설정 메일을 보냈습니다'); }
    catch (e) { err.textContent = authError(e); }
  } }, '비밀번호를 잊었어요');

  const form = h('form', { class: 'auth-form', onSubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; submit.disabled = true;
    try {
      if (signup) await authMod.createUserWithEmailAndPassword(auth, email.value.trim(), pw.value);
      else await authMod.signInWithEmailAndPassword(auth, email.value.trim(), pw.value);
    } catch (e) { err.textContent = authError(e); }
    submit.disabled = false;
  } }, email, pw, err, submit, h('div', { class: 'auth-links' }, toggle, reset));

  app.replaceChildren(h('div', { class: 'auth' },
    desktop ? titleBar() : null,
    h('div', { class: 'auth-card' },
      h('div', { class: 'auth-logo', html: I.cloud }),
      h('h1', {}, '스티커 메모'),
      h('p', { class: 'muted' }, '휴대폰과 컴퓨터에서 같은 계정으로 로그인하면 메모가 실시간으로 동기화됩니다.'),
      form,
      h('button', { class: 'link small', onClick: () => { settings.set({ mode: 'local' }); location.reload(); } },
        '로그인 없이 이 기기에서만 사용'))));
  email.focus();
}

function authError(e) {
  const m = {
    'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 틀렸습니다.',
    'auth/wrong-password': '이메일 또는 비밀번호가 틀렸습니다.',
    'auth/user-not-found': '가입되지 않은 이메일입니다.',
    'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인하세요.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
    'auth/network-request-failed': '인터넷 연결을 확인하세요.',
    'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'src/firebase-config.js 의 apiKey 값이 올바르지 않습니다.',
    'auth/operation-not-allowed': 'Firebase 콘솔에서 이메일/비밀번호 로그인을 켜야 합니다.',
  };
  return m[e.code] || e.message;
}

async function offerMigration(cloud) {
  const local = new LocalStore();
  const notes = local.all();
  if (!notes.length) return;
  const ok = await confirmDialog(`이 기기에만 저장된 메모 ${notes.length}개가 있습니다. 계정으로 옮겨서 동기화할까요?`, { ok: '옮기기', danger: false });
  if (!ok) return;
  try { await cloud.importMany(notes); local.clear(); toast('메모를 옮겼습니다'); }
  catch (e) { toast('옮기기 실패: ' + e.message); }
}

/* ───────────────────────── 메모 목록 ───────────────────────── */
function titleBar(extraLeft = [], extraRight = []) {
  // Windows 창 상단 (드래그 가능 영역)
  return h('div', { class: 'titlebar' },
    ...extraLeft, h('div', { class: 'drag' }), ...extraRight,
    h('button', { class: 'icon-btn', title: '닫기', html: I.close, onClick: () => desktop.closeWindow() }));
}

function renderList(store, session) {
  let notes = [];
  let query = '';
  let selected = new Set();
  let editor = null; // 휴대폰 편집 화면
  const isDesktop = !!desktop;
  const s = () => settings.get();

  const grid = h('div', { class: 'cards' });
  const search = h('input', { type: 'search', class: 'search-input', placeholder: '검색...', onInput: (e) => { query = e.target.value.trim().toLowerCase(); draw(); } });

  const newNote = async () => {
    if (isDesktop) return desktop.newNote();
    const id = await store.create(newId(), { color: lastColor() });
    openEditor(id, true);
  };

  /* 헤더 */
  const header = h('header', { class: 'list-header' });
  const selHeader = h('header', { class: 'list-header select-header' });
  const searchRow = h('div', { class: 'search-row' + (isDesktop ? ' open' : '') }, search, h('span', { class: 'search-icon', html: I.search }));

  function drawHeader() {
    if (selected.size) {
      const sel = notes.filter((n) => selected.has(n.id));
      const allPinned = sel.every((n) => n.pinned);
      selHeader.replaceChildren(
        h('button', { class: 'icon-btn', title: '선택 취소', html: I.close, onClick: clearSel }),
        h('div', { class: 'sel-count' }, `${selected.size}개 선택됨`),
        h('button', { class: 'icon-btn', title: allPinned ? '고정 해제' : '상단 고정', html: I.pin, onClick: () => {
          sel.forEach((n) => store.update(n.id, { pinned: !allPinned, updatedAt: n.updatedAt })); clearSel();
        } }),
        h('button', { class: 'icon-btn', title: '공유', html: I.share, onClick: () => { shareNotes(sel); clearSel(); } }),
        h('button', { class: 'icon-btn', title: '더보기', html: I.moreV, onClick: (e) => showMenu(e.currentTarget, [
          { colors: sel.length === 1 ? sel[0].color : null, onPick: (c) => { sel.forEach((n) => store.update(n.id, { color: c })); clearSel(); } },
          { label: selected.size === notes.length ? '전체 선택 해제' : '전체 선택', icon: I.check, onClick: () => {
            selected = selected.size === notes.length ? new Set() : new Set(notes.map((n) => n.id)); draw(); } },
          { label: '삭제', icon: I.trash, danger: true, onClick: () => deleteNotes(sel) },
        ]) }));
      return;
    }
    const name = session?.user?.email || '';
    const avatar = h('button', { class: 'avatar', title: name || '설정', onClick: openSettings },
      session ? name.slice(0, 2) : h('span', { html: I.gear }));
    if (isDesktop) {
      header.replaceChildren(titleBar(
        [h('button', { class: 'icon-btn', title: '새 메모 (Ctrl+N)', html: I.plus, onClick: newNote })],
        [h('button', { class: 'icon-btn', title: '설정', html: I.gear, onClick: openSettings })]),
        h('h1', { class: 'list-title' }, '스티커 메모'));
    } else {
      header.replaceChildren(avatar, h('div', { class: 'grow' }),
        h('button', { class: 'icon-btn', title: '정렬', html: I.sliders, onClick: (e) => showMenu(e.currentTarget, [
          { label: (s().sort === 'updated' ? '✓ ' : '') + '수정한 날짜순', onClick: () => { settings.set({ sort: 'updated' }); draw(); } },
          { label: (s().sort === 'created' ? '✓ ' : '') + '만든 날짜순', onClick: () => { settings.set({ sort: 'created' }); draw(); } },
          { label: (s().sort === 'color' ? '✓ ' : '') + '색상순', onClick: () => { settings.set({ sort: 'color' }); draw(); } },
        ]) }),
        h('button', { class: 'icon-btn', title: '보기 방식', html: s().layout === 'grid' ? I.grid : I.grid2, onClick: () => {
          settings.set({ layout: s().layout === 'grid' ? 'list' : 'grid' }); draw(); } }),
        h('button', { class: 'icon-btn', title: '검색', html: I.search, onClick: () => {
          searchRow.classList.toggle('open'); if (searchRow.classList.contains('open')) search.focus(); else { search.value = ''; query = ''; draw(); } } }));
    }
  }

  /* 카드 */
  function sorted() {
    const colorIdx = (c) => ['yellow', 'green', 'pink', 'purple', 'blue', 'gray', 'charcoal'].indexOf(c);
    const by = { updated: (a, b) => b.updatedAt - a.updatedAt, created: (a, b) => b.createdAt - a.createdAt,
      color: (a, b) => colorIdx(a.color) - colorIdx(b.color) || b.updatedAt - a.updatedAt }[s().sort] || ((a, b) => b.updatedAt - a.updatedAt);
    return notes
      .filter((n) => !query || (n.text || '').toLowerCase().includes(query))
      .sort((a, b) => (b.pinned - a.pinned) || by(a, b));
  }

  function card(n) {
    const isSel = selected.has(n.id);
    const preview = h('div', { class: 'card-content', html: sanitize(n.html) || '<span class="muted">빈 메모</span>' });
    const el = h('div', { class: 'card' + (isSel ? ' selected' : '') + (n.pinned ? ' pinned' : ''), tabindex: 0, 'data-id': n.id },
      h('div', { class: 'card-bar' }),
      h('div', { class: 'card-meta' },
        n.pinned ? h('span', { class: 'pin-mark', html: I.pin, title: '고정됨' }) : null,
        h('span', { class: 'time' }, formatTime(n.updatedAt))),
      selected.size ? h('span', { class: 'sel-circle' + (isSel ? ' on' : ''), html: isSel ? I.check : '' }) : null,
      preview,
      h('div', { class: 'card-fade' }));
    applyNoteColor(el, n.color);

    // 길게 누르면 선택 모드 (휴대폰), 우클릭은 메뉴 (컴퓨터)
    let timer, long = false, sx = 0, sy = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      long = false; sx = e.clientX; sy = e.clientY;
      timer = setTimeout(() => { long = true; navigator.vibrate?.(20); toggleSel(n.id); }, 480);
    });
    el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clearTimeout(timer); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, () => clearTimeout(timer)));
    el.addEventListener('click', (e) => {
      if (long) return;
      if (selected.size || e.ctrlKey || e.metaKey) return toggleSel(n.id);
      open(n.id);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(n.id); if (e.key === 'Delete') deleteNotes([n]); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!isDesktop && !selected.size) return; // 휴대폰은 길게 누르기 사용
      showMenu({ x: e.clientX, y: e.clientY }, [
        { colors: n.color, onPick: (c) => store.update(n.id, { color: c }) },
        { label: '메모 열기', icon: I.list, onClick: () => open(n.id) },
        { label: n.pinned ? '고정 해제' : '상단 고정', icon: I.pin, onClick: () => store.update(n.id, { pinned: !n.pinned, updatedAt: n.updatedAt }) },
        { label: '공유', icon: I.share, onClick: () => shareNotes([n]) },
        { label: '메모 삭제', icon: I.trash, danger: true, onClick: () => deleteNotes([n]) },
      ]);
    });
    return el;
  }

  function draw() {
    // 삭제된 메모는 선택에서 제거
    const ids = new Set(notes.map((n) => n.id));
    selected = new Set([...selected].filter((id) => ids.has(id)));
    document.body.classList.toggle('selecting', selected.size > 0);
    header.hidden = selected.size > 0; selHeader.hidden = !selected.size;
    drawHeader();
    grid.className = 'cards ' + (isDesktop ? 'list' : s().layout);
    const list = sorted();
    grid.replaceChildren(...(list.length ? list.map(card) : [h('div', { class: 'empty-state' },
      query ? '검색 결과가 없습니다.' : h('div', {}, h('p', {}, '메모가 없습니다.'), h('p', { class: 'muted' }, '+ 버튼을 눌러 새 메모를 만드세요.')))]));
  }

  function toggleSel(id) { selected.has(id) ? selected.delete(id) : selected.add(id); draw(); }
  function clearSel() { selected.clear(); draw(); }

  function open(id) {
    if (isDesktop) desktop.openNote(id);
    else openEditor(id);
  }

  async function deleteNotes(list) {
    if (!list.length) return;
    if (s().confirmDelete && !(await confirmDialog(list.length > 1 ? `메모 ${list.length}개를 삭제할까요?` : '이 메모를 삭제할까요?'))) return;
    list.forEach((n) => { store.remove(n.id); desktop?.noteDeleted(n.id); });
    clearSel();
  }

  /* 휴대폰 편집 화면 */
  function openEditor(id, isNew = false) {
    closeMenu();
    const note = notes.find((n) => n.id === id) || { id, html: '', color: lastColor() };
    editor?.close(true);
    const ed = new Editor(store, id);
    const screen = h('div', { class: 'note-screen' });
    const pinBtn = h('button', { class: 'icon-btn', title: '상단 고정', html: I.pin });
    const bar = h('div', { class: 'note-topbar' },
      h('button', { class: 'icon-btn', title: '뒤로', html: I.back, onClick: () => history.back() }),
      h('div', { class: 'grow' }),
      pinBtn,
      h('button', { class: 'icon-btn', title: '색상', html: I.palette, onClick: (e) => showMenu(e.currentTarget, [
        { colors: cur().color, onPick: (c) => { store.update(id, { color: c }); localStorage.setItem('sticky.lastColor', c); } }]) }),
      h('button', { class: 'icon-btn', title: '더보기', html: I.moreV, onClick: (e) => showMenu(e.currentTarget, [
        { label: '공유', icon: I.share, onClick: () => { ed.save.flush(); shareNotes([cur()]); } },
        { label: '메모 삭제', icon: I.trash, danger: true, onClick: async () => {
          if (s().confirmDelete && !(await confirmDialog('이 메모를 삭제할까요?'))) return;
          store.remove(id); history.back(); } },
      ]) }));
    pinBtn.addEventListener('click', () => store.update(id, { pinned: !cur().pinned, updatedAt: cur().updatedAt }));
    screen.append(bar, h('div', { class: 'note-scroll' }, ed.body), ed.toolbar);
    const cur = () => notes.find((n) => n.id === id) || note;
    const refresh = () => {
      const n = notes.find((x) => x.id === id);
      if (!n) return;
      applyNoteColor(screen, n.color);
      pinBtn.classList.toggle('active', !!n.pinned);
      ed.setNote(n);
    };
    applyNoteColor(screen, note.color);
    ed.setNote(note);
    document.body.append(screen);
    document.body.classList.add('editing');
    history.pushState({ editor: id }, '');
    if (isNew) ed.body.focus(); // 탭 동작 안에서 바로 포커스해야 휴대폰 키보드가 올라옴

    editor = {
      id, refresh,
      close(skipHistory) {
        ed.destroy();
        const n = notes.find((x) => x.id === id);
        if (n && isEmptyHtml(ed.currentHtml())) store.remove(id); // 빈 메모는 자동 삭제
        screen.remove(); document.body.classList.remove('editing');
        editor = null;
        if (!skipHistory && history.state?.editor) history.back();
      },
    };
  }
  window.addEventListener('popstate', () => { if (editor) editor.close(true); });

  /* 공유 */
  async function shareNotes(list) {
    const text = list.map((n) => n.text || '').join('\n\n────────\n\n');
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('클립보드에 복사했습니다'); }
    } catch (e) { if (e.name !== 'AbortError') { await navigator.clipboard?.writeText(text); toast('클립보드에 복사했습니다'); } }
  }

  /* 설정 */
  async function openSettings() {
    const st = s();
    const opt = (label, key, values) => h('label', { class: 'set-row' }, h('span', {}, label),
      h('select', { onChange: (e) => settings.set({ [key]: e.target.value }) },
        values.map(([v, l]) => h('option', { value: v, selected: st[key] === v }, l))));
    const check = (label, checked, onChange) => h('label', { class: 'set-row' }, h('span', {}, label),
      h('input', { type: 'checkbox', class: 'switch', checked, onChange: (e) => onChange(e.target.checked) }));

    const desk = isDesktop ? await desktop.getSettings() : null;
    const body = h('div', { class: 'settings' },
      h('h3', {}, '계정'),
      session
        ? h('div', { class: 'set-row' }, h('span', {}, session.user.email),
          h('button', { class: 'btn', onClick: async () => { close(); await session.fb.authMod.signOut(session.fb.auth); } }, '로그아웃'))
        : h('div', { class: 'set-row' }, h('span', { class: 'muted' }, cloudConfigured() ? '이 기기에만 저장 중 (동기화 꺼짐)' : 'Firebase 설정 전 — 이 기기에만 저장 중'),
          cloudConfigured() ? h('button', { class: 'btn btn-primary', onClick: () => { settings.set({ mode: null }); location.reload(); } }, '로그인') : null),
      h('h3', {}, '일반'),
      opt('테마', 'theme', [['system', '시스템 설정'], ['light', '밝게'], ['dark', '어둡게']]),
      check('삭제 전에 확인', st.confirmDelete, (v) => settings.set({ confirmDelete: v })),
      desk ? [
        h('h3', {}, 'Windows'),
        check('메모를 항상 위에 표시', desk.alwaysOnTop, (v) => desktop.setSetting('alwaysOnTop', v)),
        check('Windows 시작 시 실행', desk.launchAtStartup, (v) => desktop.setSetting('launchAtStartup', v)),
        h('p', { class: 'muted small' }, '창을 닫아도 작업 표시줄 오른쪽 트레이에서 계속 실행됩니다. 단축키: Ctrl+Alt+N 새 메모'),
      ] : null,
      h('p', { class: 'muted small' }, `스티커 메모 v1.0 · ${store.kind === 'cloud' ? '실시간 동기화 사용 중' : '로컬 저장'}`));
    const close = sheet('설정', body);
  }

  /* 키보드 (컴퓨터) */
  document.addEventListener('keydown', (e) => {
    if (editor) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRow.classList.add('open'); search.focus(); }
    if (e.key === 'Escape' && selected.size) clearSel();
  });

  const fab = isDesktop ? null : h('button', { class: 'fab', title: '새 메모', html: I.plus, onClick: newNote });
  app.replaceChildren(h('div', { class: 'list-view' }, header, selHeader, searchRow, h('main', { class: 'scroll' }, grid)), fab);
  draw();
  if (!isDesktop && location.hash === '#new') { history.replaceState(null, '', location.pathname); newNote(); } // 홈 화면 아이콘 바로가기

  store.subscribe((list) => {
    notes = list;
    draw();
    if (!editor) return;
    if (notes.some((n) => n.id === editor.id)) { editor.seen = true; editor.refresh(); }
    else if (editor.seen) { toast('다른 기기에서 삭제된 메모입니다'); editor.close(); }
  }, (err) => toast('동기화 오류: ' + (err.code === 'permission-denied' ? 'Firestore 보안 규칙을 확인하세요' : err.message), 5000));
}

function lastColor() { return localStorage.getItem('sticky.lastColor') || 'yellow'; }

/* ───────── 새 버전 자동 적용 ─────────
   서버의 index.html 이 가리키는 JS 파일 이름(해시)이 바뀌면 새 버전이 배포된 것.
   입력 중에는 건드리지 않고, 창이 가려져 있거나 포커스가 없을 때 조용히 새로고침합니다. */
function watchForUpdates() {
  const mine = document.querySelector('script[type="module"][src*="assets/index-"]')?.getAttribute('src');
  if (!mine || location.protocol !== 'https:') return; // 개발 모드·내장 버전에서는 사용 안 함
  let pending = false;
  const idle = () => document.hidden || !document.hasFocus();
  const apply = () => { if (pending && idle()) location.reload(); };
  async function check() {
    if (pending || !navigator.onLine) return apply();
    try {
      const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
      const latest = html.match(/src="([^"]*assets\/index-[^"]+\.js)"/)?.[1];
      if (latest && latest !== mine) pending = true;
    } catch {}
    apply();
  }
  setInterval(check, 15 * 60 * 1000);
  setTimeout(check, 20 * 1000);
  document.addEventListener('visibilitychange', () => (document.hidden ? apply() : check()));
  window.addEventListener('blur', () => setTimeout(apply, 1500));
  window.addEventListener('focus', check);
}
