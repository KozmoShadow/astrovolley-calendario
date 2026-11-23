/**
 * Aggiunge al tab "Turni" le partite che ancora non ci sono.
 *
 * Perche' serve: il tab "Partite" si aggiorna da solo (IMPORTDATA), il tab
 * "Turni" no, perche' contiene i nomi scritti a mano. Copiare a mano le righe
 * nuove significa anche rischiare di sfasarle rispetto alle colonne compilate.
 *
 * Questo script non tocca le righe esistenti: legge le chiavi gia' presenti,
 * e appende in fondo solo quelle che mancano, con refertisti e addetti vuoti.
 * Nessun ordinamento, nessuno spostamento: le righe che hai compilato restano
 * dove sono, con i loro nomi.
 *
 * Installazione: vedi foglio/README.md
 */

// Nomi dei tab. Se nel foglio si chiamano diversamente, cambiali qui.
var TAB_PARTITE = "Partite";
var TAB_TURNI = "Turni";

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
    .addItem("Aggiungi partite mancanti", "aggiungiPartiteMancanti")
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
 * Legge un tab e restituisce intestazione + righe, verificando che le colonne
 * che servono esistano. Fallisce subito e con un messaggio chiaro se il tab
 * non ha la forma attesa: meglio un errore leggibile che un foglio sfasato.
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
 * Aggiunge al tab Turni le partite presenti in Partite ma non ancora in Turni.
 * Non modifica, non riordina e non cancella nessuna riga esistente.
 */
function aggiungiPartiteMancanti() {
  var foglio = SpreadsheetApp.getActiveSpreadsheet();
  var partite = leggiTab(foglio, TAB_PARTITE);
  var turni = leggiTab(foglio, TAB_TURNI);

  // Chiavi gia' presenti nel tab Turni: sono intoccabili.
  var presenti = {};
  for (var i = 0; i < turni.righe.length; i++) {
    var r = turni.righe[i];
    var data = dataInTesto(r[turni.iData]);
    var casa = r[turni.iCasa];
    var trasferta = r[turni.iTrasferta];
    // Righe vuote (sotto l'ultima compilata) non contano.
    if (!data && !casa && !trasferta) continue;
    presenti[chiavePartita(data, casa, trasferta)] = true;
  }

  // Righe da aggiungere: solo quelle che mancano davvero.
  var daAggiungere = [];
  var visti = {};
  for (var j = 0; j < partite.righe.length; j++) {
    var p = partite.righe[j];
    var pData = dataInTesto(p[partite.iData]);
    var pCasa = p[partite.iCasa];
    var pTrasferta = p[partite.iTrasferta];
    if (!pData || !pCasa) continue;
    var k = chiavePartita(pData, pCasa, pTrasferta);
    if (presenti[k] || visti[k]) continue;
    visti[k] = true;
    daAggiungere.push([pData, pCasa, pTrasferta]);
  }

  if (!daAggiungere.length) {
    messaggio("Nessuna partita nuova: il tab Turni e' gia' completo.");
    return 0;
  }

  // Larghezza delle righe nuove = larghezza del tab Turni, cosi' le colonne
  // refertisti e addetti restano allineate anche se ne hai aggiunte altre.
  var larghezza = turni.ultimaColonna;
  var righe = daAggiungere.map(function (riga) {
    var piena = [];
    for (var c = 0; c < larghezza; c++) {
      piena.push(c < riga.length ? riga[c] : "");
    }
    return piena;
  });

  // Scrittura in un colpo solo, subito sotto l'ultima riga: nessuna riga
  // esistente viene spostata.
  turni.tab
    .getRange(turni.ultimaRiga + 1, 1, righe.length, larghezza)
    .setValues(righe);

  messaggio(
    "Aggiunte " + righe.length + " partite al tab Turni (righe " +
    (turni.ultimaRiga + 1) + "-" + (turni.ultimaRiga + righe.length) + "). " +
    "Le righe gia' compilate non sono state toccate."
  );
  return righe.length;
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
