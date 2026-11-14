# AGENTS.md — Calendario ASD Astrovolley

## Progetto
Sito statico (HTML/CSS/JS puro, nessun build) con calendario unico delle partite
dell'ASD Astrovolley (FIPAV + ASI) e classifiche dei gironi.

- **Sito online**: https://kozmoshadow.github.io/astrovolley-calendario/
- **Repo**: https://github.com/KozmoShadow/astrovolley-calendario (pubblico)
- **Deploy**: GitHub Pages via `.github/workflows/deploy-pages.yml` (pubblica la cartella `site/`)
- **Aggiornamento dati**: `.github/workflows/update-schedule.yml` (cron giornaliero 06:00 UTC)

## Struttura
- `config.json` — società, comitati, stagione, pattern di match
- `data/manual.json` — competizioni extra inserite a mano (oggi vuoto)
- `data/asi/` — campionati ASI: `<id>.calendario.json` (dal PDF) + `<id>.risultati.json` (a mano)
- `importer/import_schedule.py` — genera `site/data/schedule.json`
- `importer/asi_pdf.py` — estrae il calendario ASI dal PDF (richiede `pdfplumber`)
- `site/` — frontend statico (index.html, styles.css, app.js, assets/, data/)
- `site/admin/` — pagina admin protetta (vedi sotto)
- `worker/` — funzione serverless opzionale per l'accesso OAuth
- `site/assets/logo.jpg` — logo società (scaricato da FIPAV Napoli)

## Fonti dati
- **FIPAV Napoli** (`https://www.fipavnapoli.it`): **fonte primaria** (importer/fipav_napoli.py).
  - Pagina società (filtro `SId=5690`): elenca TUTTI i campionati della società, uno per
    `<table>` con `<caption>` + link `classifica.aspx?CId=...`. Si usa solo per scoprire i CId.
  - Pagina girone completo (`CId=<id>`, `SId=` vuoto): contiene TUTTE le partite del girone
    (non solo le nostre) e la classifica. È questa la sorgente effettiva.
  - Parametri: `PId=1141`, `StId=2400` (stagione 2026/27), `ComitatoId=20`, `SId=5690`.
  - **IMPORTANTE**: il sito richiede uno User-Agent da browser, altrimenti risponde 404.
  - Le partite future NON hanno palestra/parziali (compaiono solo dopo il referto).
  - Export Excel: `esporta-risultati.aspx`.
- **Spike Volley**: solo fallback se FIPAV non risponde (`importer/import_schedule.py`,
  funzione `scan_spike_fallback`). Più lento e meno preciso.
- **ASI**: non presente su FIPAV. Il calendario arriva in un PDF (testo, tabella a
  colonne fisse: N. Gara, Data, Ora, Palestra/Impianto, Squadra Casa, Squadra Ospite,
  Giorno, raggruppato per GIORNATA). `importer/asi_pdf.py` lo estrae in
  `data/asi/<id>.calendario.json`; il **N. Gara** (es. 3001) è la chiave stabile per
  agganciare i risultati in `data/asi/<id>.risultati.json`. `load_asi()` nell'importer
  fonde i due file e **calcola la classifica** (3-0/3-1 → 3 pt, 3-2 → 2, 2-3 → 1;
  ordinamento punti → quoziente set → quoziente punti). I due file sono separati
  apposta: ricaricare il PDF non cancella i risultati.
  - Il PDF **non** va mai committato: contiene email/cellulari dei referenti (`*.pdf`
    in `.gitignore`).
  - Entrambe le squadre del club (Astrovolley Cercola e Astrovolley Portici) sono "nostre".

## Pagina admin (`site/admin/`)
Pubblica su Pages, non linkata dal sito e `noindex`. Serve a caricare i PDF e inserire
i risultati. **Scrivere richiede un token GitHub valido**: la sicurezza sta nei permessi
del repo, non nel nascondere la pagina.
- **Token personale** (fine-grained, Contents: read & write): si incolla e resta in
  `localStorage`. Nessuna configurazione.
- **OAuth** ("Accedi con GitHub"): richiede il worker in `worker/` (Cloudflare). GitHub
  non espone l'endpoint OAuth con CORS e il `client_secret` non deve stare nella pagina,
  quindi lo scambio va fatto lì. Imposta `oauthWorkerUrl` in `site/admin/config.json` (nessun codice da toccare).
- Il parsing PDF usa **pdf.js** (vendored in `site/admin/vendor/`, niente CDN) e replica
  `importer/asi_pdf.py`: stesse x di colonna ricavate dall'intestazione, stessa tolleranza
  di 2pt, il giorno è l'ultima parola dopo la squadra ospite.
- L'admin scrive via API GitHub (`contents/`, base64). `update-schedule.yml` ha un trigger
  `push` su `data/asi/**` e `data/manual.json`, così i risultati entrano subito in
  `schedule.json` (niente `[skip ci]`, altrimenti Pages non ridistribuisce).

## Refresh live nel browser (opzione C)
- `site/fipav-live.js` replica in JS il parser Python e legge FIPAV **direttamente dal
  browser** ad ogni apertura della pagina (FIPAV manda `access-control-allow-origin: *`).
- `site/app.js` (`init` → `fetchLiveFipav` → `mergeLive`): sostituisce solo le competizioni
  FIPAV con quelle fresche, mantiene intatte ASI/manuali. Se il live fallisce, resta lo
  snapshot `site/data/schedule.json`.
- L'header mostra "Risultati aggiornati adesso da FIPAV" (pallino verde) quando il live
  riesce, altrimenti "Dati aggiornati: <data snapshot>".
- `app.js` è un **modulo ES** (`<script type="module">`), quindi `file://` non funziona:
  serve un server HTTP.

## Limite importante: il live NON funziona da telefono
FIPAV rileva il dispositivo dallo **User-Agent** e ai browser mobili risponde con un
`302` verso `/mobile/`, che non contiene le tabelle (e la versione mobile non riporta
nemmeno le date delle partite). Il browser mobile non può cambiare il proprio User-Agent,
quindi dal telefono il fetch live fallisce sempre e si usa lo snapshot.
- Conseguenza: lo snapshot deve essere fresco. Il cron in `update-schedule.yml` gira
  **ogni 15 minuti** (08:00-23:00 UTC) + una passata notturna.
- L'importer riscrive `schedule.json` **solo se i dati cambiano davvero**, così il cron
  frequente non genera commit inutili e `generato_il` resta l'ora dell'ultimo
  aggiornamento reale (è questo che il sito mostra come "Dati aggiornati: ...").
- Non provare a "forzare" la versione desktop dal browser: è bloccato lato server.
- Da PC il live funziona normalmente.

## Portale FIPAV ufficiale (per riferimento)
`public.fipavonline.it` espone `app.fipavonline.it/api/v2/{commettees,calendar/.../...,tables/...}`,
ma copre solo 12 regioni e **non include la Campania** → non utilizzabile per questo club.

## Aggiornamento del sito dopo un salvataggio (importante)
La catena è: admin salva `data/asi/*.risultati.json` → push → workflow "Aggiorna
calendario" rigenera `site/data/schedule.json` → deploy GitHub Pages.

Due trappole già risolte, da non reintrodurre:
- Il push del bot usa `GITHUB_TOKEN`, che **non** fa partire altri workflow. Per
  questo `update-schedule.yml` avvia il deploy con `gh workflow run
  deploy-pages.yml` (richiede `actions: write` nei permessi). Senza questo, i
  dati freschi non arrivavano mai sul sito.
- La CDN di GitHub Pages serve i file con `cache-control: max-age=600`. Per
  questo `app.js` fetcha `schedule.json` con `?v=<timestamp>`; senza, i risultati
  nuovi restano invisibili fino a 10 minuti.

Tempi tipici: salvataggio ~1 s, sito aggiornato ~30 s.

## Sezione admin (site/admin/)
- `admin.js` salva i risultati in `data/asi/<id>.risultati.json` e i loghi delle
  squadre in `data/asi/<id>.squadre.json` (file separato: il calendario si
  rigenera dal PDF e perderebbe i loghi).
- I loghi sono URL (esterni oppure `assets/loghi/<nome>`); l'importer li collega
  a `logo_casa`/`logo_trasferta`.
- La modifica dei risultati avviene in una scheda che ricalca quella pubblica:
  si clicca il "vs", si scrive il punteggio, e i blocchi dei parziali si
  generano dal risultato (3-1 -> 4 blocchi). Cambiando punteggio i parziali
  scritti restano; si taglia/aggiunge solo in coda.
- Le modifiche stanno in `state.pending` finche' non si preme Salva: un solo
  commit per l'intera giornata compilata. Il file loghi si scrive solo se
  cambiato (`state.loghiDirty`).
- `escapeAttr` e' definita in `admin.js` come in `app.js`; se manca, il form
  loghi si rompe silenziosamente.

## Filtri del calendario (site/app.js)
- La barra in alto mostra **due chip**: l'etichetta della vista attiva
  (`.chip-current`, sola indicazione) e il bottone **Filtri** che apre
  `#filters-panel`. Cosi' il numero di chip resta fisso anche con molte squadre.
- Il pannello ha tre gruppi: **Vista** (`ours` / `week`), **Squadra**, **Campionato**.
  Il gruppo Squadra compare solo per "Le nostre partite" e "Questa settimana":
  scegliendo un campionato si azzera (`applyView`).
- `state.team` filtra per una nostra squadra; `ourTeams()` le ricava dalle partite
  (ogni nome che contiene "astro"), quindi non serve una lista a mano.
- La vista `week` = da oggi a 7 giorni, solo partite nostre, raggruppate per data
  (non per giornata).

## Convenzioni
- Tutti i colori del sito stanno nel blocco `:root` in cima a `site/styles.css`.
- L'esito delle partite (`esito-win`/`esito-loss` in `site/app.js`) si applica
  **solo alle partite dell'Astrovolley** e si calcola dal suo punto di vista,
  quindi una vittoria in trasferta resta verde. Niente lettera V/P: solo colore.
- Il sito è senza dipendenze JS; non introdurre build step.
- L'importer usa solo la libreria standard di Python.
- `site/data/schedule.json` è generato: in caso di conflitto git, rigenerarlo con
  `python3 importer/import_schedule.py` invece di risolvere a mano.

## TODO noti
- Scheda dettaglio partita al click (parziali, indirizzo, logo).
- Nuova sezione del sito (richiesta dall'utente, da definire).

## Comandi utili
```bash
# rigenera i dati del sito
python3 importer/import_schedule.py
# calendario ASI dal PDF (richiede: pip install pdfplumber)
python3 importer/asi_pdf.py "CALENDARIO.pdf" --id asi-open-misto-promozionale \
  --titolo "Open Misto Promozionale ASI" \
  --out data/asi/asi-open-misto-promozionale.calendario.json
# sito in locale (app.js è un modulo ES: serve un server HTTP)
python3 -m http.server 12000 --directory site
```
