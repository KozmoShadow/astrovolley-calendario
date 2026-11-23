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

- `.github/workflows/update-schedule.yml` rigenera i dati nella fascia serale (ogni 10
  minuti tra le 17 e le 22 UTC, cioè 19-23 in Italia, quando si gioca) e committa le
  differenze. GitHub non garantisce la puntualità dei cron: nella pratica le run possono
  arrivare anche a ore di distanza. Non è un problema, perché il sito legge FIPAV e ASI
  dal vivo a ogni apertura: lo snapshot serve solo come riserva.
  Per forzarlo: Actions → "Aggiorna calendario" → Run workflow.
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

I campionati ASI non sono su FIPAV, ma hanno un'**API pubblica** che il sito usa
come fonte principale:

```bash
python3 importer/asi_api.py          # scarica tutti i tornei del comitato
python3 importer/asi_api.py --dry-run  # mostra cosa terrebbe, senza scrivere
```

Scrive **un file per campionato** in `data/asi/<id>.json` con calendario,
risultati, stato delle partite e classifica. Non serve login: l'API risponde
anche dal browser, quindi il sito legge i dati **dal vivo** a ogni apertura.

- I tornei da seguire si scelgono in `config.json` → `asi.id_per_torneo`
  (`"<id API>": "<id interno>"`). L'id interno finisce nei link `?campionato=`,
  quindi non va cambiato: i link già diffusi smetterebbero di funzionare.
- Le partite **annullate** restano in elenco in grigio ma non hanno risultato e
  **non entrano in classifica**.
- Se un risultato manca o è sbagliato, si può correggere a mano scrivendo in
  `data/asi/<id>.risultati.json`: il valore scritto a mano vince su quello dell'API.

Vecchio flusso con PDF (ancora supportato per i campionati caricati a mano):
`importer/asi_pdf.py` genera `data/asi/<id>.calendario.json`, i risultati stanno
in `<id>.risultati.json` indicizzati per **N. Gara**, e `load_asi()` fonde i due
file calcolando la classifica (3-0/3-1 → 3 punti, 3-2 → 2, 2-3 → 1).

> Il PDF **non** va mai committato: contiene i contatti dei referenti. La regola
> `*.pdf` è in `.gitignore`.

## Area dirigenza

Su `site/dirigenza/` c'e' una pagina di sola lettura, raggiungibile dal logo in
testata: card dei mesi con le partite in casa e, dentro un mese, refertisti e
addetti all'arbitro per ogni gara.

Non scrive nulla e non chiede credenziali: legge `site/data/schedule.json`,
`site/data/dirigenza.json` e i turni.

I turni stanno su un **Google Sheet pubblico**: si compilano li' e il sito li vede
al reload, senza commit. `site/data/turni.json` resta come riserva se il foglio non
risponde. Il foglio si configura in `site/data/dirigenza.json` → `foglio_turni`
(`id` e `nome` del tab); lo schema delle colonne e' descritto in `AGENTS.md`.
Un modello gia' compilato con le 45 partite in casa e' in
`site/demo/foglio-turni-esempio.csv`: importalo con File → Importa.

Due chip in cima cambiano cosa si vede: "Solo in casa" (predefinito) e "Tutte le
partite". Lo stato passa nell'indirizzo, quindi `?filtro=tutte&mese=2027-01` si
puo' salvare tra i preferiti.

Le partite in trasferta compaiono solo con "Tutte le partite" e restano **neutre**:
niente verde/rosso e nessun blocco turni. Il colore dice "manca il refertista", e in
trasferta il referto non lo curiamo, quindi colorarle sarebbe un allarme falso. Il
verde arriva **solo** dal nome del refertista: una riga nel foglio con la colonna
vuota lascia la partita rossa come se non ci fosse.

La pagina e' pubblica come il resto del sito, ma `noindex`: chi ha il link la
vede. Non c'e' nulla di riservato oltre ai turni.

### Le partite nuove arrivano da sole

Il foglio non contiene l'elenco delle partite: quello lo genera l'importer.
`importer/import_schedule.py` scrive `site/data/partite-casa.csv` (le sole gare in
casa, 45 oggi) a ogni aggiornamento, e il workflow lo committa. Il tab "Partite" del
foglio lo importa con una riga sola:

```
=IMPORTDATA("https://raw.githubusercontent.com/KozmoShadow/astrovolley-calendario/main/site/data/partite-casa.csv")
```

Quando parte un campionato nuovo le righe compaiono senza copiarle a mano. Il tab
Partite e' **generato**: si riscrive a ogni aggiornamento, quindi non va compilato.
I nomi si scrivono nel tab Turni, che resta l'unico tab da toccare a mano.

Se `IMPORTDATA` risponde "Risorsa all'url indicato non trovata", di solito e' la
cache di Google che ripete un errore letto quando il file non c'era ancora: cambiare
l'URL (`...csv?v=1`) la scavalca. In alternativa jsDelivr serve lo stesso file come
`text/csv`, senza i limiti di frequenza di GitHub, ma con cache di 12 ore:

```
=IMPORTDATA("https://cdn.jsdelivr.net/gh/KozmoShadow/astrovolley-calendario@main/site/data/partite-casa.csv")
```

### Partite di un'altra societa'

Se curiamo i referti anche di un'altra societa', le sue partite in casa compaiono in
questa pagina e **solo** qui: il calendario pubblico resta il nostro.

Si configura una volta, in `config.json` → `altra_societa.societa_id`, con l'id FIPAV
della societa' (`SId` nell'indirizzo della sua pagina `risultati-classifiche.aspx`).
Da li' l'importer scrive `site/data/partite-altra-societa.json` a ogni aggiornamento.

Il nome della societa' non va scritto: si ricava da solo, perche' e' l'unica squadra
che compare in tutte le sue partite. Le gare sono solo quelle **in casa**, le
trasferte restano fuori come per le nostre.

Finche' `societa_id` e' vuoto la funzione e' spenta e la pagina funziona come prima.

## Deploy (gratuito)

1. Crea un repository su GitHub e carica questi file.
2. Il workflow `.github/workflows/update-schedule.yml` aggiorna i dati nella fascia serale.
3. Su **Cloudflare Pages** (o Netlify) collega il repository:
   - Build command: (nessuno)
   - Output directory: `site`
4. Il sito sarà online su un indirizzo `*.pages.dev` (o `*.netlify.app`).

## Note

- I dati FIPAV provengono da un servizio di terze parti non ufficiale: la
  piattaforma li mostra, ma le classifiche ufficiali fanno fede solo sui
  comunicati federali.
- L'importer è pensato per girare poche volte al giorno, in modo rispettoso.
