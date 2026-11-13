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

## Inserire a mano una competizione (altro)

Le competizioni ASI hanno un percorso dedicato (vedi sotto). Per qualunque altra
competizione non coperta, usa `data/manual.json`. Per ogni partita:
`data` (`YYYY-MM-DD HH:MM`), `casa`, `trasferta`, `risultato` (vuoto se non giocata),
`parziali`, `palestra`. Per la classifica: `squadra`, `punti`, `pg`, `pv`, `pp`, `sf`, `ss`.
Dopo la modifica, riesegui l'importer per rigenerare `schedule.json`.

## Campionati ASI

I campionati ASI non sono su FIPAV: il calendario arriva in un PDF inviato dalla
federazione e i risultati vanno inseriti a mano. Il flusso è:

1. **Calendario** (`data/asi/<id>.calendario.json`): generato dal PDF con
   `importer/asi_pdf.py` (oppure dalla pagina admin, che fa lo stesso nel browser).
   Ogni partita ha un **N. Gara** stabile (es. `3001`), usato come chiave.
2. **Risultati** (`data/asi/<id>.risultati.json`): inseriti a mano, indicizzati per
   N. Gara: `risultato` (es. `3 - 1`) e `parziali` (es. `25-20 22-25 25-18 25-19`).
3. L'importer (`load_asi()`) fonde i due file e **calcola la classifica**:
   3-0 / 3-1 → 3 punti, 3-2 → 2 punti, 2-3 → 1 punto, 0-3 / 1-3 → 0 punti;
   ordinamento per punti, poi quoziente set, poi quoziente punti.

I due file restano separati apposta: ricaricando un PDF si rigenera solo il
calendario e i risultati già inseriti non si perdono.

```bash
# dal PDF al calendario
python3 importer/asi_pdf.py "CALENDARIO ... .pdf" \
  --id asi-open-misto-promozionale --titolo "Open Misto Promozionale ASI" \
  --out data/asi/asi-open-misto-promozionale.calendario.json
```

> Il PDF **non** va mai committato: contiene i contatti dei referenti. La regola
> `*.pdf` è in `.gitignore`.

## Pagina admin

Su `site/admin/` c'è una pagina protetta per caricare i PDF e inserire i risultati
senza toccare i file a mano. È pubblicata su GitHub Pages come il sito, ma:

- non è linkata dal sito ed è `noindex`;
- **scrivere richiede un token GitHub valido**: chi non ha i permessi sul repo non
  può fare nulla, anche trovando la pagina.

Due modi di accesso:

- **Token personale** (fine-grained, permesso *Contents: read & write* su questo
  repo). Immediato, nessuna configurazione: si incolla nella pagina e resta solo
  nel browser (`localStorage`).
- **Accedi con GitHub** (OAuth): più comodo quando i gestori sono più d'uno, perché
  ognuno usa il proprio account. Richiede la funzione serverless in `worker/`
  (Cloudflare Worker): è l'unico pezzo che non può stare nel browser, perché lo
  scambio del token va fatto con il `client_secret`, che non deve mai finire nella
  pagina. Vedi `worker/README.md`.

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
