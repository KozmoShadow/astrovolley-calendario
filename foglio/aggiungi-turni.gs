/**
 * Ricostruisce il tab "Turni" in ordine di data, tenendo i nomi attaccati alla
 * loro partita.
 *
 * Il problema: il tab Partite si aggiorna da solo (IMPORTDATA), il tab Turni no,
 * perche' contiene i refertisti scritti a mano. Se si copia e incolla il
 * calendario aggiornato, i nomi restano dove sono e finiscono sulla partita
 * sbagliata: la riga 20 di ieri non e' la riga 20 di oggi.
 *
 * La soluzione: invece di spostare le righe, si spostano i nomi. Si legge il tab
 * Turni e si annota, per ogni partita, chi ci sta sopra. Poi si riscrive tutto
 * in ordine di data: le partite vengono dal tab Partite, i nomi vengono
 * ripescati per chiave (data+casa+trasferta). Una partita che cambia posizione
 * si porta dietro i suoi nomi, perche' il legame e' sul contenuto, non sulla
 * riga.
 *
 * Le partite che spariscono dal calendario (annullate) non vengono buttate: si
 * tengono in fondo con i loro nomi, altrimenti si perderebbe la sola traccia
 * che quel turno era stato assegnato.
 *
 * Installazione e uso: vedi foglio/README.md
 */

// Nomi dei tab. Se nel foglio si chiamano diversamente, cambiali qui.
var TAB_PARTITE = "Partite";
var TAB_TURNI = "Turni";

// Tab di servizio: copia dei turni con i nomi, aggiornata a ogni esecuzione.
// Serve a recuperare le assegnazioni se un incolla ha spostato i nomi.
var TAB_STORICO = "Storico turni";

// Colonne attese, per nome di intestazione (non per posizione).
var COL_DATA = "data";
var COL_CASA = "casa";
var COL_TRASFERTA = "trasferta";

/**
 * Voce di menu, per non dover aprire l'editor ogni volta.
 * Apps Script la chiama da sola all'apertura del foglio.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Turni")
    .addItem("Riordina e aggiungi partite", "riordinaTurni")
    .addItem("Ripristina nomi dallo storico", "ripristinaDaStorico")
    .addToUi();
}

/**
 * Normalizza una stringa come fa il sito: minuscole, senza accenti, spazi
 * singoli. Serve perche' "ASD Astrovolley" e "ASD ASTROVOLLEY" sono la stessa
 * squadra, e il confronto deve riconoscerlo.
 */
function impronta(valore) {
  return String(valore == null ? "" : valore)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Chiave di una partita: data + squadra di casa + avversario.
 * E' la stessa usata dalla pagina Dirigenza per agganciare i turni, quindi se
 * una riga viene riconosciuta qui, viene riconosciuta anche li'.
 */
function chiavePartita(data, casa, trasferta) {
  return impronta(data) + "|" + impronta(casa) + "|" + impronta(trasferta);
}

/**
 * Trova l'indice di una colonna dall'intestazione. Restituisce -1 se manca.
 */
function indiceColonna(intestazione, nome) {
  for (var i = 0; i < intestazione.length; i++) {
    if (impronta(intestazione[i]) === nome) return i;
  }
  return -1;
}

/**
 * Formatta la data come la scrive il sito: "YYYY-MM-DD HH:MM".
 *
 * Il tab Partite arriva da un CSV, quindi Sheets puo' aver interpretato la
 * data come valore data/ora invece che come testo. Senza questa conversione si
 * finirebbe con "Sat Nov 08 2026 18:00:00 GMT+0100" e la chiave non
 * combacerebbe piu' con quella del sito.
 */
function dataInTesto(valore) {
  if (valore instanceof Date) {
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return (
      valore.getFullYear() + "-" + p2(valore.getMonth() + 1) + "-" + p2(valore.getDate()) +
      " " + p2(valore.getHours()) + ":" + p2(valore.getMinutes())
    );
  }
  return String(valore == null ? "" : valore).trim();
}

/**
 * Legge un tab e verifica che le colonne che servono esistano. Fallisce subito
 * e con un messaggio chiaro se il tab non ha la forma attesa: meglio un errore
 * leggibile che un foglio sfasato.
 */
function leggiTab(foglio, nomeTab) {
  var tab = foglio.getSheetByName(nomeTab);
  if (!tab) {
    throw new Error('Tab "' + nomeTab + '" non trovato. Controlla il nome esatto.');
  }
  var ultimaRiga = tab.getLastRow();
  var ultimaColonna = tab.getLastColumn();
  if (ultimaRiga < 1 || ultimaColonna < 1) {
    throw new Error('Il tab "' + nomeTab + '" e\' vuoto.');
  }
  var valori = tab.getRange(1, 1, ultimaRiga, ultimaColonna).getValues();
  var intestazione = valori[0];

  var iData = indiceColonna(intestazione, COL_DATA);
  var iCasa = indiceColonna(intestazione, COL_CASA);
  var iTrasferta = indiceColonna(intestazione, COL_TRASFERTA);
  if (iData < 0 || iCasa < 0 || iTrasferta < 0) {
    throw new Error(
      'Il tab "' + nomeTab + '" deve avere le colonne data, casa e trasferta. ' +
      'Trovate: ' + intestazione.join(", ")
    );
  }
  return {
    tab: tab,
    intestazione: intestazione,
    righe: valori.slice(1),
    iData: iData,
    iCasa: iCasa,
    iTrasferta: iTrasferta,
    ultimaRiga: ultimaRiga,
    ultimaColonna: ultimaColonna,
  };
}

/**
 * Estrae i valori "compilati a mano" di una riga: tutte le colonne che non sono
 * data/casa/trasferta. Si tiene la posizione, cosi' le colonne restano allineate
 * anche se il foglio ne ha di piu' (refertisti, addetti arbitro, note).
 */
function valoriCompilati(riga, iData, iCasa, iTrasferta, larghezza) {
  var valori = [];
  for (var c = 0; c < larghezza; c++) {
    if (c === iData || c === iCasa || c === iTrasferta) {
      valori.push(null); // segnaposto: la colonna non si tocca
    } else {
      valori.push(riga[c] === undefined ? "" : riga[c]);
    }
  }
  return valori;
}

/**
 * Vero se almeno una colonna compilata contiene qualcosa. Una riga senza nomi
 * non ha bisogno di essere recuperata: la si puo' ricostruire dal calendario.
 */
function haNomi(valori) {
  for (var i = 0; i < valori.length; i++) {
    if (valori[i] === null) continue;
    if (String(valori[i]).trim() !== "") return true;
  }
  return false;
}

/**
 * Compone una riga del tab Turni: data, casa, trasferta dal calendario e i
 * valori compilati (nomi) dalla posizione che avevano. Se non c'erano nomi,
 * restano vuoti.
 */
function componiRiga(voce, valori, turni, larghezza) {
  var riga = [];
  for (var c = 0; c < larghezza; c++) riga.push("");
  riga[turni.iData] = voce.data;
  riga[turni.iCasa] = voce.casa;
  riga[turni.iTrasferta] = voce.trasferta;
  if (valori) {
    for (var v = 0; v < valori.length; v++) {
      if (valori[v] === null) continue;
      if (v < larghezza) riga[v] = valori[v];
    }
  }
  return riga;
}

/**
 * Cerca nel tab Turni la riga con quella chiave e ne restituisce data/casa/
 * trasferta originali, per poter ricomporre un turno rimasto orfano.
 */
function trovaRiga(turni, chiave) {
  for (var i = 0; i < turni.righe.length; i++) {
    var r = turni.righe[i];
    var d = dataInTesto(r[turni.iData]);
    var c = r[turni.iCasa];
    var t = r[turni.iTrasferta];
    if (chiavePartita(d, c, t) === chiave) {
      return { data: d, casa: c, trasferta: t, chiave: chiave };
    }
  }
  return null;
}

/**
 * Ricostruisce il tab Turni in ordine di data, portando i nomi dietro la
 * partita a cui appartengono.
 */
function riordinaTurni() {
  var foglio = SpreadsheetApp.getActiveSpreadsheet();
  var partite = leggiTab(foglio, TAB_PARTITE);
  var turni = leggiTab(foglio, TAB_TURNI);
  var larghezza = Math.max(turni.ultimaColonna, partite.ultimaColonna);

  // Fotografia dei nomi PRIMA di riscrivere: se un incolla ha sfasato le righe,
  // e' l'unico punto in cui si puo' ancora recuperare l'abbinamento buono.
  salvaStorico(foglio, turni, larghezza);

  var nomi = nomiPerChiave(turni, larghezza);
  var esito = ricostruisci(partite, turni, nomi, larghezza);

  messaggio(
    "Tab Turni ricostruito: " + esito.partite + " partite in ordine di data" +
    (esito.orfani ? ", piu' " + esito.orfani + " turni non piu' in calendario in fondo" : "") +
    ". Nomi conservati su " + esito.conNomi + " partite." +
    (esito.orfani ? " Controlla le ultime " + esito.orfani + " righe." : "")
  );
  return esito.partite;
}

/**
 * Nomi compilati del tab Turni, indicizzati per partita. Le righe senza nomi si
 * ignorano: si ricostruiscono dal calendario.
 */
function nomiPerChiave(tab, larghezza) {
  var nomi = {};
  for (var i = 0; i < tab.righe.length; i++) {
    var r = tab.righe[i];
    var d = dataInTesto(r[tab.iData]);
    var c = r[tab.iCasa];
    var t = r[tab.iTrasferta];
    if (!d && !c && !t) continue;
    var valori = valoriCompilati(r, tab.iData, tab.iCasa, tab.iTrasferta, larghezza);
    if (!haNomi(valori)) continue;
    nomi[chiavePartita(d, c, t)] = valori;
  }
  return nomi;
}

/**
 * Riscrive il corpo del tab Turni: partite dal calendario in ordine di data,
 * nomi ripescati per chiave. Usata sia dal riordino sia dal ripristino, cosi'
 * le due strade non possono divergere.
 *
 * Le partite sparite dal calendario (annullate) finiscono in fondo con i loro
 * nomi: buttarle via significherebbe perdere la sola traccia che quel turno era
 * stato assegnato.
 */
function ricostruisci(partite, turni, nomi, larghezza) {
  var elenco = [];
  var viste = {};
  for (var j = 0; j < partite.righe.length; j++) {
    var p = partite.righe[j];
    var pData = dataInTesto(p[partite.iData]);
    var pCasa = p[partite.iCasa];
    var pTrasferta = p[partite.iTrasferta];
    if (!pData || !pCasa) continue;
    var pk = chiavePartita(pData, pCasa, pTrasferta);
    if (viste[pk]) continue;
    viste[pk] = true;
    elenco.push({ data: pData, casa: pCasa, trasferta: pTrasferta, chiave: pk });
  }
  // Le date sono stringhe "YYYY-MM-DD HH:MM": ordinate come testo sono gia'
  // in ordine cronologico.
  elenco.sort(function (a, b) {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    if (a.casa !== b.casa) return a.casa < b.casa ? -1 : 1;
    return a.trasferta < b.trasferta ? -1 : a.trasferta > b.trasferta ? 1 : 0;
  });

  var righe = [];
  var usate = {};
  var conNomi = 0;
  for (var n = 0; n < elenco.length; n++) {
    var e = elenco[n];
    var valori = nomi[e.chiave];
    if (valori) { usate[e.chiave] = true; conNomi++; }
    righe.push(componiRiga(e, valori, turni, larghezza));
  }

  var orfani = 0;
  for (var k in nomi) {
    if (!Object.prototype.hasOwnProperty.call(nomi, k) || usate[k]) continue;
    var origine = trovaRiga(turni, k);
    if (!origine) continue;
    righe.push(componiRiga(origine, nomi[k], turni, larghezza));
    orfani++;
  }

  turni.tab.getRange(1, 1, turni.ultimaRiga, larghezza).clearContent();
  if (righe.length) turni.tab.getRange(2, 1, righe.length, larghezza).setValues(righe);
  turni.tab.getRange(1, 1, 1, turni.intestazione.length).setValues([turni.intestazione]);

  return { partite: elenco.length, conNomi: conNomi, orfani: orfani };
}

/**
 * Copia il tab Turni (com'e' adesso, nomi compresi) nel tab Storico turni.
 *
 * Non e' un backup generico: e' la fotografia di "chi era assegnato a cosa"
 * prima di una riscrittura. Se un incolla ha spostato i nomi sulle righe
 * sbagliate, questa e' la versione da cui ripartire.
 *
 * Si tiene solo l'ultima: serve a un passo indietro, non a una cronologia.
 */
function salvaStorico(foglio, turni, larghezza) {
  var tab = foglio.getSheetByName(TAB_STORICO);
  if (!tab) tab = foglio.insertSheet(TAB_STORICO);
  var righe = [turni.intestazione.slice(0, larghezza)];
  for (var i = 0; i < turni.righe.length; i++) {
    var r = turni.righe[i];
    var riga = [];
    for (var c = 0; c < larghezza; c++) riga.push(r[c] === undefined ? "" : r[c]);
    righe.push(riga);
  }
  tab.clear();
  tab.getRange(1, 1, righe.length, larghezza).setValues(righe);
}

/**
 * Rimette nel tab Turni i nomi salvati nello storico, abbinandoli per partita,
 * e riordina per data. Va usata quando un incolla ha sfasato le righe: il tab
 * Turni ha le partite giuste ma i nomi sulle righe sbagliate, e lo storico ha
 * l'abbinamento corretto.
 */
function ripristinaDaStorico() {
  var foglio = SpreadsheetApp.getActiveSpreadsheet();
  var storicoTab = foglio.getSheetByName(TAB_STORICO);
  if (!storicoTab || storicoTab.getLastRow() < 2) {
    throw new Error(
      'Tab "' + TAB_STORICO + '" vuoto o assente. Serve almeno una esecuzione ' +
      'di "Riordina e aggiungi partite" fatta prima dello sfasamento.'
    );
  }
  var partite = leggiTab(foglio, TAB_PARTITE);
  var turni = leggiTab(foglio, TAB_TURNI);
  var storico = leggiTab(foglio, TAB_STORICO);
  var larghezza = Math.max(turni.ultimaColonna, storico.ultimaColonna, partite.ultimaColonna);

  var nomi = nomiPerChiave(storico, larghezza);
  var esito = ricostruisci(partite, turni, nomi, larghezza);

  messaggio(
    "Nomi ripristinati dallo storico su " + esito.conNomi + " partite su " +
    esito.partite + ", in ordine di data." +
    (esito.orfani ? " " + esito.orfani + " turni non piu' in calendario in fondo." : "")
  );
  return esito.conNomi;
}

/**
 * Mostra un messaggio sia nell'interfaccia sia nel log di esecuzione: se lo
 * script gira da trigger non c'e' nessuna finestra, e senza log non si
 * capirebbe cosa e' successo.
 */
function messaggio(testo) {
  Logger.log(testo);
  try {
    SpreadsheetApp.getUi().alert(testo);
  } catch (e) {
    // Nessuna interfaccia (esecuzione da trigger): basta il log.
  }
}
