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
- `data/manual.json` — competizioni ASI inserite a mano
- `importer/import_schedule.py` — genera `site/data/schedule.json`
- `site/` — frontend statico (index.html, styles.css, app.js, assets/, data/)
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
- **ASI**: non presente su FIPAV, gestito manualmente in `data/manual.json`.

## Refresh live nel browser (opzione C)
- `site/fipav-live.js` replica in JS il parser Python e legge FIPAV **direttamente dal
  browser** ad ogni apertura della pagina (FIPAV manda `access-control-allow-origin: *`).
- `site/app.js` (`init` → `fetchLiveFipav` → `mergeLive`): sostituisce solo le competizioni
  FIPAV con quelle fresche, mantiene intatte ASI/manuali. Se il live fallisce, resta lo
  snapshot `site/data/schedule.json` (aggiornato dal cron giornaliero).
- L'header mostra "Risultati aggiornati adesso da FIPAV" (pallino verde) quando il live
  riesce, altrimenti "Ultima sincronizzazione: <data snapshot>".
- `app.js` è un **modulo ES** (`<script type="module">`), quindi `file://` non funziona:
  serve un server HTTP.

## Portale FIPAV ufficiale (per riferimento)
`public.fipavonline.it` espone `app.fipavonline.it/api/v2/{commettees,calendar/.../...,tables/...}`,
ma copre solo 12 regioni e **non include la Campania** → non utilizzabile per questo club.

## Convenzioni
- Tutti i colori del sito stanno nel blocco `:root` in cima a `site/styles.css`.
- Il sito è senza dipendenze JS; non introdurre build step.
- L'importer usa solo la libreria standard di Python.
- `site/data/schedule.json` è generato: in caso di conflitto git, rigenerarlo con
  `python3 importer/import_schedule.py` invece di risolvere a mano.

## TODO noti
- Scheda dettaglio partita al click (parziali, indirizzo, logo).
- Nuova sezione del sito (richiesta dall'utente, da definire).
