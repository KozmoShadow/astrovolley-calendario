# Prenotazione dei turni

Pagina: `site/prenota/` → `https://kozmosshadow.github.io/astrovolley-calendario/prenota/`

Un solo link da mettere nella descrizione del gruppo WhatsApp. Chi lo apre la
prima volta sceglie il proprio nome dall'elenco; da quel momento il telefono se lo
ricorda e non lo chiede piu'. Niente account, niente password, niente link
personali da mandare a 20 persone una per una.

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

### 4. Tab "Persone" (facoltativo)

L'elenco dei nomi viene ricavato dai turni gia' assegnati: chi compare almeno una
volta nel tab Turni viene proposto. Se preferisci un elenco tuo, crea un tab
`Persone` con la colonna `nome`: quello ha la precedenza.

Chi non e' nell'elenco puo' comunque scrivere il proprio nome a mano.

## Regole

- **2 refertisti e 1 addetto arbitro** per partita. Si cambiano in cima a
  `foglio/prenotazioni.gs` (`POSTI_REFERTISTA`, `POSTI_ADDETTI`) e, per la sola
  visualizzazione, in `site/prenota/prenota.js` (`POSTI_REFERTISTA`,
  `POSTI_ADDETTO`). **I due valori devono combaciare**: il backend e' quello che
  decide davvero, il sito serve solo a mostrare i posti liberi.
- **Una persona non puo' occupare due ruoli sulla stessa partita.** Se ci prova,
  riceve "Sei gia' prenotato per questa partita" invece di un errore.
- **Si puo' lasciare un turno**, ma solo il proprio: il nome deve corrispondere.
- **Il doppio tocco non duplica**: chi e' gia' dentro non viene riaggiunto.

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

## Verifiche fatte

Backend (28 test, script reale su finto `SpreadsheetApp`): prenotazione,
doppio tocco, maiuscole e accenti, posti esauriti, ruoli separati, rinuncia,
riga sbagliata, partita inesistente, nomi con virgola.

Pagina (25 test, Chromium su viewport telefono): scelta del nome, memoria del
telefono, raggruppamento per mese, badge "tuo", prenotazione con POST corretta,
persistenza dopo reload, cambio persona, nome scritto a mano, console pulita.
