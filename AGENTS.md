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
- **FIPAV Napoli** (`https://www.fipavnapoli.it/risultati-classifiche.aspx`): fonte ufficiale,
  più aggiornata. Parametri chiave: `StId=2400` (stagione 2026/27), `ComitatoId=20`,
  `SId=5690` (ASD ASTROVOLLEY). Filtro per sola società → tutte le partite in una chiamata.
  Codici campionato coincidono con quelli di Spike (es. U19F girone B = `94273`).
  Export Excel disponibile: `esporta-risultati.aspx`. La pagina include impianto di gara
  completo (nome, città, indirizzo), parziali e logo società.
- **Spike Volley** (`https://tuttoincodice.com/livescore/read/`): API JSON pubblica, usata
  attualmente dall'importer. Più lenta di FIPAV. Utile come backup.
- **ASI**: non presente su FIPAV, gestito manualmente in `data/manual.json`.

## Portale FIPAV ufficiale (per riferimento)
`public.fipavonline.it` espone `app.fipavonline.it/api/v2/{commettees,calendar/.../...,tables/...}`,
ma copre solo 12 regioni e **non include la Campania** → non utilizzabile per questo club.

## Convenzioni
- Tutti i colori del sito stanno nel blocco `:root` in cima a `site/styles.css`.
- Il sito è senza dipendenze JS; non introdurre build step.
- L'importer usa solo la libreria standard di Python.

## TODO noti
- Passare FIPAV Napoli a fonte primaria, con Spike come fallback.
- Scheda dettaglio partita al click (parziali, indirizzo, logo).
