// Pagina di prenotazione dei turni.
//
// Due canali, per un motivo preciso:
//
//  - LETTURA dal CSV pubblicato del foglio. Google serve quel CSV con
//    Access-Control-Allow-Origin: *, quindi il browser lo legge senza problemi.
//    La pagina Dirigenza lo fa gia' cosi'.
//
//  - SCRITTURA verso la web app Apps Script, che gira con le autorizzazioni
//    della dirigenza e quindi puo' modificare il foglio. Va chiamata in POST con
//    Content-Type text/plain, perche' Apps Script non risponde al preflight
//    OPTIONS: con application/json il browser bloccherebbe la richiesta.
//
// La lettura non passa dalla web app perche' una GET cross-origin verso
// script.google.com viene bloccata da CORS: verificato, manca l'header.
// Il POST invece passa, perche' text/plain non richiede preflight.

import { URL_BACKEND, URL_CSV } from "./config.js";

const CHIAVE_NOME = "astrovolley.nome";

const $ = (id) => document.getElementById(id);
const mostra = (el) => { if (el) el.hidden = false; };
const nascondi = (el) => { if (el) el.hidden = true; };

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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
  return `${impronta(data)}|${impronta(casa)}|${impronta(trasferta)}`;
}

/** Stessa regola del sito: virgola, punto e virgola o a capo. */
function separaNomi(cella) {
  return String(cella || "")
    .split(/[,;\n]/)
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * Parser CSV minimale ma corretto: gestisce virgolette e virgole dentro i campi.
 * Il foglio puo' contenere "Volley, Pimonte" e uno split su virgola lo
 * spezzerebbe in due colonne, sfasando tutto il resto.
 */
function parseCsv(testo) {
  const righe = [];
  let campo = "";
  let riga = [];
  let dentroVirgolette = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (dentroVirgolette) {
      if (c === '"') {
        if (testo[i + 1] === '"') { campo += '"'; i++; }
        else dentroVirgolette = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { dentroVirgolette = true; continue; }
    if (c === ",") { riga.push(campo); campo = ""; continue; }
    if (c === "\n") { riga.push(campo); righe.push(riga); riga = []; campo = ""; continue; }
    if (c === "\r") continue;
    campo += c;
  }
  if (campo !== "" || riga.length) { riga.push(campo); righe.push(riga); }
  return righe.filter((r) => r.some((x) => String(x).trim() !== ""));
}

function indiceColonne(intestazione) {
  const mappa = {};
  intestazione.forEach((h, i) => { mappa[impronta(h)] = i; });
  return mappa;
}

/**
 * Trasforma il CSV del tab Turni nell'elenco che serve alla pagina.
 *
 * I posti liberi si calcolano qui e non nel foglio: sono una regola di
 * presentazione, e il foglio non ha modo di esprimerla.
 */
function turniDaCsv(testo, postiRefertista, postiAddetto) {
  const righe = parseCsv(testo);
  if (!righe.length) return [];
  const mappa = indiceColonne(righe[0]);
  const iData = mappa["data"], iCasa = mappa["casa"], iTrasferta = mappa["trasferta"];
  const iRef = mappa["refertisti"], iAdd = mappa["addetti_arbitro"];
  if ([iData, iCasa, iTrasferta].some((i) => i === undefined)) return [];

  const elenco = [];
  for (let r = 1; r < righe.length; r++) {
    const riga = righe[r];
    const data = String(riga[iData] || "").trim();
    const casa = String(riga[iCasa] || "").trim();
    const trasferta = String(riga[iTrasferta] || "").trim();
    if (!data || !casa) continue;
    const refertisti = iRef === undefined ? [] : separaNomi(riga[iRef]);
    const addetti = iAdd === undefined ? [] : separaNomi(riga[iAdd]);
    elenco.push({
      chiave: chiavePartita(data, casa, trasferta),
      data, casa, trasferta, refertisti, addetti,
      postiRefertista: Math.max(0, postiRefertista - refertisti.length),
      postiAddetto: Math.max(0, postiAddetto - addetti.length),
    });
  }
  return elenco;
}

/** Legge il foglio. cache-buster perche' Google tiene 5 minuti di cache. */
async function caricaTurni() {
  if (!URL_CSV) throw new Error("Indirizzo del foglio mancante in config.js.");
  const url = `${URL_CSV}${URL_CSV.includes("?") ? "&" : "?"}_=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Il foglio non risponde (" + res.status + ").");
  const testo = await res.text();
  return turniDaCsv(testo, POSTI_REFERTISTA, POSTI_ADDETTO);
}

// Quanti posti per ruolo. Devono combaciare con POSTI_* in foglio/prenotazioni.gs,
// che e' chi decide davvero: qui servono solo per mostrare "posti liberi".
const POSTI_REFERTISTA = 2;
const POSTI_ADDETTO = 1;

async function chiama(azione, corpo) {
  if (!URL_BACKEND) {
    throw new Error(
      "Prenotazioni non ancora attive: manca l'indirizzo della web app in config.js."
    );
  }
  // text/plain evita il preflight OPTIONS, che Apps Script non gestisce.
  const res = await fetch(URL_BACKEND, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ azione, ...corpo }),
    redirect: "follow",
  });
  const testo = await res.text();
  let dati;
  try { dati = JSON.parse(testo); }
  catch { throw new Error("Risposta non valida dal foglio. Riprova."); }
  if (!dati.ok) throw new Error(dati.errore || "Operazione non riuscita.");
  return dati;
}

function dataLeggibile(testo) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(testo || "");
  if (!m) return testo || "";
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
  const giorni = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
  const mesi = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  return `${giorni[d.getDay()]} ${d.getDate()} ${mesi[d.getMonth()]} · ${m[4]}:${m[5]}`;
}

function meseDi(testo) {
  const m = /^(\d{4})-(\d{2})/.exec(testo || "");
  return m ? `${m[1]}-${m[2]}` : "";
}

function nomeMese(chiave) {
  const mesi = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
  const m = /^(\d{4})-(\d{2})$/.exec(chiave || "");
  return m ? `${mesi[+m[2] - 1]} ${m[1]}` : chiave;
}

function messaggioBanner(testo, tipo = "errore") {
  const b = $("prn-banner");
  if (!testo) return nascondi(b);
  b.textContent = testo;
  b.className = `prn-banner prn-banner-${tipo}`;
  mostra(b);
}

function ruoloDi(turno, nome) {
  const n = impronta(nome);
  if ((turno.refertisti || []).some((x) => impronta(x) === n)) return "refertista";
  if ((turno.addetti || []).some((x) => impronta(x) === n)) return "addetto";
  return null;
}

function nomiHtml(nomi, vuoto) {
  if (!nomi || !nomi.length) return `<span class="prn-vuoto">${escapeHtml(vuoto)}</span>`;
  return nomi.map((n) => `<span class="prn-persona">${escapeHtml(n)}</span>`).join("");
}

function turnoHtml(turno, nome) {
  const mio = ruoloDi(turno, nome);
  const liberoRef = turno.postiRefertista > 0;
  const liberoAdd = turno.postiAddetto > 0;
  const classi = ["prn-turno"];
  if (mio) classi.push("prn-turno-mio");
  else if (!liberoRef && !liberoAdd) classi.push("prn-turno-pieno");

  const azioni = [];
  if (mio === "refertista") {
    azioni.push(`<button class="prn-btn prn-btn-ghost" data-azione="libera" data-ruolo="refertista" data-chiave="${escapeHtml(turno.chiave)}" type="button">Lascia</button>`);
  } else if (!mio && liberoRef) {
    azioni.push(`<button class="prn-btn prn-btn-primary" data-azione="prenota" data-ruolo="refertista" data-chiave="${escapeHtml(turno.chiave)}" type="button">Prenota come refertista</button>`);
  }
  if (mio === "addetto") {
    azioni.push(`<button class="prn-btn prn-btn-ghost" data-azione="libera" data-ruolo="addetto" data-chiave="${escapeHtml(turno.chiave)}" type="button">Lascia</button>`);
  } else if (!mio && liberoAdd) {
    azioni.push(`<button class="prn-btn prn-btn-outline" data-azione="prenota" data-ruolo="addetto" data-chiave="${escapeHtml(turno.chiave)}" type="button">Prenota come addetto</button>`);
  }

  return `
    <article class="${classi.join(" ")}">
      <div class="prn-turno-top">
        <span class="prn-turno-data">${escapeHtml(dataLeggibile(turno.data))}</span>
        ${mio ? `<span class="prn-badge">tuo · ${escapeHtml(mio)}</span>` : ""}
      </div>
      <p class="prn-turno-partita">
        <strong>${escapeHtml(turno.casa)}</strong> – ${escapeHtml(turno.trasferta)}
      </p>
      <div class="prn-ruoli">
        <div class="prn-ruolo">
          <span class="prn-ruolo-tit">Refertista</span>
          <span class="prn-ruolo-nomi">${nomiHtml(turno.refertisti, "da assegnare")}</span>
        </div>
        <div class="prn-ruolo">
          <span class="prn-ruolo-tit">Addetto arbitro</span>
          <span class="prn-ruolo-nomi">${nomiHtml(turno.addetti, "da assegnare")}</span>
        </div>
      </div>
      ${azioni.length ? `<div class="prn-azioni">${azioni.join("")}</div>` : ""}
    </article>`;
}

function render(turni, nome) {
  const futuri = turni
    .filter((t) => t.data)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  nascondi($("prn-loading"));

  if (!futuri.length) {
    nascondi($("prn-turni"));
    const e = $("prn-empty");
    e.textContent = "Nessun turno disponibile al momento.";
    mostra(e);
    return;
  }

  const perMese = new Map();
  futuri.forEach((t) => {
    const k = meseDi(t.data);
    if (!perMese.has(k)) perMese.set(k, []);
    perMese.get(k).push(t);
  });

  let html = "";
  for (const [k, lista] of perMese) {
    const liberi = lista.filter((t) => ruoloDi(t, nome) || t.postiRefertista > 0 || t.postiAddetto > 0).length;
    html += `
      <section class="prn-mese">
        <h3 class="prn-mese-tit">${escapeHtml(nomeMese(k))}
          <span class="prn-mese-conta">${lista.length} partite${liberi ? ` · ${liberi} con posti` : ""}</span>
        </h3>
        ${lista.map((t) => turnoHtml(t, nome)).join("")}
      </section>`;
  }
  $("prn-lista").innerHTML = html;
  $("prn-sub").textContent = `${futuri.length} partite in casa, da ${nomeMese(meseDi(futuri[0].data))}.`;
  mostra($("prn-turni"));
  nascondi($("prn-empty"));
}

/**
 * Rilegge il foglio e ridisegna.
 *
 * Non azzera il banner: dopo una prenotazione il messaggio di conferma deve
 * restare visibile. Chi vuole toglierlo lo fa passando `pulisci: true`.
 */
async function aggiorna(nome, opzioni = {}) {
  try {
    if (opzioni.pulisci) messaggioBanner("");
    const turni = await caricaTurni();
    render(turni, nome);
  } catch (err) {
    nascondi($("prn-loading"));
    messaggioBanner(err.message, "errore");
  }
}

function impostaNome(nome) {
  localStorage.setItem(CHIAVE_NOME, nome);
  messaggioBanner("");
  $("prn-io-nome").textContent = nome;
  mostra($("prn-io"));
  nascondi($("prn-identita"));
  aggiorna(nome);
}

/**
 * Scelta del nome. L'elenco viene dal foglio (tab "Persone"); se il foglio non
 * lo ha, si scrive a mano. In entrambi i casi resta una scelta una volta sola.
 */
function chiediNome(persone) {
  nascondi($("prn-loading"));
  nascondi($("prn-turni"));
  mostra($("prn-identita"));
  $("prn-nomi").innerHTML = (persone || [])
    .map((n) => `<button class="prn-nome" data-nome="${escapeHtml(n)}" type="button">${escapeHtml(n)}</button>`)
    .join("");
}

/**
 * I nomi si leggono dal CSV del tab Turni stesso: chi e' gia' stato assegnato
 * almeno una volta compare li'. Cosi' non serve un tab in piu' ne' una seconda
 * chiamata, e l'elenco resta sempre allineato alla realta'.
 */
function personeDaTurni(turni) {
  const visti = new Set();
  const nomi = [];
  turni.forEach((t) => {
    [...(t.refertisti || []), ...(t.addetti || [])].forEach((n) => {
      const k = impronta(n);
      if (k && !visti.has(k)) { visti.add(k); nomi.push(n); }
    });
  });
  return nomi.sort((a, b) => a.localeCompare(b, "it"));
}

async function avvia() {
  const salvato = localStorage.getItem(CHIAVE_NOME);
  if (salvato) {
    impostaNome(salvato);
    return;
  }
  try {
    const turni = await caricaTurni();
    chiediNome(personeDaTurni(turni));
  } catch (err) {
    nascondi($("prn-loading"));
    messaggioBanner(err.message, "errore");
    chiediNome([]);
  }
}

function bind() {
  document.addEventListener("click", async (ev) => {
    const scelta = ev.target.closest("[data-nome]");
    if (scelta) { impostaNome(scelta.dataset.nome); return; }

    const bottone = ev.target.closest("[data-azione]");
    if (!bottone) return;
    const nome = localStorage.getItem(CHIAVE_NOME);
    if (!nome) return chiediNome([]);

    bottone.disabled = true;
    const originale = bottone.textContent;
    bottone.textContent = "…";
    try {
      const esito = await chiama(bottone.dataset.azione, {
        nome,
        chiave: bottone.dataset.chiave,
        ruolo: bottone.dataset.ruolo,
      });
      messaggioBanner(esito.messaggio || "Fatto.", "ok");
      // Rilegge dal foglio invece di fidarsi della risposta: cosi' si vede lo
      // stato vero, anche se qualcun altro ha prenotato nello stesso momento.
      await aggiorna(nome);
    } catch (err) {
      messaggioBanner(err.message, "errore");
      bottone.disabled = false;
      bottone.textContent = originale;
    }
  });

  $("prn-cambia").addEventListener("click", () => {
    localStorage.removeItem(CHIAVE_NOME);
    nascondi($("prn-io"));
    nascondi($("prn-turni"));
    messaggioBanner("");
    avvia();
  });

  $("prn-form-nome").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const valore = $("prn-nome-libero").value.trim().replace(/\s+/g, " ");
    if (!valore) return;
    impostaNome(valore);
  });
}

bind();
avvia();
