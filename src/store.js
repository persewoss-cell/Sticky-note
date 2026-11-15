// 메모 저장소: Firebase(실시간 동기화) 또는 로컬(이 기기만) 두 가지 구현이 같은 인터페이스를 가집니다.
//   subscribe(cb) -> unsubscribe   cb(notes: Note[])
//   create(id?, data) -> id
//   update(id, patch)
//   remove(id)            영구 삭제
//   trash(id) / restore(id)  휴지통으로 이동 / 복원 (deletedAt 표시만 하므로 모든 기기에 동기화됨)
// Note = { id, html, text, color, pinned, createdAt, updatedAt, deletedAt? }
// 지운 내용 기록: 기간 제한 없음. 1명당 약 200MB 를 넘으면 가장 오래된 기록부터 삭제
export const DELETION_CAP_BYTES = 200 * 1024 * 1024;
const LOCAL_DELETION_CAP = 1.5 * 1024 * 1024; // 로그인 없이 쓸 때(브라우저 저장 공간 한도)
const sizeOf = (o) => new Blob([JSON.stringify(o)]).size;
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
    this.writeDeletions(this.readDeletions().filter((r) => r.noteId !== id));
  }
  /* 지운 내용 기록 (이 기기에만) — 오래된 것이 뒤쪽 */
  readDeletions() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY + '.deletions')) || []; } catch { return []; } }
  writeDeletions(list) {
    while (list.length && sizeOf(list) > LOCAL_DELETION_CAP) list.pop(); // 한도를 넘으면 가장 오래된 것부터
    try { localStorage.setItem(LOCAL_KEY + '.deletions', JSON.stringify(list)); } catch {}
  }
  async addDeletion(rec) { this.writeDeletions([{ id: newId(), ...rec }, ...this.readDeletions()]); }
  async listDeletions(noteId) { return this.readDeletions().filter((r) => r.noteId === noteId); }

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
    // 영구 삭제하면 그 메모의 지운 내용 기록도 함께 삭제
    const { query, where, getDocs } = this.fs;
    getDocs(query(this.deletions, where('noteId', '==', id))).then((snap) => this.purgeDeletions(snap.docs)).catch(() => {});
  }
  /* 지운 내용 기록: users/{uid}/deletions/{id} = { noteId, savedAt, items, bytes }
     사용량: users/{uid}/meta/usage = { deletionBytes } */
  get deletions() { return this.fs.collection(this.col.parent, 'deletions'); }
  get usageDoc() { return this.fs.doc(this.col.parent, 'meta', 'usage'); }
  async deleteDocs(docs) {
    for (let i = 0; i < docs.length; i += 400) {
      const batch = this.fs.writeBatch(this.col.firestore);
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  async purgeDeletions(docs) {
    if (!docs.length) return;
    const bytes = docs.reduce((t, d) => t + (d.data().bytes || 0), 0);
    await this.deleteDocs(docs);
    await this.fs.setDoc(this.usageDoc, { deletionBytes: this.fs.increment(-bytes) }, { merge: true });
    if (this.usage != null) this.usage -= bytes;
  }
  async addDeletion(rec) {
    const { addDoc, setDoc, increment, getDoc } = this.fs;
    const bytes = sizeOf(rec) + 200; // 저장 공간 추정 (색인 포함 대략)
    addDoc(this.deletions, { ...rec, bytes }).catch(console.error);
    setDoc(this.usageDoc, { deletionBytes: increment(bytes) }, { merge: true }).catch(() => {});
    if (this.usage == null) {
      try { this.usage = (await getDoc(this.usageDoc)).data()?.deletionBytes ?? bytes; } catch { return; }
    } else this.usage += bytes;
    if (this.usage > DELETION_CAP_BYTES) this.trimOldest().catch(() => {});
  }
  async trimOldest() {
    const { query, orderBy, limit, getDocs } = this.fs;
    while (this.usage > DELETION_CAP_BYTES * 0.95) { // 한도의 95% 까지 오래된 것부터 지움
      const snap = await getDocs(query(this.deletions, orderBy('savedAt', 'asc'), limit(200)));
      if (snap.empty) break;
      await this.purgeDeletions(snap.docs);
    }
  }
  async listDeletions(noteId) {
    const { query, where, getDocs } = this.fs;
    const snap = await getDocs(query(this.deletions, where('noteId', '==', noteId)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.savedAt - a.savedAt);
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
