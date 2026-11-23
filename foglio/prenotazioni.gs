/**
 * Backend delle prenotazioni dei turni.
 *
 * Il sito e' statico e non puo' scrivere: questa web app fa da ponte tra la
 * pagina di prenotazione e il tab Turni del foglio.
 *
 * Perche' una web app e non una pagina che scrive direttamente sul foglio: un
 * browser non puo' autenticarsi su Google senza far accedere l'utente, e i 20
 * refertisti non devono avere un account ne' autorizzare nulla. La web app gira
 * con le autorizzazioni del proprietario, quindi chi prenota non vede nessuna
 * schermata di consenso.
 *
 * Installazione: vedi foglio/README.md
 */

var TAB_TURNI = "Turni";
var TAB_PARTITE = "Partite";

// Colonna (1-based) dei refertisti nel tab Turni. Le altre due sono addetti.
// Se nel foglio cambia l'ordine delle colonne, si cambia qui.
var COL_REFERTISTI = "refertisti";
var COL_ADDETTI = "addetti_arbitro";

// Un solo refertista per partita. L'addetto all'arbitro non si prenota da qui:
// lo assegna la dirigenza a mano nel foglio, perche' puo' essere una persona
// esterna al gruppo dei refertisti.
var POSTI_REFERTISTA = 1;

/**
 * Serve le richieste GET: e' la lettura dello stato dei turni.
 *
 * Il sito potrebbe leggere il CSV pubblicato, ma passando di qui si ha la stessa
 * vista che serve per prenotare, senza dipendere dalla cache di Google.
 */
function doGet(e) {
  var azione = (e && e.parameter && e.parameter.azione) || "turni";
  try {
    if (azione === "turni") {
      return risposta({ ok: true, turni: leggiTurni() });
    }
    if (azione === "persone") {
      return risposta({ ok: true, persone: leggiPersone() });
    }
    return risposta({ ok: false, errore: "Azione sconosciuta: " + azione });
  } catch (err) {
    return risposta({ ok: false, errore: String(err && err.message ? err.message : err) });
  }
}

/**
 * Serve le richieste POST: prenotazione e rinuncia.
 *
 * Nota sul CORS: Apps Script non risponde al preflight OPTIONS, quindi il sito
 * deve mandare Content-Type text/plain (non application/json). Il corpo resta
 * JSON, viene solo etichettato come testo per non far scattare il preflight.
 */
function doPost(e) {
  try {
    var corpo = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var azione = corpo.azione;
    var esito;
    if (azione === "prenota") {
      esito = prenota(corpo);
    } else if (azione === "libera") {
      esito = libera(corpo);
    } else {
      return risposta({ ok: false, errore: "Azione sconosciuta: " + azione });
    }
    esito.turni = leggiTurni();
    return risposta(esito);
  } catch (err) {
    return risposta({ ok: false, errore: String(err && err.message ? err.message : err) });
  }
}

/**
 * Risposta JSON con intestazioni permissive.
 *
 * ContentService non permette di impostare Access-Control-Allow-Origin, ma per
 * le richieste "semplici" (text/plain, niente header custom) il browser non ha
 * bisogno del permesso: la risposta si legge lo stesso.
 */
function risposta(oggetto) {
  return ContentService.createTextOutput(JSON.stringify(oggetto)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Legge il foglio su cui lavorare, anche da trigger o da web app.
 */
function apriFoglio() {
  var foglio = SpreadsheetApp.getActiveSpreadsheet();
  if (foglio) {
    PropertiesService.getScriptProperties().setProperty("FOGLIO_ID", foglio.getId());
    return foglio;
  }
  var id = PropertiesService.getScriptProperties().getProperty("FOGLIO_ID");
  if (!id) {
    throw new Error(
      "Foglio non impostato. Apri il foglio e lancia una volta 'Riordina e aggiungi partite'."
    );
  }
  return SpreadsheetApp.openById(id);
}

function impronta(valore) {
  return String(valore == null ? "" : valore)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chiavePartita(data, casa, trasferta) {
  return impronta(data) + "|" + impronta(casa) + "|" + impronta(trasferta);
}

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
 * Divide una cella in nomi. Stessa regola del sito: virgola, punto e virgola o
 * a capo. Cosi' il foglio resta leggibile a mano ("Tonino, Chicca") e la
 * prenotazione non produce un formato diverso da quello scritto a mano.
 */
function normalizzaNome(nome) {
  // I separatori usati da separaNomi non possono comparire dentro un nome:
  // "Rossi, Mario" verrebbe riletto come due persone. Si sostituiscono con uno
  // spazio al momento della scrittura, cosi' il formato resta coerente.
  return String(nome == null ? "" : nome)
    .replace(/[,;\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function separaNomi(cella) {
  return String(cella == null ? "" : cella)
    .split(/[,;\n]/)
    .map(function (n) { return n.trim(); })
    .filter(function (n) { return n !== ""; });
}

/**
 * Indice (0-based) delle colonne che interessano, letto dall'intestazione.
 */
function mappaColonne(intestazione) {
  var mappa = {};
  for (var i = 0; i < intestazione.length; i++) {
    mappa[impronta(intestazione[i])] = i;
  }
  return mappa;
}

/**
 * Restituisce il tab Turni con la sua mappa di colonne, verificando che le
 * colonne indispensabili esistano.
 */
function tabTurni() {
  var foglio = apriFoglio();
  var tab = foglio.getSheetByName(TAB_TURNI);
  if (!tab) throw new Error('Tab "' + TAB_TURNI + '" non trovato.');
  var larghezza = tab.getLastColumn();
  var righe = tab.getLastRow();
  if (righe < 1 || larghezza < 1) throw new Error('Tab "' + TAB_TURNI + '" vuoto.');

  var valori = tab.getRange(1, 1, righe, larghezza).getValues();
  var mappa = mappaColonne(valori[0]);
  ["data", "casa", "trasferta", COL_REFERTISTI, COL_ADDETTI].forEach(function (nome) {
    if (mappa[nome] === undefined) {
      throw new Error(
        'Colonna "' + nome + '" mancante nel tab Turni. Trovate: ' + valori[0].join(", ")
      );
    }
  });
  return { tab: tab, valori: valori, mappa: mappa, larghezza: larghezza };
}

/**
 * Elenco dei turni con i posti liberi. E' quello che la pagina mostra.
 *
 * Ogni voce ha la chiave della partita, i nomi divisi per ruolo e quanti posti
 * restano. Il calcolo dei posti liberi sta qui e non nel sito: cosi' la regola
 * e' una sola e il browser non puo' sbagliarla.
 */
function leggiTurni() {
  var t = tabTurni();
  var iData = t.mappa["data"], iCasa = t.mappa["casa"], iTrasferta = t.mappa["trasferta"];
  var iRef = t.mappa[COL_REFERTISTI], iAdd = t.mappa[COL_ADDETTI];
  var elenco = [];
  for (var r = 1; r < t.valori.length; r++) {
    var riga = t.valori[r];
    var data = dataInTesto(riga[iData]);
    var casa = riga[iCasa];
    var trasferta = riga[iTrasferta];
    if (!data && !casa && !trasferta) continue;
    var refertisti = separaNomi(riga[iRef]);
    var addetti = separaNomi(riga[iAdd]);
    elenco.push({
      chiave: chiavePartita(data, casa, trasferta),
      data: data,
      casa: casa,
      trasferta: trasferta,
      refertisti: refertisti,
      addetti: addetti,
      postiRefertista: Math.max(0, POSTI_REFERTISTA - refertisti.length),
    });
  }
  return elenco;
}

/**
 * Trova la riga fisica del foglio per una chiave di partita.
 */
function trovaRiga(t, chiave) {
  var iData = t.mappa["data"], iCasa = t.mappa["casa"], iTrasferta = t.mappa["trasferta"];
  for (var r = 1; r < t.valori.length; r++) {
    var riga = t.valori[r];
    var k = chiavePartita(dataInTesto(riga[iData]), riga[iCasa], riga[iTrasferta]);
    if (k === chiave) return r;
  }
  return -1;
}

/**
 * Vero se il nome e' gia' in elenco, ignorando maiuscole e accenti. Serve a non
 * registrare due volte la stessa persona per lo stesso ruolo.
 */
function contieneNome(elenco, nome) {
  var target = impronta(nome);
  for (var i = 0; i < elenco.length; i++) {
    if (impronta(elenco[i]) === target) return true;
  }
  return false;
}

/**
 * Prenota un posto.
 *
 * Il controllo sui posti liberi si fa DENTRO il lock: senza, due persone che
 * premono nello stesso secondo leggerebbero entrambe "c'e' posto" e una
 * verrebbe sovrascritta in silenzio.
 */
function prenota(richiesta) {
  var nome = normalizzaNome(richiesta.nome);
  var chiave = String(richiesta.chiave || "").trim();
  if (!nome) return { ok: false, errore: "Nome mancante." };
  if (!chiave) return { ok: false, errore: "Partita mancante." };
  // L'addetto all'arbitro non passa da qui: si assegna a mano nel foglio.
  if (richiesta.ruolo && richiesta.ruolo !== "refertista") {
    return { ok: false, errore: "Da qui si prenota solo il refertista." };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, errore: "Foglio occupato, riprova tra un istante." };
  }
  try {
    var t = tabTurni();
    var r = trovaRiga(t, chiave);
    if (r < 0) return { ok: false, errore: "Partita non trovata nel foglio." };

    var iRef = t.mappa[COL_REFERTISTI];
    var refertisti = separaNomi(t.valori[r][iRef]);

    // Doppio tocco sul telefono: chi e' gia' dentro non si riaggiunge.
    if (contieneNome(refertisti, nome)) {
      return { ok: true, messaggio: "Sei gia' prenotato per questa partita." };
    }

    if (refertisti.length >= POSTI_REFERTISTA) {
      return { ok: false, errore: "Turno gia' preso da " + refertisti.join(", ") + "." };
    }

    refertisti.push(nome);
    t.tab.getRange(r + 1, iRef + 1).setValue(refertisti.join(", "));
    return { ok: true, messaggio: "Turno prenotato." };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Libera un posto. Si puo' lasciare solo il proprio: il nome deve corrispondere.
 */
function libera(richiesta) {
  var nome = normalizzaNome(richiesta.nome);
  var chiave = String(richiesta.chiave || "").trim();
  if (!nome) return { ok: false, errore: "Nome mancante." };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, errore: "Foglio occupato, riprova tra un istante." };
  }
  try {
    var t = tabTurni();
    var r = trovaRiga(t, chiave);
    if (r < 0) return { ok: false, errore: "Partita non trovata nel foglio." };

    var iRef = t.mappa[COL_REFERTISTI];
    var elenco = separaNomi(t.valori[r][iRef]);
    var target = impronta(nome);
    var rimasti = elenco.filter(function (n) { return impronta(n) !== target; });
    if (rimasti.length === elenco.length) {
      return { ok: false, errore: "Non risulti prenotato per questo turno." };
    }
    t.tab.getRange(r + 1, iRef + 1).setValue(rimasti.join(", "));
    return { ok: true, messaggio: "Turno lasciato." };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Elenco delle persone che possono prenotare, letto da un tab dedicato.
 *
 * Sta nel foglio e non nel sito perche' e' un dato che cambia: aggiungere un
 * refertista non deve richiedere un commit. Se il tab manca, la pagina funziona
 * lo stesso con l'elenco scritto nel sito.
 */
function leggiPersone() {
  var foglio = apriFoglio();
  var tab = foglio.getSheetByName("Persone");
  if (!tab || tab.getLastRow() < 2) return [];
  var valori = tab.getRange(1, 1, tab.getLastRow(), Math.max(1, tab.getLastColumn())).getValues();
  var mappa = mappaColonne(valori[0]);
  var iNome = mappa["nome"];
  if (iNome === undefined) return [];
  var nomi = [];
  for (var r = 1; r < valori.length; r++) {
    var n = String(valori[r][iNome] == null ? "" : valori[r][iNome]).trim();
    if (n) nomi.push(n);
  }
  return nomi;
}
