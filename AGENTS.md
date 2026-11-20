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
- `site/data/squadre.json` — squadre del club: slug per i link diretti e nomi usati nei calendari
- `site/admin/` — pagina admin protetta (vedi sotto)
- `worker/` — funzione serverless opzionale per l'accesso OAuth
- `site/assets/logo.webp` — logo società nell'header, 192px WebP (vedi «Loghi»)

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
- **ASI**: non presente su FIPAV. Fonte principale: l'**API pubblica** di Spike Volley
  (`https://www.spikevolley.it/campionati/api/public.php`), usata da `importer/asi_api.py`.
  Nessun login, CORS aperto: funziona anche dal browser (vedi `site/asi-live.js`).
  - `action=campionati&committee_id=<id>` → tornei del comitato; `action=partite&tournament_id=<id>`
    → partite con risultato, parziali, palestra, data, **stato**; `action=classifica` →
    classifica già calcolata (campi camelCase: `scorePoints`, `setsWon`, ...).
  - Non esiste un filtro per società: si scaricano **tutti** i tornei del comitato e si
    tengono quelli che contengono una squadra nostra (`pattern_squadre`). Come per FIPAV.
  - Output: **un file per campionato**, `data/asi/<id>.json` (calendario + risultati +
    stato + `tournament_id`). Gli id sono fissati in `config.json` → `asi.id_per_torneo`
    perché finiscono nei link `?campionato=`: se cambiano, i link già diffusi si rompono.
  - L'API è più aggiornata del PDF: le date cambiano quando una gara viene rinviata
    (es. g1 CS Volley FQL–Kleos: 3/11 sul PDF, giocata il 17/11). Non è un errore.
  - `config.json` → `asi`: `committee_id`, `comitato_nome`, `pattern_squadre`, `dir`,
    `id_per_torneo`. Aggiungere un torneo = aggiungere una voce a `id_per_torneo`.
  - **Partite annullate** (`status: cancelled`): restano in elenco ma in grigio, con badge
    "annullata", e **non hanno risultato** (l'API le manda con 0-0, che non è un
    risultato). Di conseguenza non entrano in classifica. `_calcola_classifica()` le salta
    esplicitamente: non reintrodurre il conteggio degli 0-0.
  - **Vecchio flusso PDF** (`importer/asi_pdf.py` → `<id>.calendario.json` +
    `<id>.risultati.json`): resta supportato da `load_asi()` per i campionati caricati a
    mano dalla pagina admin. Se per lo stesso id esiste il file unico, vince quello.
  - Il PDF **non** va mai committato: contiene email/cellulari dei referenti (`*.pdf`
    in `.gitignore`).
  - `data/asi/<id>.squadre.json` contiene i loghi scelti a mano: l'importer lo legge e li
    usa solo dove l'API non ne ha uno.
  - Entrambe le squadre del club (Astrovolley Cercola e Astrovolley Portici) sono "nostre".

## Loghi delle squadre

I loghi si servono sempre da GitHub Pages, mai dai portali: FIPAV blocca l'hotlink
(risponde con un placeholder identico per tutti) e ASI serve originali fino a 1,2 MB
per un'immagine che nella scheda si vede a 46px. Entrambi gli importer li scaricano,
li ridimensionano a 512px e li salvano in WebP (`importer/loghi.py`), che mantiene la
trasparenza a una frazione del peso di un PNG.

- `site/assets/logo.webp` — stemma della societa' nell'header. 192px: il CSS lo mostra a
  54px, quindi copre fino a DPR 3.5. Non e' un logo di squadra e non lo tocca l'importer.
- `site/assets/loghi/fipav/<id>.webp` — nome = id societa' FIPAV.
- `site/assets/loghi/asi/squadra-<id>.webp` — nome = id squadra dell'API ASI.
- Gli id sono stabili, i nomi delle squadre no: non usare i nomi come nome file.

FIPAV: le pagine delle gare linkano la miniatura `LogoS` da 50px. Sullo stesso
percorso esiste `LogoB`, l'originale caricato dalla societa' (fino a 1000x1200): si
prova quella e si ripiega sulla miniatura, perche' non tutte le societa' la hanno.

Precedenza: il file locale vince sempre. In `app.js` `logoUrl()` riscrive gli URL
FIPAV verso `assets/loghi/fipav/`, e `mergeLiveAsi` mette i loghi dello snapshot
prima di quelli del live. L'URL remoto resta solo come riserva per una squadra nuova,
che non ha ancora il file.

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
- Il **N. Gara** può avere un numero di cifre variabile (es. `1` in Open Misto Élite,
  `3001` in Open Misto Promozionale): non va mai dato per scontato a 4 cifre. La riga
  gara si riconosce da `^\d+ <data> <ora>`.
- Il separatore palestra/indirizzo è il **primo " - " fuori dalle virgolette**: alcune
  palestre hanno un trattino nel nome (es. `SMS "Illuminato - Cirino"`). Vale per
  entrambi i parser.
- L'admin scrive via API GitHub (`contents/`, base64). `update-schedule.yml` ha un trigger
  `push` su `data/asi/**` e `data/manual.json`, così i risultati entrano subito in
  `schedule.json` (niente `[skip ci]`, altrimenti Pages non ridistribuisce).

## Refresh live nel browser (opzione C)
- `site/fipav-live.js` replica in JS il parser Python e legge FIPAV **direttamente dal
  browser** ad ogni apertura della pagina (FIPAV manda `access-control-allow-origin: *`).
- `site/asi-live.js` fa lo stesso per ASI, chiamando l'API pubblica
  `spikevolley.it/campionati/api/public.php` (`action=partite&tournament_id=...`).
  CORS aperto su qualunque origine: nessun proxy. I tornei da leggere sono in
  `schedule.json` → `asi.tornei` (id interno + `tournament_id`), scritti dall'importer:
  il sito non deve indovinare quali campionati sono suoi.
- `site/app.js` (`init` → `fetchLiveFipav`/`fetchLiveAsi` → `mergeLive`/`mergeLiveAsi`):
  sostituisce le competizioni di **quella** fonte, lascia intatte le altre. Se il live di
  una fonte fallisce, per quella resta lo snapshot `site/data/schedule.json`.
- L'header mostra **un bollino per fonte**: verde (`in diretta`) se letta dal vivo, rosso
  (`da archivio`) se si sta usando lo snapshot. Le fonti senza competizioni nel calendario
  non compaiono. `state.liveFonti[fonte]` tiene l'esito.
- `generato_il` è UTC **con** il fuso (`+00:00`): va passato intero a `new Date()`.
  Troncarlo (`.slice(0,19)`) lo fa leggere come ora locale e in Italia il dato sembra
  vecchio di un'ora appena scritto.
- `app.js` è un **modulo ES** (`<script type="module">`), quindi `file://` non funziona:
  serve un server HTTP.

## Limite importante: il live NON funziona da telefono
FIPAV rileva il dispositivo dallo **User-Agent** e ai browser mobili risponde con un
`302` verso `/mobile/`, che non contiene le tabelle (e la versione mobile non riporta
nemmeno le date delle partite). Il browser mobile non può cambiare il proprio User-Agent,
quindi dal telefono il fetch live fallisce sempre e si usa lo snapshot.
- Conseguenza: lo snapshot deve essere fresco. Il cron in `update-schedule.yml` chiede
  ogni 10 minuti nella fascia 17-22 UTC (19-23 italiane, quando si gioca).
- **Il cron di GitHub non è puntuale**: su un repo pubblico poco attivo le run arrivano
  ogni 2-5 ore, non ogni 10 minuti (verificato sulle run reali). Non è un bug nostro e
  non si può correggere dal workflow. Per questo il live nel browser è la fonte
  principale e lo snapshot è solo la riserva (serve soprattutto da telefono).
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
calendario" (che prima rilancia `importer/asi_api.py`, poi `import_schedule.py`)
rigenera `site/data/schedule.json` → deploy GitHub Pages.
`_applica_risultati_manuali()` fa vincere i risultati scritti a mano su quelli dell'API:
l'API può essere in ritardo o non avere un dato corretto.

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
- I loghi sono URL (esterni oppure locali); l'importer li collega a
  `logo_casa`/`logo_trasferta`.
- La modifica dei risultati avviene in una scheda che ricalca quella pubblica:
  si clicca il "vs", si scrive il punteggio, e i blocchi dei parziali si
  generano dal risultato (3-1 -> 4 blocchi). Cambiando punteggio i parziali
  scritti restano; si taglia/aggiunge solo in coda.
- Le modifiche stanno in `state.pending` finche' non si preme Salva: un solo
  commit per l'intera giornata compilata. Il file loghi si scrive solo se
  cambiato (`state.loghiDirty`).
- **Non contare `state.pending` per l'avviso "Modifiche non salvate"**: al
  caricamento `state.pending` contiene anche i risultati gia' salvati, quindi
  contarne le chiavi fa comparire l'avviso appena si apre la pagina (con
  l'Open Misto Elite, che ha risultati, succedeva sempre). L'avviso usa il
  flag `state.dirty`, alzato solo da `setPending`/input loghi e azzerato al
  caricamento (`loadResults`) e dopo un salvataggio riuscito.
- La lista partite e' **raggruppata per giornata** (`renderMatchList` costruisce
  una `.giornata` per giornata, con intestazione `.giornata-head` sticky e
  contatore). Le gare senza giornata vanno in fondo. Ogni riga non ripete piu'
  "G<n>": la giornata sta nell'intestazione della sezione.
- **Overflow orizzontale su mobile**: `.grid` usa `minmax(0, 1fr)` e
  `label.inline select` ha `max-width: 100%`. Senza, la select del campionato
  (larga quanto il titolo piu' lungo) allarga la pagina oltre lo schermo.
- `escapeAttr` e' definita in `admin.js` come in `app.js`; se manca, il form
  loghi si rompe silenziosamente.

## Trappole gia' pagate (leggere prima di toccare le viste)
- **Una sola lista di partite.** Fino alla vista Calendario esistevano due
  elenchi: la lista cronologica (`renderList`, dentro `#calendar`) e la giornata
  (`renderChampionship`). Il pannello "Tutte le partite" veniva ridisegnato da
  `renderList` **anche** dopo `aggiornaDalVivo()`, e sovrascriveva la vista
  nuova: il filtro contava 8 partite ma ne mostrava 0. Se aggiungi una vista,
  assicurati che ogni `render*` che tocca `#calendar` disegni quella giusta.
- **Il CSS legato a una classe morta non si vede.** `.annullata` era stilata solo
  come `.match.is-cancelled .annullata`: rimossa `.match`, l'etichetta e'
  diventata testo bianco 16px in mezzo alla card. Quando elimini una classe,
  cerca le regole che la usano come **antenato**, non solo come selettore.
- Le velature di esito sono due regole distinte (`.round-match`, `.fixture-row`)
  con gli stessi valori: se ne cambi una, cambia l'altra. Verifica con
  `getComputedStyle().backgroundImage` che siano identiche, non a occhio.

## Filtri del calendario (site/app.js)
- La barra in alto mostra **due chip**: l'etichetta della vista attiva
  (`.chip-current`, sola indicazione) e il bottone **Filtri** che apre
  `#filters-panel`. Cosi' il numero di chip resta fisso anche con molte squadre.
- Il pannello ha due gruppi: **Vista** (`ours` / `week`) e **Squadra**.
  Non c'e' piu' un gruppo Campionato ne' una barra di ricerca: il campionato ha
  un pannello suo (vedi sotto) e la ricerca e' stata rimossa perche' inutile.
- `state.team` contiene lo **slug** di una squadra, non il nome: cosi' due
  squadre omonime in campionati diversi restano distinguibili e il link non
  cambia se FIPAV/ASI riscrivono il nome.
- `ourTeams()` parte da `site/data/squadre.json` (slug, nome mostrato, `nomi`
  accettati, `campionato` come filtro) e aggiunge i nomi che contengono "astro"
  ma non sono in configurazione, con slug `auto-*`: una squadra nuova compare
  lo stesso, anche prima che qualcuno la aggiunga al file.
- I nomi delle squadre sono in **maiuscolo** via CSS (`text-transform`), non nei
  dati: cosi' "Minerva Medica Flyer" e "MINERVA MEDICA FLYER", che nei dati sono
  la stessa squadra scritta in due modi, diventano identici. Il testo nei JSON
  resta invariato.
- Il maiuscolo allunga i nomi di circa il 10%: per questo `.team-name` sta a
  **13.5px** e non 15px. A 15px i nomi lunghi andavano a capo e la scheda
  cresceva da 117 a 141px. A 13.5px tornano su una riga e la scheda e' piu'
  bassa di prima (113px). A 360px restano 2 nomi su 116 che vanno a capo: se si
  tocca la dimensione, ricontrollare a 360px, non solo a 390.
- La vista `week` = da oggi a 7 giorni, solo partite nostre, raggruppate per data.
- `state.view` vale solo `ours` o `week`. Il campionato **non** e' piu' una vista:
  la lista resta sempre cronologica e il campionato si apre in un pannello.

## Pannello Campionato (carosello delle giornate)
- Il pulsante **Campionato** (`#toggle-campionato`) apre `#campionato-panel`,
  esattamente come **Classifica** apre il suo. La lista delle partite resta
  sempre visibile sotto, cronologica: il pannello non la sostituisce.
- Dentro: un `<select>` per scegliere il campionato (mostrato solo se ce n'e'
  piu' di uno), le frecce `#round-prev`/`#round-next`, la riga
  "Giornata N / N di M · K partite" e una striscia di tab numerate
  (`.round-strip`, scorrevole in orizzontale) con le partite della giornata.
- `state.panel` = id del campionato aperto (`""` = chiuso), `state.round` = numero
  della giornata selezionata (`null` = non ancora scelta).
- `defaultRound()` apre la giornata della **prossima partita da giocare** (la data
  piu' vicina nel futuro senza risultato), non "la prima giornata incompleta":
  un rinvio in una giornata vecchia farebbe altrimenti aprire quella. A
  campionato finito apre l'ultima giornata.
- `roundsOf(comp)` raggruppa per `giornata` e **aggancia `_comp`** a ogni
  partita: `comp.matches` non passa da `allMatches()`, quindi senza questo
  `matchCard` esplode leggendo `m._comp.fonte`.
- Le partite del pannello hanno indici propri (`state.panelRows`): gli indici di
  `state.rows` sono un'altra lista, e confonderli apre la partita sbagliata.
- Un campionato senza numeri di giornata (es. un torneo inserito a mano) non ha
  frecce ne' striscia: mostra tutte le sue partite in un unico elenco.
- Le partite del pannello mostrano un **blocchetto calendario** (`whenBlock`)
  invece del solo orario: mese+anno nella barretta, giorno in grande, ora sotto.
  Serve perche' le partite di una giornata cadono in giorni diversi. Nella lista
  principale il blocchetto non c'e': il giorno e' gia' nell'intestazione di data,
  e ripeterlo sarebbe rumore. `matchCard(m, i, { showDate: true })` accende il
  blocchetto.
- L'anno sta **dentro la barretta del mese** (`NOV 26`), non sotto: la stagione
  scavalca il 31 dicembre, quindi senza anno "11/11" e "11/01" sarebbero
  indistinguibili. La barretta e' larga 58px su mobile e `SET 27` ne occupa 28:
  c'e' margine.
- Gli span visivi del blocchetto sono `aria-hidden`, con un `sr-only` che dice
  "mar 17 nov 2026, ore 20:45": uno screen reader leggerebbe "NOV 26 17 20:45",
  che e' incomprensibile.
- `?campionato=<id>` apre il sito con il pannello gia' aperto. Chiudendo il
  pannello il parametro viene tolto dall'indirizzo. Il vecchio `?vista=<id>`
  continua a funzionare e apre il pannello (compatibilita' con i link diffusi).

## Link diretti a una squadra (`?squadra=`, `?vista=`)
- `?squadra=<slug>` apre il sito gia' filtrato su quella squadra, con
  "Le nostre partite" selezionato: e' il link da mettere nei gruppi.
  `?squadra=<slug>&vista=week` apre la stessa squadra su "Questa settimana".
  `?campionato=<id-campionato>` apre il pannello su quel campionato.
  `?vista=calendario` apre direttamente la vista Calendario (solo partite, tutte).
- Gli slug sono in `site/data/squadre.json` e **non vanno cambiati** una volta
  diffusi: i link gia' incollati smetterebbero di funzionare. Per cambiare il
  nome mostrato si modifica `nome`, non `slug`. (Slug attuali: `under-19`,
  `misto-dirigenziale`, `misto-cercola`, `misto-portici`.)
- **Non confondere lo slug della squadra con l'id del campionato**: `?campionato=`
  usa l'id (`asi-open-misto-elite`, `fipav-94273`), che e' anche il nome dei
  file in `data/asi/`. Rinominare quello significa rinominare i file e
  riscrivere i riferimenti in `schedule.json`.
- Cambiare filtro aggiorna l'indirizzo (`syncUrl`, `pushState`), quindi il tasto
  Indietro del browser annulla il filtro invece di uscire dal sito; `popstate`
  rilegge i parametri.
- Uno slug sconosciuto non e' un errore: si apre il calendario normale. Se
  `squadre.json` manca o e' rotto, il sito funziona con i nomi "astro".
- `nomi` accetta tutte le grafie con cui la stessa squadra compare nei
  calendari. Il confronto ignora maiuscole, accenti e spazi (`normName`).
- **`ASD ASTROVOLLEY` (Under 19) e `ASD Astrovolley` (Open Misto Elite) sono due
  squadre diverse**, non due grafie della stessa: e' per questo che ogni voce
  dichiara il proprio `campionato`.

## Vista "Calendario" (`?vista=calendario`)
- La sezione **non e' una pagina a parte**: e' una vista della stessa pagina.
  `#vista-squadra` (classifica + giornata in corso) e `#vista-calendario` stanno
  entrambe nel documento; `mostraVistaCalendario(on)` nasconde l'una e mostra
  l'altra. Cosi' il tasto Indietro non ricarica nulla.
- **Si entra dalla card della home**, non dal tasto Classifica: la card intera
  porta al calendario (`?squadra=<slug>&vista=calendario`), il tasto Classifica
  dentro la card porta alla classifica. `showCalendar(slug, vista)` prende
  `"calendario"` o `"classifica"`; il vecchio parametro booleano non esiste piu'.
- Dentro la vista il tasto **Classifica** (con la coppa, lo stesso simbolo delle
  card) riporta a classifica e giornata. Sta a destra del titolo, sulla stessa
  riga: `.cal-head` e' un flex con logo, blocco testo (`flex: 1`) e tasto.
- **Il titolo e' il nome della squadra**, non "Calendario". Il sottotitolo e' il
  campionato. Senza squadra scelta il tasto Classifica e' nascosto (`hidden`):
  non ci sarebbe una classifica da aprire.
- **Non ci sono filtri**: la vista mostra sempre tutte le partite della squadra.
  Le pillole "tutte/disputate/da disputare" sono state rimosse insieme a
  `state.filtro`, `righeCalendario` e `filtroCalendario`. Restano solo la barra
  di avanzamento e i conteggi nel testo.
- Struttura: `.cal-head` (logo, titolo, tasto), `.cal-progress` (barra + `N/M`),
  poi `.fixture-row`.
- La riga mostra: giornata + data breve, **icona casa/trasferta** (`ICONA_CASA` /
  `ICONA_TRASFERTA`, in `app.js`), `vs`, logo e nome dell'avversario, poi
  risultato (o orario) con lo stato. Le icone sono `aria-hidden` con un
  `sr-only` che dice "In casa"/"In trasferta"; l'`aria-label` della riga
  ripete il luogo, perche' il testo visibile da solo non lo direbbe.
- Casa e trasferta si distinguono **anche dal colore** (viola in casa, grigio
  fuori): a 14px il tetto e il pullman si somigliano.
- `.next-match` evidenzia la prossima partita da giocare (`prossimaPartita`),
  con la stessa tolleranza di 6 ore di `defaultRound`.
- `state.calRows` tiene le righe mostrate: la scheda dettagli si apre con
  quell'indice, non con quello di un'altra lista.
- **`eDisputata` / `eAnnullata` / `MESI_BREVI` stanno in `app.js` e servono al
  calendario.** Se si tocca il blocco del calendario, controllare che restino:
  cancellandole la pagina si svuota con "eDisputata is not defined".

## Schede partita su telefono (site/styles.css, media <=640px)
- Il badge dell'ente (FIPAV/ASI) sta **sotto l'orario**, nella colonna sinistra,
  e `.match-body` occupa entrambe le righe. In fondo occupava una riga sua (scheda
  piu' alta); in alto a destra si scontrerebbe col punteggio o allargherebbe la
  scheda. Cosi' lo spazio liberato va nel respiro: `margin-top: 10px` su `.meta`.
- Il badge mostra **l'ente** (`fonte`: FIPAV/ASI), non la `categoria` del
  campionato: era un bug (il campionato ASI mostrava "Open Misto").

## Convenzioni
- Tutti i colori del sito stanno nel blocco `:root` in cima a `site/styles.css`.
- L'esito delle partite (`esito-win`/`esito-loss` in `site/app.js`) si applica
  **solo alle partite dell'Astrovolley** e si calcola dal suo punto di vista,
  quindi una vittoria in trasferta resta verde. Niente lettera V/P: solo colore.
  La velatura copre **tutto il riquadro** (verde o rosso) e sfuma nel viola
  societario verso destra; vale sia per la giornata in corso sia per la vista
  Calendario, e le due regole CSS devono restare allineate.
- Il sito è senza dipendenze JS; non introdurre build step.
- L'importer usa solo la libreria standard di Python.
- `site/data/schedule.json` è generato: in caso di conflitto git, rigenerarlo con
  `python3 importer/import_schedule.py` invece di risolvere a mano.

## TODO noti
- Scheda dettaglio partita al click (parziali, indirizzo, logo).
- Nessuno aperto.

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
