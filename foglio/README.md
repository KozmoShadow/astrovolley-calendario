# Tab Turni: riordino automatico con i nomi che seguono la partita

Il tab **Partite** si aggiorna da solo. Il tab **Turni** no, perche' contiene i
refertisti scritti a mano.

Questo script risolve il problema alla radice: quando il calendario cambia, il tab
Turni viene **ricostruito in ordine di data**, e i nomi vengono riportati sulla
partita a cui erano stati assegnati. Non sulla riga: sulla partita.

## Il problema che risolve

Copiare e incollare il calendario aggiornato nel tab Turni ha due conseguenze:

1. i nomi restano nelle celle in cui stavano, che pero' ora contengono **un'altra
   partita** (la riga 20 di ieri non e' la riga 20 di oggi);
2. le colonne si sfasano, perche' l'incolla porta con se' righe intere.

Lo script evita entrambe: non incolla niente, ricostruisce. Legge i nomi dal tab
Turni, li indicizza per partita (data + squadra di casa + avversario), poi riscrive
tutto in ordine di data prendendo le partite dal calendario e i nomi dall'indice.

## Installazione (una volta sola, circa 2 minuti)

1. Apri il foglio, menu **Estensioni → Apps Script**.
2. Cancella il contenuto dell'editor e incolla tutto `aggiungi-turni.gs`.
3. Salva (Ctrl+S) e ricarica il foglio.
4. Compare il menu **Turni** con due voci.
5. Se i tuoi tab non si chiamano `Partite` e `Turni`, correggi le costanti in cima
   allo script.

Serve il runtime **V8** (default nei progetti nuovi): lo script usa
`normalize()` per confrontare i nomi senza badare ad accenti e maiuscole.

## Uso

**Turni → Riordina e aggiungi partite**

Ogni volta che il calendario cambia (o quando vuoi), lancia questa voce. Fa tre
cose in un colpo:

- mette le partite in ordine di data;
- aggiunge quelle nuove, con refertisti vuoti;
- tiene i nomi attaccati alla loro partita, anche se la partita si e' spostata.

Rilanciarlo non duplica niente: si puo' fare quante volte si vuole.

Puoi anche mettere un trigger giornaliero (Apps Script → icona orologio → funzione
`riordinaTurni`, timer giornaliero) e non pensarci piu'.

## Se hai gia' incollato male

Lo script salva una fotografia dei turni nel tab **Storico turni** prima di ogni
riscrittura. Se un incolla ha sfasato i nomi:

**Turni → Ripristina nomi dallo storico**

Rimette i nomi sulla partita giusta, usando l'abbinamento salvato prima dello
sfasamento, e riordina per data.

Funziona solo se lo storico esiste, cioe' se avevi gia' lanciato il riordino almeno
una volta **prima** dell'incolla sbagliato. Lo storico tiene solo l'ultima
fotografia: serve a un passo indietro, non a una cronologia.

## Cosa succede alle partite annullate

Se una gara sparisce dal calendario, il turno **non viene buttato**: finisce in
fondo con i suoi nomi, e il messaggio finale dice quante righe controllare.
Cancellarlo significherebbe perdere la sola traccia che quel turno era stato
assegnato. Quando hai verificato, cancelli la riga a mano.

## Cosa non fa

- **Non compila i nomi.** Quelli restano una tua scelta.
- **Non tocca il tab Partite**, che resta generato da `IMPORTDATA`.

## Se il tab Partite mostra ancora il file vecchio

E' la cache di Google, non il file: su GitHub il CSV e' gia' aggiornato. Prova in
quest'ordine:

1. **Ricarica il foglio** (F5).
2. **Togli e rimetti la formula** `=IMPORTDATA(...)`. E' il metodo piu' affidabile.
3. **Cambia l'URL** aggiungendo un parametro: `...partite-casa.csv?v=2`.

GitHub aggiunge 5 minuti di cache (`max-age=300`), Google puo' tenerne molta di piu'.
**Non usare jsDelivr** per questo: ha cache di 12 ore e peggiora il problema.
