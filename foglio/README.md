# Aggiungere le partite nuove al tab Turni, in blocco

Il tab **Partite** si aggiorna da solo. Il tab **Turni** no, perche' contiene i nomi
dei refertisti scritti a mano: se lo si riscrive, i nomi si perdono.

Questo script risolve il problema: legge il tab Partite, guarda cosa c'e' gia' nel
tab Turni, e **appende in fondo solo le partite che mancano**, con refertisti e
addetti vuoti. Le righe gia' compilate non vengono toccate, spostate o riordinate.

## Perche' cosi' e non copiando e incollando

Copiare e incollare il tab Partite dentro il tab Turni sovrascrive le colonne dei
refertisti, perche' incolla righe intere. Con questo script il rischio non esiste:
le righe esistenti non vengono mai riscritte, si aggiunge solo sotto l'ultima.

Non serve nemmeno che le partite siano in ordine. Il collegamento fra un turno e
la sua partita e' per **data + squadra di casa + avversario**, non per numero di
riga. Quindi puoi avere le nuove in fondo, in disordine, e la pagina Dirigenza le
aggancia lo stesso.

## Installazione (una volta sola, circa 2 minuti)

1. Apri il foglio, menu **Estensioni → Apps Script**.
2. Cancella il contenuto dell'editor e incolla tutto `aggiungi-turni.gs`.
3. Salva (icona dischetto o Ctrl+S).
4. Ricarica il foglio: compare il menu **Turni** accanto a File/Modifica/Visualizza.
5. Se i tuoi tab non si chiamano esattamente `Partite` e `Turni`, correggi le due
   righe in cima allo script (`TAB_PARTITE`, `TAB_TURNI`).

Serve il runtime **V8** (in Apps Script: Impostazioni progetto → Runtime V8). E' il
default nei progetti nuovi; lo script usa `normalize()` per confrontare i nomi
senza badare ad accenti e maiuscole.

## Uso

Menu **Turni → Aggiungi partite mancanti**.

Ti dice quante ne ha aggiunte e a quali righe. Se non manca niente, lo dice e non
fa nulla. Puoi lanciarlo quando vuoi: rilanciarlo non duplica le righe.

Per non pensarci, puoi aggiungere un trigger giornaliero: in Apps Script, icona
dell'orologio (Trigger) → Aggiungi trigger → funzione `aggiungiPartiteMancanti`,
origine "Da foglio di calcolo", tipo "Timer giornaliero". Cosi' le partite nuove
compaiono da sole nel tab Turni ogni mattina.

## Cosa non fa

- **Non compila i nomi.** Quelli restano una tua scelta, riga per riga.
- **Non cancella partite.** Se una gara viene annullata e sparisce dal tab Partite,
  la riga resta nel tab Turni e la pagina Dirigenza la segnala come "non agganciata".
  Cosi' te ne accorgi invece di perdere il turno in silenzio.
- **Non riordina.** Le nuove restano in fondo, nell'ordine in cui compaiono in Partite.

## Se il tab Partite mostra ancora il file vecchio

E' la cache di Google, non il file. Su GitHub il CSV e' gia' aggiornato. Prova in
quest'ordine:

1. **Ricarica il foglio** (F5). Spesso basta.
2. **Togli e rimetti la formula**: seleziona la cella con `=IMPORTDATA(...)`,
   cancella, riscrivi la stessa formula. E' il modo piu' affidabile.
3. **Cambia l'URL** aggiungendo un parametro: `...partite-casa.csv?v=2` (poi `?v=3`
   la volta dopo). Google tratta ogni URL diverso come una risorsa nuova.
4. **Forza il ricalcolo**: File → Impostazioni → Calcolo → "Su modifica e ogni ora".

La cache di Google su `IMPORTDATA` puo' durare a lungo, e GitHub aggiunge 5 minuti
(`max-age=300`). Se aggiorni il foglio subito dopo un push e' normale vedere ancora
la versione precedente.

**Nota:** jsDelivr non e' una buona alternativa qui, nonostante sia suggerito nel
README principale. Serve lo stesso file ma con cache di 12 ore, quindi il problema
peggiora invece di migliorare.
