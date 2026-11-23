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
- `importer/import_schedule.py` — genera `site/data/schedule.json` e `site/data/partite-casa.csv`
- `importer/asi_pdf.py` — estrae il calendario ASI dal PDF (richiede `pdfplumber`)
- `site/` — frontend statico (index.html, styles.css, app.js, assets/, data/)
- `site/data/squadre.json` — squadre del club: slug per i link diretti e nomi usati nei calendari
- `site/dirigenza/` — area dirigenza, sola lettura (vedi sotto)
- `site/data/turni.json` — refertisti e addetti arbitro per partita
- `site/data/dirigenza.json` — configurazione dell'area dirigenza
- `site/data/partite-casa.csv` — gare in casa, generato dall'importer per il tab "Partite" del foglio
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
    mano. Se per lo stesso id esiste il file unico, vince quello.
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
- `site/assets/logo-tondo.png` — lo stesso stemma gia' ritagliato in cerchio (angoli
  trasparenti). E' la sorgente delle icone: `favicon.png` (32), `apple-touch-icon.png`
  (180), `icona-192.png` e `icona-512.png` (manifest). Si rigenerano ridimensionando
  questo file, non ridisegnandole: prima erano un'altra immagine, opaca e diversa dallo
  stemma. L'apple-touch-icon va **senza** trasparenza, su fondo `#180c22`: iOS altrimenti
  ci mette il nero.
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

## Area dirigenza (`site/dirigenza/`)
Sola lettura, si apre dal logo in testata. Mostra le card dei mesi e, dentro un mese,
le partite con refertisti e addetti all'arbitro.

I turni si leggono da un **Google Sheet pubblico** (configurato in
`dirigenza.json` → `foglio_turni.id`): chi li assegna scrive nel foglio e il sito li
vede al reload, senza commit. `site/data/turni.json` resta come **riserva**: se il
foglio non risponde (privato, 404, Google giu', timeout 8 s) la pagina usa il file e
mostra un avviso. Senza `id` la pagina legge solo il file.

- **Nessuna scrittura e nessun token**: la pagina legge solo file statici. Non c'e' piu'
  nessun percorso che scriva sul repo dal browser (l'admin e il worker OAuth sono stati
  rimossi).
- **Filtro**: chip "Solo in casa" (predefinito) e "Tutte le partite". Sta fuori dalle due
  viste, cosi' resta raggiungibile anche dentro un mese. Lo stato va nell'indirizzo
  (`?filtro=tutte&mese=2027-01`).
- **Casa e trasferta** si decidono con `playingHome()` in `app.js` e con `inCasa()` qui:
  con una squadra aperta conta il lato di *quella* squadra. In Open Misto Promozionale
  giocano Cercola e Portici, quindi "astro" compare da entrambe le parti.
- **Nessun doppione**: le partite si filtrano una per una, non per squadra. Il derby
  Cercola-Portici e' una partita sola e deve comparire una volta, non una per squadra.
  C'e' anche una deduplica esplicita su `data|casa|trasferta`.
- **Altra societa'**: le sue gare in casa arrivano da `data/partite-altra-societa.json`
  (vedi «Altra societa'» sotto) e prendono il badge "Referto <nome>". In
  `dirigenza.json` restano `altra_societa.pattern` e `.nome` per le gare che stessero
  gia' in `schedule.json`: servono solo a quelle, il file nuovo non ne ha bisogno.
- **Niente live**: la pagina usa solo lo snapshot. Il live FIPAV riporta le sole partite
  della nostra societa' e scarterebbe quelle dell'altra societa'.
- **Turni mancanti**: una voce che non trova la partita non rompe la pagina. La card del
  mese mostra quanti turni mancano.
- **Aggancio tollerante**: `riallineaTurni()` confronta `data|casa|trasferta` in forma
  ripulita (minuscole, accenti, spazi doppi), cosi' "asd astrovolley" combacia con
  "ASD ASTROVOLLEY". Se la trasferta e' scritta male ma data+casa sono univoche, il
  turno si aggancia lo stesso; altrimenti finisce negli **orfani**, segnalati sotto la
  lista. Il ripiego su data+casa non scatta se due partite in casa cadono lo stesso
  giorno: li' non si puo' indovinare.
- **Nome e cognome**: nella cella i nomi si separano con la virgola, quindi scrivere
  "Rossi, Mario" crea due persone. Va scritto "Mario Rossi". 

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
- **Entita' HTML nei nomi FIPAV**: il sito federale scrive gli accenti come entita'
  numeriche (`ASD PARCO CITT&#192;`), non come caratteri. Il testo va decodificato dal
  browser (`decodeEntities`, via `<textarea>`), non con una lista di `replace`: una lista
  copre solo i casi elencati e lascia in pagina il codice (`CITT&#192;`). Il difetto e'
  **intermittente** e insidioso, perche' lo snapshot dell'importer e' gia' corretto: si
  vede solo quando vince il dato letto dal vivo. Se un nome mostra codici, il sospetto
  numero uno e' un `stripTags`/`decodeEntities` incompleto, non l'encoding del file.
- L'header mostra **un bollino per fonte**: verde (`in diretta`) se letta dal vivo, rosso
  (`da archivio`) se si sta usando lo snapshot. Le fonti senza competizioni nel calendario
  non compaiono. `state.liveFonti[fonte]` tiene l'esito.
- `generato_il` è UTC **con** il fuso (`+00:00`): va passato intero a `new Date()`.
  Troncarlo (`.slice(0,19)`) lo fa leggere come ora locale e in Italia il dato sembra
  vecchio di un'ora appena scritto.
- **Nomi propri scritti a mano**: `site/formato-nomi.js` raccoglie `normName`,
  `titolaNome` e `slugify`, condivisi da `app.js` e `prenota.js`. `titolaNome` si applica
  **solo al rendering**: i dati grezzi restano quelli federali/del foglio, perche' le
  chiavi delle prenotazioni (`data|casa|trasferta`, vedi `site/prenota/palestre.js`) sono
  costruite sui nomi originali. Formattare il dato invece della sua resa romperebbe
  l'abbinamento con i turni gia' prenotati. Il modulo sta fuori da `app.js` perche' due
  copie divergerebbero; non va confuso con `site/prenota/nomi.js`, che e' l'elenco dei
  refertisti.
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
La catena è: si aggiorna `data/asi/*.risultati.json` → push → workflow "Aggiorna
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

## Turni (Google Sheet + site/data/turni.json)
La fonte normale e' il Google Sheet. Il file JSON resta come riserva e come formato di
scambio.

**Il foglio** ha una riga di intestazione con queste colonne, cercate per nome (l'ordine
non conta, le colonne in piu' si ignorano):

| colonna | contenuto |
|---|---|
| `data` | `YYYY-MM-DD HH:MM`, identica a `schedule.json` |
| `casa` | squadra di casa |
| `trasferta` | squadra ospite |
| `refertisti` | nomi separati da virgola |
| `addetti_arbitro` | nomi separati da virgola |

Il foglio va **pubblicato sul web** (File → Condividi → Pubblica sul web → *questo
foglio*), non condiviso con "chiunque abbia il link": cosi' si espone solo il tab dei
turni e il resto del documento resta privato. In cambio Google **non permette di
pubblicare solo alcuni tab**: il CSV contiene tutti i tab pubblicati, e `gid` sceglie
quale leggere.

Con un foglio pubblicato il link e' `.../d/e/2PACX-.../pubhtml` e il tab si indica con
`gid` (il numero dopo `gid=`), non con `nome`. `urlFoglio()` riconosce entrambi i
formati, piu' il solo id. Il CSV pubblicato esce con `max-age=300`, quindi l'URL porta
un cache-buster `_=<timestamp>`: senza, si leggerebbe una copia vecchia di 5 minuti.

**Ma il CSV pubblicato non e' una fotografia sola.** Google serve il file da piu'
istantanee (`doc-XX-.../pub/<id>/<timestamp>/`) e due letture ravvicinate possono
cadere su istantanee diverse: la pagina di prenotazione che leggeva solo il CSV
oscillava tra "sei prenotato" e "non sei prenotato" a ogni ricarica, mentre il
foglio era corretto. Per questo `site/prenota/` legge i turni dal backend
(`?azione=turni`, che apre il foglio in quel momento) e usa il CSV solo come
riserva. La pagina dirigenza legge ancora il CSV: li' un dato di 5 minuti non
cambia nulla, e il CSV evita di far girare Apps Script a ogni visita.

**Il file** (`turni.json`) usa lo stesso schema con `addetti_arbitro` come chiave:
ogni voce si aggancia con `data` + `casa` + `trasferta` scritti come in `schedule.json`.
Le voci senza partita vengono ignorate, quindi un rinvio non rompe la pagina.
Il file e' ancora vuoto: finche' il foglio non e' compilato la pagina mostra "da
assegnare".

**Il verde lo da' solo il nome.** `coperta(m)` e' `turniDi(m._key).refertisti.length > 0`:
una riga nel foglio con data e squadre ma refertisti vuoti viene scartata in lettura
(`if (!refertisti.length && !addetti.length) continue`) e la partita resta rossa. Quindi
copiare una partita nel foglio non basta a coprirla, e non serve a farla comparire: le
righe le disegna `schedule.json`, non il foglio.

**Le trasferte sono neutre.** Con `filtro=tutte` compaiono anche le gare fuori casa, con
classe `.partita-riga.esterna`: nessun verde/rosso e nessun blocco turni, perche' in
trasferta il referto non si cura e il colore sarebbe un allarme falso. Per lo stesso
motivo i contatori dei mesi escludono le trasferte da "scoperte", e un mese di sole
trasferte usa `.mese-card.mese-neutro` invece di `mese-ko`.

### Tab "Partite" del foglio: generato, non compilato
`importer/import_schedule.py` → `scrivi_csv_casa()` scrive `site/data/partite-casa.csv`
(include le gare in casa dell'altra societa' via `extra`; **non aggiungere colonne**:
il foglio le importa con IMPORTDATA e una colonna in piu' sposterebbe i dati,
sovrascrivendo i refertisti scritti a mano)
con le sole gare in casa (45 oggi), ordinate per data, e il workflow lo committa insieme
a `schedule.json`. Il foglio lo importa con `=IMPORTDATA("<url raw>")`.

Due trappole gia' pagate:
- il CSV si scrive **prima** del controllo "nessun cambiamento nei dati", che esce con
  `return 0`: se lo si mettesse dopo, alla prima esecuzione non verrebbe mai creato;
- `IMPORTDATA` mette in cache anche gli **errori**. Se il foglio ha letto l'URL quando il
  file non esisteva, continua a dire "Risorsa all'url indicato non trovata" anche dopo il
  push: si scavalca cambiando l'URL (`?v=1`). jsDelivr
  (`cdn.jsdelivr.net/gh/<owner>/<repo>@main/<path>`) e' l'alternativa: serve `text/csv` e
  non ha i limiti di frequenza di GitHub, ma tiene cache 12 ore.

### Altra societa' (solo area dirigenza)
Serve quando curiamo i referti di una societa' che non e' la nostra, senza mostrarne
il calendario nel sito pubblico.

- `config.json` → `altra_societa.societa_id` e' l'id FIPAV (`SId` nella sua pagina
  `risultati-classifiche.aspx`). Se e' vuoto la funzione resta spenta.
- `fipav_napoli.fetch_society_matches()` legge **solo** la pagina societa', non i
  gironi completi: quella pagina contiene gia' le sole sue partite (verificato: 40
  gare, nessuna estranea), quindi basta una richiesta e non serve indovinare il nome
  della squadra. Il nome si ricava da quello che ricorre in tutte le gare.
- `import_schedule.scrivi_altra_societa()` tiene solo le gare **in casa** e scrive
  `site/data/partite-altra-societa.json`, file separato: queste partite non entrano
  in `schedule.json`, quindi il sito pubblico non le vede.
- Le stesse gare in casa finiscono **anche** in `partite-casa.csv` (parametro
  `extra` di `scrivi_csv_casa`): il tab Partite del foglio e' l'unico posto da cui
  si copiano le righe su cui scrivere i turni, quindi senza di loro i referti
  dell'altra societa' non si potrebbero assegnare. Il CSV resta a tre colonne.
- `dirigenza.js` le unisce alle nostre con il flag `_altra` e mostra il badge
  "Referto <nome>". Arrivano gia' filtrate in casa, quindi non passa da `isAltraSquadra`.

### Turni non agganciati: come si recuperano
`riallineaTurni()` in `dirigenza.js` prova tre livelli, dal piu' certo al meno:

1. **data+ora+casa+trasferta** esatti (confronto con `impronta`, che ignora
   maiuscole, accenti e spazi doppi);
2. **data+ora+casa**, trasferta scritta in altro modo: si aggancia se quella
   coppia e' unica;
3. **giorno+casa+trasferta**, ora diversa: si aggancia perche' una squadra non
   gioca due volte lo stesso giorno contro lo stesso avversario. Il turno viene
   agganciato **e** segnalato, con l'ora giusta nel messaggio.

Se resta ambiguo (piu' partite in casa lo stesso giorno **e** avversario non
riconoscibile) non si aggancia niente e l'avviso dice gli orari in gioco. La
regola: meglio un turno da riassegnare a mano che un refertista sulla partita
sbagliata. Con due partite lo stesso giorno contro lo stesso avversario (non
esiste in pratica) il livello 3 non scatta, perche' la chiave non e' unica.

### Tab Turni: ricostruzione con i nomi che seguono la partita
`foglio/aggiungi-turni.gs` e' uno script Apps Script che gira **dentro** il foglio
dell'utente (non nel repo). Non incolla righe: **ricostruisce** il tab Turni in
ordine di data, prendendo le partite dal tab Partite e i nomi da un indice
`chiave -> valori compilati`. Cosi' un nome segue la sua partita anche quando la
partita cambia riga.

Prima di ogni riscrittura salva il tab Turni in `Storico turni`; la voce di menu
"Ripristina nomi dallo storico" usa quella fotografia per rimediare a un incolla
che ha sfasato i nomi. Lo storico tiene solo l'ultima copia.

Le partite sparite dal calendario non vengono eliminate: finiscono in fondo con i
loro nomi, per non perdere la traccia di un turno assegnato.

La chiave di confronto e' la stessa del sito: `impronta(data)|impronta(casa)|
impronta(trasferta)`. Attenzione a `dataInTesto()`: Sheets puo' restituire la data
come oggetto `Date`, e senza conversione la chiave diventerebbe
`Sat Nov 08 2026 18:00:00 GMT+0100` invece di `2026-11-08 18:00`.

**Trappola:** con `societa_id` vuoto la pagina FIPAV elenca tutto il comitato (59
competizioni). `fetch_society_matches()` solleva `ValueError` invece di importare
mezzo campionato: non togliere quel controllo.

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
- **Animazioni a cascata: usa `--i`, non `nth-child`.** Le card avevano quattro
  regole `nth-child(1..4)`: con sei squadre le ultime due entravano senza
  animazione. Ora `app.js` scrive `style="--i:<indice>"` sulla card e il CSS fa
  `animation-delay: calc(min(var(--i), 8) * 90ms)`. Cosi' vale per qualunque
  numero di card e regge se l'elenco cambia.
- **`prefers-reduced-motion` deve azzerare anche `animation-delay`.** Con
  `animation-fill-mode: both` e un ritardo non azzerato, l'elemento resta
  invisibile per tutta la durata del ritardo: chi chiede meno movimento vede la
  pagina vuota per ~400ms. Il blocco in `tema.css` azzera durata **e** ritardo.

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
- **Il filtro di partenza e' "tutte"**, ma le pillole restano: Tutte /
  Disputate / Da disputare, ognuna con il conteggio. Chi apre il calendario
  vuole l'elenco completo, poi semmai lo restringe. `state.filtro` vive
  nell'indirizzo solo se diverso da "tutte" (`&filtro=disputate`).
- Struttura: `.cal-head` (logo, titolo, tasto), `.cal-progress` (barra + `N/M`),
  poi `.fixture-row`.
- La riga mostra: giornata + data breve, **icona casa/trasferta**, `vs`, logo e
  nome dell'avversario, poi risultato (o orario) con lo stato.
- **Le icone sono le stesse della card della home**: `venueIcon(inCasa, size,
  cls)` disegna il tetto in casa e l'aereo in trasferta. In home va a 26px, nel
  calendario a 14px: cambia la misura, non il disegno. Non reintrodurre un
  pullman o altri simboli: la card e la riga devono parlare la stessa lingua. Le icone sono `aria-hidden` con un
  `sr-only` che dice "In casa"/"In trasferta"; l'`aria-label` della riga
  ripete il luogo, perche' il testo visibile da solo non lo direbbe.
- Casa e trasferta si distinguono **anche dal colore** (viola in casa, grigio
  fuori): a 14px il tetto e il pullman si somigliano.
- `.next-match` evidenzia la prossima partita da giocare (`prossimaPartita`),
  con la stessa tolleranza di 6 ore di `defaultRound`.
- `state.calRows` tiene le righe mostrate: la scheda dettagli si apre con
  quell'indice, non con quello di un'altra lista.
- **Un click = una voce di cronologia.** `showCalendar` chiama `applyView` e
  `mostraVistaCalendario` con `fromUrl: true` e scrive l'indirizzo una volta
  sola alla fine. Se si lascia che entrambe facciano `syncUrl()`, il tasto
  Indietro si ferma su uno stato intermedio (calendario aperto, URL senza
  `vista`) e serve premerlo due volte.
- **Attenzione ai tag nei template.** Il tasto Classifica della card e' passato
  da `<button>` a `<a>`: lasciando `</button>` il browser annidava "Prossima
  partita" dentro il link e le card crescevano di 100px. Se si cambia il tag di
  apertura, cambiare anche quello di chiusura.
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
