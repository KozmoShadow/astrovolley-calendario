# Prenotazione dei turni

Pagina: `site/prenota/` → `https://kozmosshadow.github.io/astrovolley-calendario/prenota/`

Un solo link da mettere nella descrizione del gruppo WhatsApp. Chi lo apre la
prima volta sceglie il proprio nome dall'elenco; da quel momento il telefono se lo
ricorda e non lo chiede piu'. Niente account, niente password, niente link
personali da mandare a 20 persone una per una.

Si prenota **solo il refertista, un posto per partita**. L'addetto all'arbitro
riguarda la dirigenza, che lo assegna a mano nel foglio: chi prenota non lo vede
e non lo tocca. La pagina mostra solo la partita, il giorno e il posto da
refertista.

I turni sono divisi **per mese**: si apre la pagina, si vedono le card dei mesi
con quante partite hanno e quanti posti restano, e si entra solo in quello che
interessa. Cosi' a gennaio non si scorre tutta la stagione. La card e' verde se
il mese e' tutto libero, gialla se e' misto, grigia se e' tutto preso.

**"Posti liberi" conta solo quelli che posso ancora prendere io.** Una partita a
cui sono gia' prenotato non e' un posto libero, e' fatta: se a novembre restano
tre partite e mi prenoto a due, la card dice "1 posto libero · 2 tue", non
"3 posti liberi". Quando non resta niente da prendere ma sono dentro, la card
dice "ci sei tu" ed e' verde, non grigia: il grigio resta per i mesi in cui i
posti li hanno presi altri.

## Come funziona (e perche' cosi')

Due canali, per un motivo tecnico preciso:

- **Lettura dal CSV pubblicato del foglio.** Google serve quell'URL con
  `Access-Control-Allow-Origin: *`, quindi il browser lo legge senza problemi. E'
  lo stesso meccanismo che usa gia' la pagina Dirigenza.
- **Scrittura verso la web app Apps Script**, che gira con le autorizzazioni della
  dirigenza e puo' modificare il foglio.

La lettura **non** passa dalla web app perche' una GET cross-origin verso
`script.google.com` viene bloccata da CORS: verificato, manca l'header. Il POST
invece passa, perche' con `Content-Type: text/plain` il browser non fa preflight
e Apps Script non deve rispondere a `OPTIONS` (cosa che non sa fare).

## Installazione

### 1. Aggiungi il backend al progetto Apps Script

Nello stesso progetto del foglio (Estensioni → Apps Script) aggiungi un file
nuovo e incolla `foglio/prenotazioni.gs`.

Se hai gia' `aggiungi-turni.gs`, va bene lo stesso file di progetto: le funzioni
convivono. Attenzione pero' a non avere due copie di `apriFoglio()`: se incolli
entrambi i file, cancella `apriFoglio()` da uno dei due.

### 2. Pubblica la web app

In Apps Script: **Esegui il deployment → Nuovo deployment → App web**.

- Descrizione: `Prenotazioni turni`
- **Esegui come: me** (tuo account) — obbligatorio, altrimenti chi prenota
  dovrebbe autorizzare lo script
- **Chi ha accesso: chiunque** — obbligatorio, altrimenti i refertisti trovano
  la pagina di login di Google

Copia l'indirizzo che finisce con **`/exec`** (non `/dev`).

### 3. Incollalo in `site/prenota/config.js`

```js
export const URL_BACKEND = "https://script.google.com/macros/s/AKfy.../exec";
```

Commit e push. La pagina e' attiva.

### 4. Compila l'elenco dei nomi

Apri `site/prenota/nomi.js` e scrivi i refertisti, uno per riga:

```js
export const NOMI_REFERTISTI = [
  "Mario Rossi",
  "Anna Bianchi",
];
```

E' l'unico modo per far comparire chi non ha ancora mai prenotato. Se lo lasci
vuoto la pagina ripiega sui nomi gia' presenti nei turni del foglio, ma chi non
ha mai prenotato non compare.

L'ordine nel file non conta: la pagina li ordina per **cognome**, perche' con
sedici nomi e' il cognome quello che si cerca. Non usare virgole dentro il nome
(spezzerebbero la cella del foglio) e scrivili come devono comparire nel foglio
Turni: il confronto ignora maiuscole e spazi doppi, ma non abbreviazioni.

Con sedici voci l'elenco su un telefono starebbe su due schermate, con il campo
"scrivi il tuo nome" in fondo: su schermo stretto le pillole vanno quindi su due
colonne, compatte, e il suggerimento in cima si nasconde. Se l'elenco cresce
molto (oltre una trentina) conviene passare a un campo di ricerca invece delle
pillole.

L'ordine del file non conta: la pagina li mostra in ordine alfabetico per
cognome.

**Non c'e' un campo per scrivere il nome a mano.** La pagina mostra solo i nomi
dell'elenco: chi non c'e' lo deve far aggiungere dalla dirigenza, che modifica
`nomi.js` e fa il push. E' una scelta voluta, per non ritrovarsi nel foglio nomi
scritti in modi diversi ("Antonio", "Antonio Liguoro", "T. Liguoro") che poi
spezzano il conteggio delle prenotazioni per persona.

## Perche' si apre in fretta (o no)

Il collo di bottiglia e' il backend: ogni chiamata rilegge tutto il foglio e
impiega **1,5-2 secondi**, sia a freddo sia a caldo. Non e' la rete e non e'
l'avvio di Apps Script: misurato, non ipotizzato. Quindi la pagina evita di
chiamarlo quando non serve.

- **La scelta del nome non aspetta il foglio.** I sedici nomi stanno in
  `nomi.js`: la schermata compare in ~50 ms e la lettura dei turni parte in
  sottofondo. Prima si aspettavano due secondi per mostrare nomi che erano gia'
  nel telefono.
- **Una lettura alla volta.** Se una lettura e' gia' in corso, chi la chiede
  dopo aspetta quella, non ne apre una seconda.
- **Copia valida 30 secondi.** Due letture ravvicinate riusano la stessa.
  Volutamente breve: i turni li prende anche altra gente.
- **La prenotazione usa la risposta del POST.** La web app restituisce gia' i
  turni aggiornati, letti dentro il lock subito dopo la scrittura. Prima il
  sito li buttava e rifaceva una GET da altri 1,5-2 secondi: il giro completo
  era POST + GET, ora e' solo POST.

Quello che **non** e' stato fatto, e perche': una cache lato backend
(CacheService) o una lettura parziale del foglio sarebbero i veri
guadagni, ma cambiano il backend e possono mostrare dati vecchi a chi prenota
mentre un altro ha appena preso il posto. Con un solo refertista per partita e
poche decine di partite non vale il rischio: la copia di 30 secondi lato sito
copre il caso reale, cioe' aprire la pagina e toccare un turno.

## Chi prenota lo vede subito? Non proprio, e va detto

Non c'e' modo di avvisare un telefono quando un altro prenota: il sito e'
statico e la web app non ha un canale persistente. L'unica strada e' chiedere
periodicamente. Ma ogni richiesta e' un'esecuzione di Apps Script, e la quota
giornaliera e' limitata: con sedici refertisti e un controllo ogni trenta
secondi senza copia si arriva a **oltre cinquanta minuti di esecuzione al
giorno**, abbastanza da bloccare le prenotazioni per tutti.

Quindi il controllo e' stato progettato per costare poco:

- **Copia lato backend, quindici secondi** (`CacheService`). Non serve a
  risparmiare letture: serve a non bruciare la quota. Sedici telefoni che
  controllano nello stesso minuto pagano una sola lettura del foglio. Ogni
  scrittura svuota la copia e ci mette subito lo stato appena letto, cosi' chi
  ha appena prenotato vede il proprio risultato senza attendere.
- **Controllo ogni quindici secondi**, solo con la pagina visibile, e si ferma
  dopo dieci minuti senza tocchi. Con la pagina in secondo piano non parte
  niente: i telefoni rallentano i timer e non servirebbe a nessuno.
- **Controllo immediato al ritorno sulla pagina**, che e' il momento in cui il
  rischio di guardare dati vecchi e' piu' alto.

Come si comporta quando qualcosa cambia:

- **Se cambia il tuo stato** (il tuo turno e' stato preso o liberato da un
  altro) la pagina si ridisegna subito. Lasciarti un bottone che non funziona
  sarebbe peggio di un ridisegno.
- **Se cambia qualcosa d'altro** compare un avviso con un bottone "Aggiorna" e
  la pagina resta ferma. Ridisegnare di nascosto mentre stai leggendo, o mentre
  stai per toccare "Ci sono", sposta le card sotto il dito e il tocco finirebbe
  sul turno sbagliato.

Quindici secondi non e' "in tempo reale": chi prenota per ultimo puo' sempre
trovare il turno appena preso, e in quel caso la web app risponde "occupato" e
la pagina si aggiorna. La copia lato backend **non** cambia questa garanzia:
la prenotazione resta protetta dal lock sul foglio.

## Regole

- **Un solo refertista per partita.** Si cambia in cima a `foglio/prenotazioni.gs`
  (`POSTI_REFERTISTA`) e, per la sola visualizzazione, in `site/prenota/prenota.js`
  (`POSTI_REFERTISTA`). **I due valori devono combaciare**: il backend e' quello
  che decide davvero, il sito serve solo a mostrare i posti liberi.
- **L'addetto arbitro non si prenota.** Il backend rifiuta la richiesta con "Da
  qui si prenota solo il refertista", anche se qualcuno la inviasse a mano.
- **La scheda si aggiorna subito dopo la prenotazione.** Il backend scrive il
  foglio all'istante, ma il CSV pubblicato da Google si allinea con qualche
  minuto di ritardo. Rileggendo solo il CSV, la partita appena prenotata
  tornava vuota e sembrava non fosse successo niente. La pagina tiene memoria
  della propria prenotazione finche' il foglio non la conferma: se la fonte
  resta indietro, comanda la memoria locale.
- **I turni si leggono dal backend, non dal CSV.** Il CSV pubblicato non e' una
  fotografia sola: Google tiene piu' istantanee e due letture ravvicinate
  possono cadere su istantanee diverse. Da li' veniva la pagina che, ricaricando,
  diceva "sei prenotato" e poi "non sei prenotato". Il backend legge il foglio
  in quel momento, quindi e' coerente. Il CSV resta come riserva per quando la
  web app non risponde.
- **La palestra sta accanto a data e ora.** Non e' nel foglio dei turni: si
  prende da `site/data/schedule.json` e da `site/data/partite-altra-societa.json`
  con `scripts/genera_palestre.py`, che scrive `site/prenota/palestre.js`. Il
  workflow del calendario lo rigenera a ogni aggiornamento, quindi non va
  toccato a mano. Se una partita non ha la palestra, la riga mostra solo data e
  ora, senza lasciare un buco.
- **Si puo' lasciare un turno**, ma solo il proprio: il nome deve corrispondere.
- **Il doppio tocco non duplica**: chi e' gia' dentro non viene riaggiunto.

## Se sbagliano a scegliere il nome

Il link **non sei tu?** accanto al nome riporta alla scelta.
Attenzione a cosa succede: **i turni gia' prenotati restano assegnati al nome
sbagliato**. Non si spostano da soli, perche' il sistema non ha modo di sapere se
e' un errore o una persona diversa sullo stesso telefono.

Dopo il cambio la pagina lo dice esplicitamente, con la nota che compare sotto il
nome. La procedura e':

1. toccare **non sei tu?** e scegliere il nome giusto
2. aprire i turni presi per sbaglio e toccare **Ci sono ✓** per lasciarli
3. prenotarli di nuovo con **Ci sono**

Se non se ne accorgono, si corregge anche dal foglio: e' una cella di testo, si
cambia il nome a mano. Anzi, per la dirigenza e' la via piu' rapida.

Il nome resta scritto nel telefono (`localStorage`), quindi vale finche' non
cambiano browser o non cancellano i dati. Se un telefono viene passato a un'altra
persona, va fatto **non sei tu?** la prima volta.

## Cosa NON e' protetto

Il link e' pubblico: chi lo ha puo' prenotare a nome di chiunque nell'elenco, e
puo' lasciare i turni di un altro solo se ne conosce il nome esatto. Per un club
di 20 persone che si conoscono e' un compromesso accettabile; non lo sarebbe per
altro.

Il rischio concreto non e' il vandalismo, e' l'errore: due che prenotano lo stesso
posto nello stesso secondo. Quello e' gestito con `LockService`: il controllo dei
posti liberi avviene dentro il lock, quindi il secondo riceve "posti esauriti"
invece di sovrascrivere il primo.

## Se qualcosa non funziona

**La pagina dice "Prenotazioni non ancora attive"** → manca `URL_BACKEND` in
`config.js`, oppure il deploy e' stato fatto ma non hai rifatto il push.

**"Risposta non valida dal foglio"** → hai incollato l'indirizzo `/dev` invece di
`/exec`, oppure il deployment non e' "chiunque".

**I turni non si vedono** → il CSV in `config.js` non e' quello giusto. Deve
essere il link "Pubblica sul web" del foglio, come in `site/data/dirigenza.json`.

**Ho prenotato ma il foglio non cambia** → guarda in Apps Script, menu
**Esecuzioni**: c'e' il log con l'errore.

**Non compare il nome di una persona** → non e' in `site/prenota/nomi.js`. Si
aggiunge li' e si rifa' il push: dalla pagina non c'e' modo di inserirlo, e'
voluto. Il nome va scritto come deve comparire nel foglio Turni.

**Compare "Stai prenotando come" mentre sto ancora scegliendo** → non deve
succedere. La barra e' nascosta finche' un nome non e' scelto. Se ricapita,
il sospetto e' una regola CSS con `display` su `#prn-io`: l'attributo `hidden`
perde contro qualsiasi classe che imposti `display`, ed e' esattamente il
difetto che c'era. In cima a `prenota.css` c'e' una regola `[hidden]` con
`!important` che lo impedisce: non toglierla.

## Verifiche fatte

Backend (30 test, script reale su finto `SpreadsheetApp`): prenotazione, doppio
tocco, maiuscole e accenti, posto unico con rifiuto nominando chi l'ha preso,
addetto rifiutato, rinuncia e riprenotazione, riga sbagliata, partita
inesistente, nomi con virgola.

Pagina (35 test, Chromium su viewport telefono): lista fissa con ordine
alfabetico, chi non ha mai prenotato compare, addetto mai mostrato, nessun badge
in casa/trasferta, card dei mesi con conteggi e colori, apertura e ritorno ai
mesi, palestra al posto di "Refertista", scheda che si aggiorna anche con la
fonte in ritardo, nessuna oscillazione con due istantanee del CSV diverse,
turni pieni con
bottone disabilitato, payload POST senza ruolo, nota dopo il cambio nome,
memoria del telefono, console pulita.

In piu' una prova a mano con il **CSV vero del foglio**: 18 partite Flat senza
riga addetto, mesi da novembre a maggio, "1 partita" al singolare.
