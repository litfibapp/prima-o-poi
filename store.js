// Dove vivono i dati.
// - createFirebaseStore: la lista condivisa vera, su Firebase (Firestore + accesso anonimo).
// - createDemoStore: modalità prova, i dati restano solo su questo dispositivo.
// Le due versioni hanno gli stessi metodi, così app.js non deve sapere quale sta usando.

const FB = "https://www.gstatic.com/firebasejs/10.12.2";

export async function createFirebaseStore(config) {
  const { initializeApp } = await import(`${FB}/firebase-app.js`);
  const { getAuth, signInAnonymously } = await import(`${FB}/firebase-auth.js`);
  const fs = await import(`${FB}/firebase-firestore.js`);

  const app = initializeApp(config);
  const auth = getAuth(app);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fs.getFirestore(app);
  }

  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const uid = auth.currentUser.uid;

  const groupRef = code => fs.doc(db, "groups", code);
  const items = code => fs.collection(db, "groups", code, "items");
  const item = (code, id) => fs.doc(db, "groups", code, "items", id);
  const member = (code, id) => fs.doc(db, "groups", code, "members", id);

  return {
    demo: false,
    uid,
    async groupExists(code) {
      // Prima prova dalla memoria del telefono (funziona anche offline), poi dal server
      try { return (await fs.getDoc(groupRef(code))).exists(); }
      catch (e) { if (e.code === "permission-denied") return false; throw e; }
    },
    createGroup: code => fs.setDoc(groupRef(code), { createdAt: Date.now(), by: uid }),
    watchItems(code, next, error) {
      return fs.onSnapshot(items(code), { includeMetadataChanges: true },
        snap => next(snap.docs.map(d => ({ id: d.id, ...d.data() })), { fromCache: snap.metadata.fromCache }), error);
    },
    watchMembers(code, next, error) {
      return fs.onSnapshot(fs.collection(db, "groups", code, "members"),
        snap => { const m = {}; snap.docs.forEach(d => m[d.id] = d.data()); next(m); }, error);
    },
    setMember: (code, name) => fs.setDoc(member(code, uid), { name, updatedAt: Date.now() }),
    addItem: (code, data) => fs.addDoc(items(code), data),
    updateItem: (code, id, patch) => fs.updateDoc(item(code, id), patch),
    setInterest: (code, id, on) => fs.updateDoc(item(code, id), { [`interested.${uid}`]: on ? true : fs.deleteField() }),
    deleteItem: (code, id) => fs.deleteDoc(item(code, id)),
  };
}

export function createDemoStore() {
  const KEY = "pop-demo";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } };
  const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
  let uid;
  try { uid = localStorage.getItem("pop-demo-uid"); } catch (e) {}
  if (!uid) { uid = "demo" + Math.random().toString(36).slice(2, 10); try { localStorage.setItem("pop-demo-uid", uid); } catch (e) {} }

  const subs = new Set();
  const emit = () => subs.forEach(fn => fn());
  addEventListener("storage", e => { if (e.key === KEY) emit(); });
  const group = code => { const s = read(); s[code] ||= { items: {}, members: {} }; return s; };
  const mutate = (code, fn) => { const s = group(code); fn(s[code]); write(s); emit(); return Promise.resolve(); };

  return {
    demo: true,
    uid,
    groupExists: async code => !!read()[code],
    createGroup: code => mutate(code, () => {}),
    watchItems(code, next) {
      const fn = () => { const g = read()[code] || { items: {} }; next(Object.entries(g.items).map(([id, v]) => ({ id, ...v })), { fromCache: false }); };
      subs.add(fn); setTimeout(fn, 0); return () => subs.delete(fn);
    },
    watchMembers(code, next) {
      const fn = () => next((read()[code] || {}).members || {});
      subs.add(fn); setTimeout(fn, 0); return () => subs.delete(fn);
    },
    setMember: (code, name) => mutate(code, g => { g.members[uid] = { name, updatedAt: Date.now() }; }),
    addItem: (code, data) => mutate(code, g => { g.items["i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)] = data; }),
    updateItem: (code, id, patch) => mutate(code, g => { if (g.items[id]) Object.assign(g.items[id], patch); }),
    setInterest: (code, id, on) => mutate(code, g => {
      const it = g.items[id]; if (!it) return;
      it.interested ||= {}; if (on) it.interested[uid] = true; else delete it.interested[uid];
    }),
    deleteItem: (code, id) => mutate(code, g => { delete g.items[id]; }),
  };
}
