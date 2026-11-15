# Prima o Poi

La lista condivisa dei posti da vedere e delle cose da fare con gli amici.
Nessuna iscrizione: si entra con il **codice del gruppo** (tipo `fragola-funivia-3075`) o con il link di invito.

**L'app è online su <https://litfibapp.github.io/prima-o-poi/>**, collegata al progetto Firebase `prima-o-poi-663d2`.
I passaggi 1 e 2 qui sotto sono già fatti: restano come promemoria, nel caso servisse rifarli.
Senza una configurazione Firebase, l'app parte in **modalità prova** e i dati restano solo sul dispositivo.

---

## 1. Firebase (dove vive la lista)

1. Vai su <https://console.firebase.google.com> ed entra con un account Google.
2. **Crea un progetto** → nome `prima-o-poi` → Google Analytics puoi disattivarlo → **Crea progetto**.
3. Nel menu a sinistra: **Build → Authentication → Inizia**.
   Scheda **Metodo di accesso** → **Anonimo** → attivalo → **Salva**.
4. Nel menu a sinistra: **Build → Firestore Database → Crea database**.
   - Posizione: una in Europa (es. `eur3` o `europe-west`).
   - Modalità: **produzione**.
5. Sempre in Firestore, scheda **Regole**: cancella tutto, incolla il contenuto del file `firestore.rules` di questa cartella e premi **Pubblica**.
6. In alto a sinistra, ingranaggio → **Impostazioni progetto**. In fondo, sezione **Le tue app** → icona **`</>`** (Web).
   Nome `Prima o Poi`, **non** spuntare Firebase Hosting → **Registra app**.
7. Ti mostra un blocco `const firebaseConfig = { ... }`. Copia i valori dentro `firebase-config.js` di questa cartella, al posto di `INCOLLA_QUI` e delle virgolette vuote.

Il piano gratuito (Spark) basta e avanza per un gruppo di amici: non serve inserire una carta.

## 2. GitHub Pages (dove vive il sito)

1. Su <https://github.com> → **New repository** → nome `prima-o-poi` → **Public** → **Create repository**.
2. Nella pagina del repository: **Add file → Upload files** e trascina tutti i file e la cartella `icons`
   (non serve la cartella `.claude`). Poi **Commit changes**.
3. **Settings → Pages** → Source: **Deploy from a branch** → Branch **main**, cartella **/ (root)** → **Save**.
4. Dopo un paio di minuti il sito è su `https://TUONOME.github.io/prima-o-poi/`.
5. Torna su Firebase: **Authentication → Impostazioni → Domini autorizzati → Aggiungi dominio** → `TUONOME.github.io`.

## 3. Usarla

1. Apri il link dal telefono → **Crea un nuovo gruppo** → scrivi il tuo nome.
2. Menu **⋯** in alto → **Invita amici**: manda il link su WhatsApp. Chi lo apre entra direttamente nel gruppo.
3. Mettila sulla schermata Home:
   - **iPhone (Safari)**: Condividi → *Aggiungi alla schermata Home*. Dall'icona si inserisce il codice una volta (iPhone tiene separati Safari e app installata).
   - **Android (Chrome)**: menu ⋮ → *Installa app*. Da quel momento **Prima o Poi compare tra le opzioni di "Condividi"** di Google Maps: scegli un posto → Condividi → Prima o Poi, e la scheda si compila da sola.
   - Su iPhone si usa **Condividi → Copia** in Maps e poi si incolla nel campo azzurro.

## Da sapere

- Chiunque abbia il codice o il link di invito può leggere e modificare la lista di quel gruppo: dallo solo agli amici.
- Se qualcuno cancella i dati del browser, rientra con il codice e riscrive il nome.
- Quando modifichi i file, aumenta `VERSION` in `sw.js` (es. `pop-v2`) così i telefoni scaricano la versione nuova.

## File

| File | A cosa serve |
|---|---|
| `index.html`, `style.css`, `app.js` | L'app |
| `store.js` | Collegamento a Firebase (e modalità prova) |
| `firebase-config.js` | Le chiavi del tuo progetto Firebase |
| `firestore.rules` | Le regole di sicurezza da incollare in Firebase |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installazione sul telefono e "Condividi" su Android |
| `privacy.html` | Privacy e regole d'uso, collegata dall'app |
| `fonts/` | I caratteri ospitati sul sito, con le loro licenze (SIL OFL) |

## Privacy e conformità

- **Dati minimi**: solo un nome o soprannome e le idee del gruppo. Nessuna email, telefono o posizione.
- **Nessun servizio di terze parti oltre al necessario**: Firebase (database e accesso anonimo) e GitHub Pages. Niente Analytics, pubblicità o Google Fonts.
- **Niente banner dei cookie**: l'app usa solo la memoria tecnica del browser, necessaria per funzionare.
- **Cancellazione dei dati**: menu ⋯ → *Elimina i miei dati*.
- Se cambi qualcosa che riguarda i dati (per esempio aggiungi statistiche), aggiorna anche `privacy.html`.
