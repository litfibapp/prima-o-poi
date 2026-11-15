// Dove vivono i dati.
// - createFirebaseStore: la lista condivisa vera, su Firebase (Firestore + accesso anonimo).
// - createDemoStore: modalità prova, i dati restano solo su questo dispositivo.
// Le due versioni hanno gli stessi metodi, così app.js non deve sapere quale sta usando.
//
// Nomi doppi: la stessa persona può comparire con due identificativi (per esempio da Safari
// e dall'app installata su iPhone). Quando si "uniscono", uno resta il nome principale e
// l'altro finisce nella sua lista "aliases": app.js tratta tutti gli alias come la stessa persona.

const FB = "https://www.gstatic.com/firebasejs/10.12.2";

// Sposta "Ci sto" e "Fatto da" dagli identificativi `fromIds` a `intoId` su ogni idea.
function remapPatch(v, fromIds, intoId, del) {
  const patch = {};
  for (const k of Object.keys(v.interested || {})) {
    if (fromIds.includes(k) && v.interested[k]) { patch[`interested.${k}`] = del; patch[`interested.${intoId}`] = true; }
  }
  if (fromIds.includes(v.doneBy)) patch.doneBy = intoId;
  return patch;
}

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
      return fs.onSnapshot(fs.collection(db, "groups", code, "members"), { includeMetadataChanges: true },
        snap => { const m = {}; snap.docs.forEach(d => m[d.id] = d.data()); next(m, { fromCache: snap.metadata.fromCache }); }, error);
    },
    // docId: il nome principale di questa persona (di solito il suo identificativo, oppure quello a cui è stata unita)
    setMember: (code, name, docId = uid) => docId === uid
      ? fs.setDoc(member(code, uid), { name, updatedAt: Date.now() }, { merge: true })
      : fs.updateDoc(member(code, docId), { name, updatedAt: Date.now() }),
    addItem: (code, data) => fs.addDoc(items(code), data),
    updateItem: (code, id, patch) => fs.updateDoc(item(code, id), patch),
    // on: aggiunge il "Ci sto" di questo telefono; offKeys: tutti gli identificativi della persona da togliere
    setInterest(code, id, on, offKeys = [uid]) {
      const patch = {};
      if (on) patch[`interested.${uid}`] = true;
      else for (const k of offKeys) patch[`interested.${k}`] = fs.deleteField();
      return fs.updateDoc(item(code, id), patch);
    },
    deleteItem: (code, id) => fs.deleteDoc(item(code, id)),

    // Unisce il nome `fromId` (con i suoi alias) dentro `intoId`.
    async mergeMember(code, fromId, fromAliases, intoId, intoName) {
      const fromIds = [fromId, ...(fromAliases || [])];
      const snap = await fs.getDocs(items(code));
      const batch = fs.writeBatch(db);
      if (intoId === uid) batch.set(member(code, uid), { name: intoName, updatedAt: Date.now(), aliases: fs.arrayUnion(...fromIds) }, { merge: true });
      else batch.update(member(code, intoId), { aliases: fs.arrayUnion(...fromIds) });
      batch.delete(member(code, fromId));
      snap.docs.forEach(d => {
        const patch = remapPatch(d.data(), fromIds, intoId, fs.deleteField());
        if (Object.keys(patch).length) batch.update(d.ref, patch);
      });
      await batch.commit();
    },

    // Unisce idee doppie: aggiorna quella da tenere e cancella le altre.
    async mergeItems(code, keepId, patch, deleteIds) {
      const batch = fs.writeBatch(db);
      batch.update(item(code, keepId), patch);
      for (const id of deleteIds) batch.delete(item(code, id));
      await batch.commit();
    },

    // Cancella dal gruppo tutto ciò che riguarda questa persona (myIds: tutti i suoi identificativi):
    // le idee che ha aggiunto, i suoi "Ci sto", il suo nome. Poi elimina l'accesso anonimo.
    async deleteMyData(code, myIds = [uid], memberDocs = [uid]) {
      const snap = await fs.getDocs(items(code));
      const batch = fs.writeBatch(db);
      snap.docs.forEach(d => {
        const v = d.data();
        if (myIds.includes(v.by)) { batch.delete(d.ref); return; }
        const patch = {};
        for (const k of Object.keys(v.interested || {})) if (myIds.includes(k)) patch[`interested.${k}`] = fs.deleteField();
        if (myIds.includes(v.doneBy)) patch.doneBy = null;
        if (Object.keys(patch).length) batch.update(d.ref, patch);
      });
      for (const id of memberDocs) batch.delete(member(code, id));
      await batch.commit();
      try { await auth.currentUser.delete(); } catch (e) {}
    },
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
  const DEL = Symbol("del");
  const applyPatch = (obj, patch) => {
    for (const [k, v] of Object.entries(patch)) {
      const parts = k.split(".");
      let o = obj; for (const p of parts.slice(0, -1)) o = (o[p] ||= {});
      if (v === DEL) delete o[parts.at(-1)]; else o[parts.at(-1)] = v;
    }
  };

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
      const fn = () => next((read()[code] || {}).members || {}, { fromCache: false });
      subs.add(fn); setTimeout(fn, 0); return () => subs.delete(fn);
    },
    setMember: (code, name, docId = uid) => mutate(code, g => { g.members[docId] = { ...(g.members[docId] || {}), name, updatedAt: Date.now() }; }),
    addItem: (code, data) => mutate(code, g => { g.items["i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)] = data; }),
    updateItem: (code, id, patch) => mutate(code, g => { if (g.items[id]) Object.assign(g.items[id], patch); }),
    setInterest: (code, id, on, offKeys = [uid]) => mutate(code, g => {
      const it = g.items[id]; if (!it) return;
      it.interested ||= {};
      if (on) it.interested[uid] = true; else for (const k of offKeys) delete it.interested[k];
    }),
    deleteItem: (code, id) => mutate(code, g => { delete g.items[id]; }),
    mergeMember: (code, fromId, fromAliases, intoId, intoName) => mutate(code, g => {
      const fromIds = [fromId, ...(fromAliases || [])];
      const into = g.members[intoId] || { name: intoName, updatedAt: Date.now() };
      into.aliases = [...new Set([...(into.aliases || []), ...fromIds])];
      if (intoId === uid) { into.name = intoName; into.updatedAt = Date.now(); }
      g.members[intoId] = into;
      delete g.members[fromId];
      for (const it of Object.values(g.items)) applyPatch(it, remapPatch(it, fromIds, intoId, DEL));
    }),
    mergeItems: (code, keepId, patch, deleteIds) => mutate(code, g => {
      if (g.items[keepId]) applyPatch(g.items[keepId], patch);
      for (const id of deleteIds) delete g.items[id];
    }),
    deleteMyData: (code, myIds = [uid], memberDocs = [uid]) => mutate(code, g => {
      for (const [id, it] of Object.entries(g.items)) {
        if (myIds.includes(it.by)) { delete g.items[id]; continue; }
        for (const k of Object.keys(it.interested || {})) if (myIds.includes(k)) delete it.interested[k];
        if (myIds.includes(it.doneBy)) it.doneBy = null;
      }
      for (const id of memberDocs) delete g.members[id];
    }),
  };
}
