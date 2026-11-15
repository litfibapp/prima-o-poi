import { firebaseConfig } from "./firebase-config.js";
import { createFirebaseStore, createDemoStore } from "./store.js";

const CATS = {
  cibo: "Mangiare & bere", natura: "Natura & montagna", mare: "Mare & laghi", cultura: "Musei & cultura",
  serata: "Serate & concerti", gita: "Gite & viaggi", sport: "Sport & avventura", relax: "Relax", altro: "Altro",
};
const WORDS = ["gelato", "faro", "pizza", "molo", "vespa", "duomo", "spritz", "lago", "baita", "mare", "sole", "nebbia",
  "piazza", "funivia", "trullo", "gondola", "fragola", "limone", "cometa", "vulcano", "pineta", "scoglio", "rifugio", "borgo"];

const $ = id => document.getElementById(id);
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

let store = null, code = null, me = null;
let items = [], members = {}, loaded = false, unsub = [];
const armed = new Set();
const state = { status: "todo", kind: "all", cat: "all", sort: "top", q: "" };
try { Object.assign(state, JSON.parse(ls.get("pop-filters") || "{}"), { q: "" }); } catch (e) {}
const saveFilters = () => ls.set("pop-filters", JSON.stringify({ ...state, q: "" }));

// ---------- helpers
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }
function notice(msg) { $("notice").textContent = msg || ""; $("notice").hidden = !msg; }
function show(screen) { for (const s of ["screen-group", "screen-name", "screen-app"]) $(s).hidden = s !== screen; }
const fmtDate = ms => new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
const fmtWhen = ms => new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
// La stessa persona può avere più identificativi (nomi uniti): canon() li riporta tutti a quello principale.
let aliasOf = {};
const canon = id => aliasOf[id] || id;
const canonMe = () => canon(me);
const isMe = id => !!id && canon(id) === canonMe();
const myIds = () => [me, canonMe(), ...((members[canonMe()] || {}).aliases || [])].filter((v, i, a) => v && a.indexOf(v) === i);
const fans = it => [...new Set(Object.entries(it.interested || {}).filter(([, v]) => v).map(([k]) => canon(k)))];
const normName = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const findMemberByName = (name, exceptId) => { const n = normName(name); return n ? Object.keys(members).find(id => id !== exceptId && normName(members[id].name) === n) : undefined; };

// Idee doppie: stesso titolo (senza articoli, accenti e maiuscole) oppure stesso link.
const STOP = new Set("il lo la i gli le l un una uno di del della dello dei degli delle da dal dalla a al alla ai in nel nella con su per e".split(" "));
const normTitle = s => normName(s).split(" ").filter(w => w && !STOP.has(w)).join(" ");
const normLink = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "") + (/google\./.test(x.hostname) ? x.search : "")).toLowerCase(); } catch (e) { return ""; } };
function sameIdea(a, b) {
  const ta = normTitle(a.title), tb = normTitle(b.title);
  if (ta && ta === tb) return true;
  const la = a.link ? normLink(a.link) : "", lb = b.link ? normLink(b.link) : "";
  return !!la && la === lb;
}
function dupGroups() {
  const sorted = [...items].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), used = new Set(), groups = [];
  for (const a of sorted) {
    if (used.has(a.id)) continue;
    const g = [a];
    for (const b of sorted) if (b !== a && !used.has(b.id) && g.some(x => sameIdea(x, b))) g.push(b);
    if (g.length > 1) { g.forEach(x => used.add(x.id)); groups.push(g); }
  }
  return groups;
}
const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } };
const normCode = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").slice(0, 60);
const nameOf = id => (isMe(id) ? "te" : (members[canon(id)] && members[canon(id)].name) || "un amico");
function colorOf(id) { let x = 0; for (const c of canon(id) || "") x = (x * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${x % 360} 55% 45%)`; }
function initials(id) {
  const n = (members[canon(id)] && members[canon(id)].name) || "?";
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}
// Le iniziali sono decorative: il nome completo è già nel testo accanto (o nel title del gruppo di facce).
const face = id => h("span", { class: "face", style: `background:${colorOf(id)}`, title: nameOf(id), "aria-hidden": "true" }, initials(id));
function newCode() {
  const r = new Uint32Array(3); crypto.getRandomValues(r);
  return `${WORDS[r[0] % WORDS.length]}-${WORDS[r[1] % WORDS.length]}-${String(1000 + (r[2] % 9000))}`;
}

function onWriteError(e) {
  const c = e && e.code;
  if (c === "permission-denied") toast("Il gruppo non ha accettato la modifica. Controlla di essere nel gruppo giusto.");
  else if (c === "resource-exhausted") toast("Troppe modifiche di fila: riprova tra poco.");
  else toast("Non sono riuscito a salvare. Riprova.");
  console.error(e);
}
// Le scritture compaiono subito sullo schermo; se sei offline partono appena torna la rete.
const write = p => { p.catch(onWriteError); };

// ---------- shared links
function parseShared(text) {
  const out = { url: "", title: "", where: "", isMap: false };
  const m = text.match(/https?:\/\/[^\s<>"]+/);
  if (m) out.url = m[0].replace(/[),.;]+$/, "");
  const clean = s => s.replace(/\s+/g, " ").trim().slice(0, 120);
  if (out.url) {
    try {
      const u = new URL(out.url), host = u.hostname.toLowerCase();
      if ((/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname.startsWith("/maps")) || ["maps.app.goo.gl", "goo.gl", "maps.google.com"].includes(host)) out.isMap = true;
      if (host === "maps.apple.com" || host.endsWith(".maps.apple.com")) out.isMap = true;
      const place = u.pathname.match(/\/maps\/place\/([^/]+)/);
      let name = "";
      if (place) { try { name = decodeURIComponent(place[1].replace(/\+/g, " ")); } catch (e) { name = place[1].replace(/\+/g, " "); } }
      const q = u.searchParams.get("q") || u.searchParams.get("query") || "";
      if (!name && q && !/^-?\d+(\.\d+)?\s*,\s*-?\d/.test(q)) name = q;
      if (name) {
        const i = name.indexOf(",");
        if (i > 0) { out.title = clean(name.slice(0, i)); out.where = clean(name.slice(i + 1)); }
        else out.title = clean(name);
      }
      const addr = u.searchParams.get("address");
      if (addr) out.where = clean(addr);
    } catch (e) {}
  }
  let lines = text.replace(out.url, "").split(/\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].includes(" · ")) lines = lines[0].split(" · ").map(s => s.trim());
  lines = lines.filter((l, i) => lines.indexOf(l) === i);
  const useLines = out.isMap || lines.length > 1 || !out.url;
  if (useLines && lines.length && !out.title) out.title = clean(lines[0]);
  if (useLines && lines.length > 1 && !out.where) out.where = clean(lines[1]);
  return out;
}

// ---------- sheet: add / edit
const sheet = $("sheet");
let editing = null;
const auto = { title: "", where: "" };
for (const [k, v] of Object.entries(CATS)) $("f-cat").add(new Option(v, k));

function openSheet(it, sharedText) {
  editing = it || null;
  $("sheet-title").textContent = it ? "Modifica" : "Aggiungi un'idea";
  $("f-submit").hidden = false; $("f-submit").textContent = it ? "Salva le modifiche" : "Aggiungi alla lista";
  $("paste-wrap").hidden = !!it;
  $("f-paste").value = ""; $("f-pastemsg").textContent = ""; $("f-msg").textContent = "";
  auto.title = auto.where = ""; dupOk = false; $("dup-box").hidden = true;
  $("f-title").value = it ? it.title || "" : "";
  $("f-where").value = it ? it.where || "" : "";
  $("f-link").value = it ? it.link || "" : "";
  $("f-note").value = it ? it.note || "" : "";
  $("f-cat").value = it && CATS[it.category] ? it.category : "altro";
  (it && it.kind === "attivita" ? $("k-att") : $("k-posto")).checked = true;
  if (!sheet.open) sheet.showModal();
  if (sharedText) { $("f-paste").value = sharedText; applyPaste(); }
  else if (!it) setTimeout(() => $("f-paste").focus({ preventScroll: true }), 50);
}
$("sheet-close").addEventListener("click", () => sheet.close());
sheet.addEventListener("click", e => { if (e.target === sheet) sheet.close(); });

function applyPaste() {
  const text = $("f-paste").value.trim(), msg = $("f-pastemsg");
  if (!text) { msg.textContent = ""; return; }
  const p = parseShared(text);
  const fill = (id, key, val) => {
    const el = $(id);
    if (val && (!el.value.trim() || el.value === auto[key])) { el.value = val; auto[key] = val; return true; }
    return false;
  };
  if (p.url) $("f-link").value = p.url;
  const gotTitle = fill("f-title", "title", p.title);
  const gotWhere = fill("f-where", "where", p.where);
  if (p.isMap) $("k-posto").checked = true;
  const parts = [gotTitle && "il nome", gotWhere && "il luogo", p.url && "il link"].filter(Boolean);
  msg.textContent = gotTitle || gotWhere
    ? "Ho compilato " + parts.join(", ").replace(/, ([^,]*)$/, " e $1") + ": controlla e aggiungi."
    : p.url ? "Link salvato. Questo link non contiene il nome: scrivilo tu qui sotto." : "";
  if (!gotTitle && !$("f-title").value.trim()) $("f-title").focus();
}
$("f-paste").addEventListener("input", applyPaste);

$("item-form").addEventListener("submit", e => {
  e.preventDefault();
  const msg = $("f-msg");
  const title = $("f-title").value.trim();
  if (!title) { msg.textContent = "Scrivi almeno cosa vuoi fare o vedere."; $("f-title").focus(); return; }
  const rawLink = $("f-link").value.trim();
  const link = rawLink ? safeUrl(rawLink) : "";
  if (rawLink && !link) { msg.textContent = "Il link deve iniziare con http:// o https://"; $("f-link").focus(); return; }
  const fields = {
    title, kind: document.querySelector('input[name="kind"]:checked').value, category: $("f-cat").value,
    where: $("f-where").value.trim(), link: link || "", note: $("f-note").value.trim(),
  };
  if (editing) {
    const changed = Object.keys(fields).some(k => (fields[k] || "") !== (editing[k] || ""));
    if (!changed) { sheet.close(); toast("Nessuna modifica"); return; }
    write(store.updateItem(code, editing.id, { ...fields, editedAt: Date.now(), editedBy: me }));
    toast("Modifiche salvate");
  } else {
    const twin = !dupOk && items.find(x => sameIdea(x, fields));
    if (twin) { showDup(twin); return; }
    write(store.addItem(code, { ...fields, by: me, createdAt: Date.now(), done: false, doneAt: null, doneBy: null, interested: { [me]: true } }));
    toast("Aggiunto alla lista");
    if (state.status === "done") { state.status = "todo"; saveFilters(); syncChips(); }
  }
  sheet.close();
});

// Prima di aggiungere un doppione: avvisa e propone di segnare "Ci sto" su quella che c'è già.
let dupOk = false;
function showDup(twin) {
  const box = $("dup-box"), n = fans(twin).length;
  const already = fans(twin).includes(canonMe());
  box.replaceChildren(
    h("p", null, h("strong", null, `«${twin.title}» è già nella lista`),
      twin.done ? ", ed è già stata fatta" : "",
      (isMe(twin.by) ? ". L'hai aggiunta tu" : `. L'ha aggiunta ${twin.by ? nameOf(twin.by) : "qualcuno"}`) + (n ? `, ${n === 1 ? "ci sta 1 persona" : `ci stanno ${n} persone`}.` : ".")),
    h("div", { class: "dup-acts" },
      h("button", { class: "btn", type: "button", onclick: () => {
        if (!already && !twin.done) write(store.setInterest(code, twin.id, true));
        sheet.close();
        toast(twin.done ? "Era già fatta: la trovi tra le Fatte" : already ? "Ci sei già su quella" : `Segnato "Ci sto" su «${twin.title}»`);
      } }, twin.done || already ? "Ok, non aggiungerla" : "Segna \"Ci sto\" su quella"),
      h("button", { class: "btn btn-soft", type: "button", onclick: () => { dupOk = true; $("item-form").requestSubmit(); } }, "Aggiungila lo stesso")));
  box.hidden = false; $("f-submit").hidden = true;

}
for (const id of ["f-title", "f-link"]) $(id).addEventListener("input", () => { dupOk = false; $("dup-box").hidden = true; $("f-submit").hidden = false; });

// Unisce un gruppo di idee doppie nella più vecchia: somma i "Ci sto", tiene note e link.
async function mergeIdeas(g) {
  const [keep, ...rest] = g;
  const interested = {};
  for (const x of g) for (const [k, v] of Object.entries(x.interested || {})) if (v) interested[k] = true;
  const notes = [...new Set(g.map(x => (x.note || "").trim()).filter(Boolean))];
  const doneOnes = g.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const patch = {
    interested, note: notes.join("\n").slice(0, 600),
    where: keep.where || (g.find(x => x.where) || {}).where || "",
    link: keep.link || (g.find(x => x.link) || {}).link || "",
    done: doneOnes.length > 0, doneAt: doneOnes.length ? doneOnes[0].doneAt || null : null, doneBy: doneOnes.length ? doneOnes[0].doneBy || null : null,
    editedAt: Date.now(), editedBy: me,
  };
  try { await store.mergeItems(code, keep.id, patch, rest.map(x => x.id)); toast(`Unite le ${g.length} copie di «${keep.title}»`); }
  catch (e) { onWriteError(e); }
}

// ---------- card actions
function toggleFan(it) {
  const mine = fans(it).includes(canonMe());
  write(store.setInterest(code, it.id, !mine, Object.keys(it.interested || {}).filter(isMe)));
}
function toggleDone(it) {
  write(store.updateItem(code, it.id, it.done ? { done: false, doneAt: null, doneBy: null } : { done: true, doneAt: Date.now(), doneBy: me }));
  toast(it.done ? "Rimessa tra le cose da fare" : "Fatto! Timbro messo");
}
function askDelete(it) {
  if (armed.has(it.id)) { armed.delete(it.id); write(store.deleteItem(code, it.id)); toast("Eliminata"); return; }
  armed.add(it.id); render();
  setTimeout(() => { if (armed.delete(it.id)) render(); }, 4000);
}

// ---------- filters
const catFilter = $("cat-filter");
catFilter.add(new Option("Tutte le categorie", "all"));
for (const [k, v] of Object.entries(CATS)) catFilter.add(new Option(v, k));
function syncChips() {
  for (const [id, key] of [["status-chips", "status"], ["kind-chips", "kind"]])
    for (const b of $(id).querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === state[key]));
  catFilter.value = state.cat; $("sort").value = state.sort;
}
for (const [id, key] of [["status-chips", "status"], ["kind-chips", "kind"]])
  $(id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; state[key] = b.dataset.v; saveFilters(); syncChips(); render(); });
catFilter.addEventListener("change", () => { state.cat = catFilter.value; saveFilters(); render(); });
$("sort").addEventListener("change", () => { state.sort = $("sort").value; saveFilters(); render(); });
$("q").addEventListener("input", () => { state.q = $("q").value.trim().toLowerCase(); render(); });
syncChips();

// ---------- render
function render() {
  const nTodo = items.filter(i => !i.done).length;
  $("n-todo").textContent = nTodo; $("n-done").textContent = items.length - nTodo;
  const view = items.filter(i =>
    (state.status === "all" || (state.status === "done") === !!i.done) &&
    (state.kind === "all" || i.kind === state.kind) &&
    (state.cat === "all" || i.category === state.cat) &&
    (!state.q || [i.title, i.where, i.note].join(" ").toLowerCase().includes(state.q)));
  if (state.status === "done") view.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  else if (state.sort === "top") view.sort((a, b) => fans(b).length - fans(a).length || (b.createdAt || 0) - (a.createdAt || 0));
  else view.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const groups = loaded ? dupGroups() : [];
  $("dups").hidden = !groups.length;
  if (groups.length) $("dups").replaceChildren(
    h("p", null, h("strong", null, groups.length === 1 ? "C'è un'idea doppia" : `Ci sono ${groups.length} idee doppie`),
      ": unendole si sommano i \"Ci sto\" e si tengono note e link."),
    h("ul", null, groups.map(g => h("li", null,
      h("span", null, `«${g[0].title}» `, h("b", null, `×${g.length}`)),
      h("button", { class: "ghost", type: "button", onclick: e => { e.currentTarget.disabled = true; mergeIdeas(g); } }, "Unisci")))));

  $("list").replaceChildren(...view.map(card));
  $("empty").hidden = view.length > 0;
  if (!view.length) {
    const [t, p] = !loaded ? ["Sto caricando la lista…", "Qui compariranno i posti e le attività del gruppo."]
      : items.length === 0 ? ["La lista è vuota, per ora", "Tocca \"Aggiungi\" per mettere il primo posto o la prima attività. Poi invita gli amici dal menu in alto."]
      : ["Niente con questi filtri", "Prova a cambiare stato, tipo o categoria, oppure svuota la ricerca."];
    $("empty").replaceChildren(h("img", { src: "images/asino.webp", alt: "", width: "96", height: "96" }), h("h3", null, t), h("p", null, p));
  }
}

function card(it) {
  const fanIds = fans(it), mine = fanIds.includes(canonMe());
  const link = it.link ? safeUrl(it.link) : null;
  const maps = it.where ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((it.title ? it.title + ", " : "") + it.where) : null;
  const isArmed = armed.has(it.id);
  return h("article", { class: "card" + (it.done ? " is-done" : "") },
    it.done && h("div", { class: "stamp", title: it.doneBy ? "Segnato da " + nameOf(it.doneBy) : null }, "Fatto" + (it.doneAt ? " · " + fmtDate(it.doneAt) : "")),
    !it.done && h("button", { class: "edit", type: "button", onclick: () => openSheet(it) }, "Modifica"),
    h("div", { class: "top" },
      h("span", { class: "pill " + (it.kind === "attivita" ? "attivita" : "posto") }, it.kind === "attivita" ? "Attività" : "Posto"),
      h("span", { class: "cat" }, CATS[it.category] || "Altro")),
    h("h3", null, it.title || "Senza titolo"),
    h("div", { class: "body" },
      it.where && h("div", { class: "where" }, h("span", null, it.where), maps && h("a", { href: maps, target: "_blank", rel: "noopener noreferrer" }, "Mappa")),
      it.note && h("p", { class: "note" }, it.note),
      link && h("div", { class: "link" }, h("a", { href: link, target: "_blank", rel: "noopener noreferrer" }, hostOf(link) + " ↗")),
      h("div", { class: "by" }, "Aggiunta da " + (it.by ? nameOf(it.by) : "qualcuno") + (it.createdAt ? " · " + fmtDate(it.createdAt) : "")),
      it.editedAt && h("div", { class: "by edited" }, (it.editedBy ? "Modificata da " + nameOf(it.editedBy) + " · " : "Modificata il ") + fmtWhen(it.editedAt))),
    h("div", { class: "stub" },
      h("div", { class: "who", title: fanIds.length ? "Ci stanno: " + fanIds.map(nameOf).join(", ") : null, "aria-label": fanIds.length ? "Ci stanno: " + fanIds.map(nameOf).join(", ") : "Nessuno ancora", role: "group" },
        fanIds.length > 0 && h("div", { class: "faces" }, fanIds.slice(0, 4).map(face)),
        h("span", { class: "count" }, fanIds.length ? [h("b", null, fanIds.length), fanIds.length === 1 ? " ci sta" : " ci stanno"] : "Nessuno ancora")),
      h("div", { class: "acts" },
        !it.done && h("button", { class: "ghost" + (mine ? " on" : ""), type: "button", "aria-pressed": String(mine), onclick: () => toggleFan(it) }, mine ? "Ci sto ✓" : "Ci sto"),
        h("button", { class: "ghost ok", type: "button", onclick: () => toggleDone(it) }, it.done ? "Riapri" : "Fatto"),
        h("button", { class: "ghost del" + (isArmed ? " arm" : ""), type: "button", "aria-label": "Elimina", onclick: () => askDelete(it) }, isArmed ? "Elimina?" : "✕"))));
}

// ---------- menu
const menu = $("menu");
let installEvt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; updateInstall(); });
const inviteUrl = () => location.origin + location.pathname + "?g=" + encodeURIComponent(code);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function updateInstall() {
  const t = $("m-install-text"), b = $("m-install-btn");
  b.hidden = true;
  if (isStandalone()) { t.textContent = "È già installata su questo telefono."; return; }
  if (isIOS()) { t.textContent = "In Safari tocca Condividi (il quadrato con la freccia), poi \"Aggiungi alla schermata Home\". Dall'icona dovrai inserire il codice una volta."; return; }
  if (installEvt) { t.textContent = "Una volta installata, compare anche tra le opzioni di \"Condividi\" di Google Maps."; b.hidden = false; return; }
  t.textContent = "In Chrome apri il menu ⋮ e scegli \"Installa app\" o \"Aggiungi a schermata Home\". Poi comparirà anche tra le opzioni di \"Condividi\" di Google Maps.";
}
$("m-install-btn").addEventListener("click", async () => {
  if (!installEvt) return;
  installEvt.prompt();
  try { await installEvt.userChoice; } catch (e) {}
  installEvt = null; updateInstall();
});

function renderMembers() {
  const cm = canonMe();
  const ids = Object.keys(members).sort((a, b) => (a === cm ? -1 : b === cm ? 1 : nameOf(a).localeCompare(nameOf(b))));
  $("m-members").replaceChildren(...ids.map(id => h("li", null, face(id), id === cm ? (members[id].name || "Tu") + " (tu)" : nameOf(id))));

  // Nomi doppi: stessi nomi (senza maiuscole e accenti) con identificativi diversi
  const byName = {};
  for (const id of ids) { const n = normName(members[id].name); if (n) (byName[n] ||= []).push(id); }
  const dups = Object.values(byName).filter(g => g.length > 1);
  $("m-dups").hidden = !dups.length;
  $("m-dups").replaceChildren(
    h("span", { class: "lbl" }, "Nomi doppi"),
    h("p", null, "Di solito è la stessa persona entrata da due telefoni, o da Safari e dall'app installata. Unendoli, idee e \"Ci sto\" finiscono sotto un solo nome. Se sono davvero due persone diverse, chiedete a una delle due di cambiare nome."),
    h("ul", null, dups.map(g => h("li", null,
      h("span", null, `«${members[g[0]].name}» `, h("b", null, `×${g.length}`)),
      h("button", { class: "ghost", type: "button", onclick: e => { e.currentTarget.disabled = true; mergeNames(g); } }, "Unisci")))));
}
// Unisce più nomi uguali: tiene il tuo se c'è, altrimenti il più recente.
async function mergeNames(g) {
  const cm = canonMe();
  const into = g.includes(cm) ? cm : [...g].sort((a, b) => (members[b].updatedAt || 0) - (members[a].updatedAt || 0))[0];
  try {
    for (const from of g) if (from !== into)
      await store.mergeMember(code, from, members[from].aliases || [], into, members[into].name);
    toast(`Unito: ora «${members[into].name}» compare una volta sola`);
  } catch (e) { onWriteError(e); renderMembers(); }
}
$("open-menu").addEventListener("click", () => {
  $("m-code").textContent = code;
  $("m-name").value = ls.get("pop-name") || "";
  $("m-leave").textContent = "Esci dal gruppo su questo telefono";
  renderMembers(); updateInstall();
  menu.showModal();
});
$("menu-close").addEventListener("click", () => menu.close());
menu.addEventListener("click", e => { if (e.target === menu) menu.close(); });

$("m-invite").addEventListener("click", async () => {
  const url = inviteUrl(), text = `Segniamoci i posti da vedere e le cose da fare su Prima o Poi! Codice del gruppo: ${code}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Prima o Poi", text, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(text + "\n" + url); toast("Link copiato: incollalo su WhatsApp"); }
  catch (e) { $("m-invite-msg").textContent = url; }
});
$("rename-form").addEventListener("submit", e => {
  e.preventDefault();
  const n = $("m-name").value.trim(); if (!n) return;
  if (findMemberByName(n, canonMe())) { toast(`C'è già qualcuno che si chiama «${n}» nel gruppo: scegli un nome diverso`); return; }
  ls.set("pop-name", n); write(store.setMember(code, n, canonMe())); toast("Nome salvato");
});
let leaveArmed = false;
$("m-leave").addEventListener("click", () => {
  if (!leaveArmed) { leaveArmed = true; $("m-leave").textContent = "Tocca di nuovo per uscire"; setTimeout(() => { leaveArmed = false; $("m-leave").textContent = "Esci dal gruppo su questo telefono"; }, 4000); return; }
  ls.del("pop-group"); location.href = location.pathname;
});

let deleteArmed = false;
$("m-delete").addEventListener("click", async () => {
  const b = $("m-delete"), msg = $("m-delete-msg");
  if (!deleteArmed) {
    deleteArmed = true; b.classList.add("arm"); b.textContent = "Tocca di nuovo per eliminare tutto";
    setTimeout(() => { if (deleteArmed) { deleteArmed = false; b.classList.remove("arm"); b.textContent = "Elimina i miei dati"; } }, 5000);
    return;
  }
  deleteArmed = false; b.disabled = true; b.textContent = "Sto eliminando…"; msg.textContent = "";
  try {
    unsub.forEach(f => f()); unsub = [];
    await store.deleteMyData(code, myIds(), [...new Set([me, canonMe()])]);
    for (const k of ["pop-group", "pop-name", "pop-filters"]) ls.del(k);
    location.href = location.pathname + "?eliminato=1";
  } catch (e) {
    console.error(e);
    b.disabled = false; b.classList.remove("arm"); b.textContent = "Elimina i miei dati";
    msg.textContent = "Non sono riuscito a eliminare i dati: serve la connessione a internet. Riprova.";
    startApp();
  }
});

// ---------- onboarding
async function joinGroup(raw, auto) {
  const c = normCode(raw), msg = $("join-msg");
  msg.textContent = "";
  if (c.length < 8) { msg.textContent = "Il codice è troppo corto. Ha la forma parola-parola-1234."; return; }
  try {
    if (!(await store.groupExists(c))) { msg.textContent = auto ? "Il link di invito non è valido: chiedi di nuovo il codice." : "Non trovo questo gruppo. Controlla il codice."; return; }
  } catch (e) { msg.textContent = "Non riesco a controllare il codice: serve la connessione a internet."; return; }
  ls.set("pop-group", c); code = c; afterGroup();
}
$("join-form").addEventListener("submit", e => { e.preventDefault(); joinGroup($("join-code").value); });
// Creazione: chi crea il gruppo sceglie il codice, nello schema parola-parola-1234.
const CODE_RE = /^([a-z]{2,20})-([a-z]{2,20})-(\d{4})$/;
function checkCode(c) {
  if (!c) return "Scrivi un codice.";
  if (!CODE_RE.test(c)) return "Il codice deve avere due parole e quattro cifre: parola-parola-1234, per esempio pizza-faro-2718.";
  const [, w1, w2, digits] = c.match(CODE_RE);
  if (w1 === w2) return "Usa due parole diverse.";
  if (/^(\d)\1{3}$/.test(digits) || "0123456789".includes(digits) || "9876543210".includes(digits)) return "Le cifre sono troppo facili da indovinare: evita 1234, 0000 e simili.";
  return "";
}
function showCreate(on) {
  $("choose").hidden = on; $("create-form").hidden = !on;
  $("create-msg").textContent = "";
  if (on) { $("create-code").value = newCode(); $("create-code").focus(); $("create-code").select(); }
}
$("create-group").addEventListener("click", () => showCreate(true));
$("create-cancel").addEventListener("click", () => showCreate(false));
$("create-shuffle").addEventListener("click", () => { $("create-code").value = newCode(); $("create-msg").textContent = ""; });
$("create-code").addEventListener("blur", () => { const v = $("create-code").value; if (v.trim()) $("create-code").value = normCode(v); });
$("create-form").addEventListener("submit", async e => {
  e.preventDefault();
  const c = normCode($("create-code").value), msg = $("create-msg"), b = $("create-submit");
  $("create-code").value = c;
  const problem = checkCode(c);
  if (problem) { msg.textContent = problem; $("create-code").focus(); return; }
  b.disabled = true; msg.textContent = "";
  try {
    if (await store.groupExists(c)) { msg.textContent = "Questo codice è già usato da un altro gruppo: cambiane una parte o tocca ↻."; return; }
    await store.createGroup(c);
    ls.set("pop-group", c); code = c; afterGroup();
  } catch (err) {
    console.error(err);
    // Se un altro gruppo lo ha preso nello stesso istante, le regole rifiutano la creazione.
    msg.textContent = err && err.code === "permission-denied"
      ? "Questo codice è già usato da un altro gruppo: cambiane una parte o tocca ↻."
      : "Non sono riuscito a creare il gruppo: serve la connessione a internet.";
  } finally { b.disabled = false; }
});
function afterGroup() {
  if (ls.get("pop-name")) startApp();
  else { show("screen-name"); $("name-input").focus(); }
}
$("name-form").addEventListener("submit", e => {
  e.preventDefault();
  const n = $("name-input").value.trim();
  if (!n) { $("name-msg").textContent = "Scrivi il tuo nome."; return; }
  ls.set("pop-name", n); startApp();
});

// Quando entri in un gruppo: se il tuo nome c'è già, chiede se sei tu (da un altro telefono) o un'altra persona.
let identityDone = false, whoTwin = null;
function ensureIdentity() {
  if (identityDone) return;
  identityDone = true;
  const name = ls.get("pop-name");
  if (aliasOf[me]) return;                                   // questo telefono è già unito a un altro nome
  if (members[me]) { if (members[me].name !== name) write(store.setMember(code, name)); return; }
  const twin = findMemberByName(name, me);
  if (!twin) { write(store.setMember(code, name)); return; }
  whoTwin = twin;
  $("who-text").textContent = `Nel gruppo c'è già «${members[twin].name}». Sei tu, entrato da un altro telefono o dall'app installata?`;
  $("who-name").value = ""; $("who-msg").textContent = "";
  $("whoami").showModal();
}
$("whoami").addEventListener("cancel", e => e.preventDefault());   // serve una risposta
$("who-same").addEventListener("click", async () => {
  const b = $("who-same"); b.disabled = true;
  try {
    const t = members[whoTwin];
    await store.mergeMember(code, whoTwin, t.aliases || [], me, t.name);
    ls.set("pop-name", t.name);
    $("whoami").close(); toast("Fatto: le tue idee e i tuoi \"Ci sto\" sono sotto un solo nome");
  } catch (e) { $("who-msg").textContent = "Non ci sono riuscito: serve la connessione a internet. Riprova."; console.error(e); }
  b.disabled = false;
});
$("who-form").addEventListener("submit", e => {
  e.preventDefault();
  const n = $("who-name").value.trim(), msg = $("who-msg");
  if (!n) { msg.textContent = "Scrivi un nome."; return; }
  if (findMemberByName(n, me)) { msg.textContent = `Anche «${n}» è già usato nel gruppo: aggiungi l'iniziale del cognome o un soprannome.`; return; }
  ls.set("pop-name", n); write(store.setMember(code, n));
  $("whoami").close(); toast(`Benvenuto, ${n}!`);
});

function startApp() {
  show("screen-app");
  unsub.forEach(f => f()); unsub = [];
  identityDone = false;
  let slow = setTimeout(() => { if (!loaded) notice("Non riesco ancora a raggiungere la lista. Controlla la connessione: si aggiornerà da sola."); }, 10000);
  unsub.push(store.watchItems(code, (list, meta) => {
    items = list;
    if (!meta.fromCache && !loaded) { loaded = true; clearTimeout(slow); notice(store.demo ? demoNote : ""); }
    if (meta.fromCache && list.length) loaded = true;
    render();
  }, err => { console.error(err); notice("Non riesco a leggere la lista di questo gruppo. Prova a uscire e rientrare con il codice."); loaded = true; render(); }));
  unsub.push(store.watchMembers(code, (m, meta) => {
    members = m;
    aliasOf = {};
    for (const [id, v] of Object.entries(m)) for (const a of v.aliases || []) if (a !== id) aliasOf[a] = id;
    if (!meta || !meta.fromCache) ensureIdentity();
    render(); if (menu.open) renderMembers();
  }, () => {}));
  if (store.demo) notice(demoNote);
  render();
  const pending = sessionStorage.getItem("pop-share");
  if (pending) { sessionStorage.removeItem("pop-share"); openSheet(null, pending); }
}
const demoNote = "Modalità prova: Firebase non è ancora collegato, quindi la lista resta solo su questo dispositivo.";
$("fab").addEventListener("click", () => openSheet());

// ---------- boot
async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  const params = new URLSearchParams(location.search);
  const shared = ["title", "text", "url"].map(k => params.get(k)).filter(Boolean).join("\n");
  if (shared) { try { sessionStorage.setItem("pop-share", shared); } catch (e) {} }
  const invite = params.get("g");
  const deleted = params.has("eliminato");
  if (shared || invite || deleted) history.replaceState(null, "", location.pathname);
  if (deleted) setTimeout(() => toast("I tuoi dati sono stati eliminati."), 300);

  // ?prova nell'indirizzo: modalità prova anche con Firebase collegato (per provare senza toccare i dati veri)
  const configured = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "INCOLLA_QUI" && !params.has("prova");
  try { store = configured ? await createFirebaseStore(firebaseConfig) : createDemoStore(); }
  catch (e) {
    console.error(e);
    show("screen-group");
    $("join-msg").textContent = "Non riesco a collegarmi. Controlla la connessione e riapri l'app.";
    return;
  }
  me = store.uid;

  code = ls.get("pop-group");
  if (invite && normCode(invite) !== code) {
    show("screen-group");
    $("join-code").value = normCode(invite);
    await joinGroup(invite, true);
    return;
  }
  if (!code) { show("screen-group"); return; }
  afterGroup();
}
boot();
