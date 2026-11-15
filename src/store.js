// 메모 저장소: Firebase(실시간 동기화) 또는 로컬(이 기기만) 두 가지 구현이 같은 인터페이스를 가집니다.
//   subscribe(cb) -> unsubscribe   cb(notes: Note[])
//   create(id?, data) -> id
//   update(id, patch)
//   remove(id)            영구 삭제
//   trash(id) / restore(id)  휴지통으로 이동 / 복원 (deletedAt 표시만 하므로 모든 기기에 동기화됨)
// Note = { id, html, text, color, pinned, createdAt, updatedAt, deletedAt? }
export const TRASH_DAYS = 30;
// 수정 기록(버전): 30일 보관, 메모당 최대 300개
export const HISTORY_DAYS = 30;
export const HISTORY_MAX = 300;
const historyCutoff = () => Date.now() - HISTORY_DAYS * 864e5;
import { firebaseConfig } from './firebase-config.js';

export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');

export function blankNote(data = {}) {
  const now = Date.now();
  return { html: '', text: '', color: 'yellow', pinned: false, createdAt: now, updatedAt: now, ...data };
}

/* ───────────────────────── 로컬 저장소 ───────────────────────── */
const LOCAL_KEY = 'sticky.notes.v1';

export class LocalStore {
  constructor() {
    this.kind = 'local';
    this.listeners = new Set();
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel('sticky-notes') : null;
    // 다른 창(Electron 메모 창, 다른 탭)에서 바뀐 내용 반영
    this.channel?.addEventListener('message', () => this.emit());
    window.addEventListener('storage', (e) => e.key === LOCAL_KEY && this.emit());
  }
  read() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { return {}; }
  }
  write(map) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(map));
    this.channel?.postMessage('changed');
    this.emit();
  }
  emit() {
    const list = Object.entries(this.read()).map(([id, n]) => ({ id, ...n }));
    this.listeners.forEach((cb) => cb(list));
  }
  subscribe(cb) {
    this.listeners.add(cb);
    queueMicrotask(() => this.emit());
    return () => this.listeners.delete(cb);
  }
  async create(id = newId(), data = {}) {
    const map = this.read();
    if (!map[id]) { map[id] = blankNote(data); this.write(map); }
    return id;
  }
  async update(id, patch) {
    const map = this.read();
    if (!map[id]) return;
    map[id] = { ...map[id], ...patch, updatedAt: patch.updatedAt ?? Date.now() };
    this.write(map);
  }
  async remove(id) {
    const map = this.read();
    delete map[id];
    this.write(map);
    const v = this.readVersions(); delete v[id]; this.writeVersions(v);
  }
  /* 수정 기록 (이 기기에만) */
  readVersions() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY + '.versions')) || {}; } catch { return {}; } }
  writeVersions(v) {
    try { localStorage.setItem(LOCAL_KEY + '.versions', JSON.stringify(v)); }
    catch { // 저장 공간이 꽉 차면 가장 오래된 기록부터 정리
      for (const id in v) v[id] = v[id].slice(0, Math.ceil(v[id].length / 2));
      try { localStorage.setItem(LOCAL_KEY + '.versions', JSON.stringify(v)); } catch {}
    }
  }
  async addVersion(id, ver) {
    const v = this.readVersions();
    v[id] = [{ id: newId(), ...ver }, ...(v[id] || [])].filter((x) => x.savedAt > historyCutoff()).slice(0, HISTORY_MAX);
    this.writeVersions(v);
  }
  async listVersions(id, limit = HISTORY_MAX, _opts) {
    return (this.readVersions()[id] || []).filter((x) => x.savedAt > historyCutoff()).slice(0, limit);
  }
  async trash(id) { this.mark(id, { deletedAt: Date.now() }); }
  async restore(id) { this.mark(id, { deletedAt: null }); }
  mark(id, patch) { // 수정 시각은 바꾸지 않음
    const map = this.read();
    if (map[id]) { map[id] = { ...map[id], ...patch }; this.write(map); }
  }
  count() { return Object.keys(this.read()).length; }
  all() { return Object.entries(this.read()).map(([id, n]) => ({ id, ...n })); }
  clear() { this.write({}); }
}

/* ───────────────────────── Firebase ───────────────────────── */
export const cloudConfigured = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let fb = null; // { auth, db, api }
export async function initFirebase() {
  if (fb || !cloudConfigured()) return fb;
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authMod.initializeAuth(app, {
    persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence],
  });
  let db;
  try {
    // 오프라인에서도 동작 + 여러 창(Electron 메모 창들)이 캐시를 공유
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch {
    db = fsMod.getFirestore(app);
  }
  fb = { auth, db, authMod, fsMod };
  return fb;
}

export class CloudStore {
  constructor({ db, fsMod }, uid) {
    this.kind = 'cloud';
    this.fs = fsMod;
    this.col = fsMod.collection(db, 'users', uid, 'notes');
  }
  subscribe(cb, onError) {
    return this.fs.onSnapshot(
      this.col,
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => { console.error(err); onError?.(err); },
    );
  }
  async create(id = newId(), data = {}) {
    // await 하지 않음: 오프라인이어도 즉시 로컬 캐시에 반영되고 나중에 서버로 전송됨
    this.fs.setDoc(this.fs.doc(this.col, id), blankNote(data)).catch(console.error);
    return id;
  }
  async update(id, patch) {
    this.fs.updateDoc(this.fs.doc(this.col, id), { ...patch, updatedAt: patch.updatedAt ?? Date.now() })
      .catch((e) => { if (e.code !== 'not-found') console.error(e); });
  }
  async remove(id) {
    this.fs.deleteDoc(this.fs.doc(this.col, id)).catch(console.error);
    // 영구 삭제하면 그 메모의 수정 기록도 함께 삭제
    this.fs.getDocs(this.versions(id)).then((snap) => this.deleteDocs(snap.docs)).catch(() => {});
  }
  /* 수정 기록: users/{uid}/notes/{id}/versions/{버전id} */
  versions(id) { return this.fs.collection(this.col, id, 'versions'); }
  async deleteDocs(docs) {
    for (let i = 0; i < docs.length; i += 400) {
      const batch = this.fs.writeBatch(this.col.firestore);
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  async addVersion(id, ver) {
    this.fs.addDoc(this.versions(id), ver).catch(console.error);
  }
  async listVersions(id, limit = HISTORY_MAX, { prune = true } = {}) {
    const { query, orderBy, limit: lim, getDocs } = this.fs;
    const snap = await getDocs(query(this.versions(id), orderBy('savedAt', 'desc'), lim(prune ? limit + 50 : limit)));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // 30일 지났거나 300개를 넘는 기록은 정리 (기록을 열어볼 때 함께)
    const old = prune ? snap.docs.filter((d, i) => d.data().savedAt < historyCutoff() || i >= HISTORY_MAX) : [];
    if (old.length) this.deleteDocs(old).catch(() => {});
    return all.filter((v) => v.savedAt >= historyCutoff()).slice(0, limit);
  }
  async trash(id) { this.mark(id, { deletedAt: Date.now() }); }
  async restore(id) { this.mark(id, { deletedAt: null }); }
  mark(id, patch) { // 수정 시각은 바꾸지 않음
    this.fs.updateDoc(this.fs.doc(this.col, id), patch).catch((e) => { if (e.code !== 'not-found') console.error(e); });
  }
  async importMany(notes) {
    for (let i = 0; i < notes.length; i += 400) { // 배치당 최대 500건 제한
      const batch = this.fs.writeBatch(this.col.firestore);
      notes.slice(i, i + 400).forEach(({ id, ...n }) => batch.set(this.fs.doc(this.col, id), n));
      await batch.commit();
    }
  }
}
