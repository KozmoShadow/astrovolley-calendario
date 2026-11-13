# Calendario ASD Astrovolley

Sito statico che raccoglie in un unico calendario cronologico tutte le partite
della società, tra campionati FIPAV e ASI, con le classifiche dei gironi.

**Sito online:** https://kozmoshadow.github.io/astrovolley-calendario/

## Come funziona

- `importer/import_schedule.py` interroga l'API pubblica usata da Spike Volley,
  scansiona i campionati dei comitati in `config.json` e tiene solo quelli in cui
  compare la società (pattern `astro` nei nomi squadra).
- Le competizioni non gestite da FIPAV (es. ASI) si inseriscono a mano in
  `data/manual.json`.
- Il risultato è un unico file `site/data/schedule.json`, letto dal sito in `site/`.

## Aggiornamento automatico

- `.github/workflows/update-schedule.yml` rigenera i dati ogni giorno alle 06:00 UTC
  e committa le differenze. Per forzarlo: Actions → "Aggiorna calendario" → Run workflow.
- `.github/workflows/deploy-pages.yml` pubblica il sito su GitHub Pages ad ogni push su `main`.

## Modificare i contenuti

| Cosa | Dove |
| --- | --- |
| Colori del sito | `site/styles.css`, blocco `:root` in cima (`--accent`, `--accent-soft`) |
| Logo | `site/assets/logo.jpg` |
| Competizioni ASI (a mano) | `data/manual.json` |
| Società / comitato / stagione | `config.json` |
| Logica di importazione | `importer/import_schedule.py` |

## Configurazione

`config.json`:

- `comitati`: elenco dei comitati da scansionare (nome + id).
- `match_pattern`: stringa cercata nei nomi squadra per riconoscere la società.
- `stagione_anno` / `stagione_testo`: stagione da importare.

## Uso locale

```bash
python3 importer/import_schedule.py      # aggiorna site/data/schedule.json
python3 -m http.server 12000 --directory site
# apri http://localhost:12000
```

## Inserire a mano una competizione (ASI)

Modifica `data/manual.json` seguendo il modello già presente. Per ogni partita:
`data` (`YYYY-MM-DD HH:MM`), `casa`, `trasferta`, `risultato` (vuoto se non giocata),
`parziali`, `palestra`. Per la classifica: `squadra`, `punti`, `pg`, `pv`, `pp`, `sf`, `ss`.
Dopo la modifica, riesegui l'importer per rigenerare `schedule.json`.

## Deploy (gratuito)

1. Crea un repository su GitHub e carica questi file.
2. Il workflow `.github/workflows/update-schedule.yml` aggiorna i dati ogni giorno.
3. Su **Cloudflare Pages** (o Netlify) collega il repository:
   - Build command: (nessuno)
   - Output directory: `site`
4. Il sito sarà online su un indirizzo `*.pages.dev` (o `*.netlify.app`).

## Note

- I dati FIPAV provengono da un servizio di terze parti non ufficiale: la
  piattaforma li mostra, ma le classifiche ufficiali fanno fede solo sui
  comunicati federali.
- L'importer è pensato per girare poche volte al giorno, in modo rispettoso.
