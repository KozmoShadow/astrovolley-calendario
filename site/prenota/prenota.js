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
import { NOMI_REFERTISTI } from "./nomi.js";
import { PALESTRE } from "./palestre.js";

const CHIAVE_NOME = "astrovolley.nome";

// Ultimo nome usato in questa sessione. Serve a capire se chi sta scegliendo ora
// ha appena cambiato persona: in quel caso i turni presi restano al nome vecchio
// e va detto, altrimenti sembrano spariti.
let nomePrecedente = null;

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
function turniDaCsv(testo, postiRefertista) {
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
    });
  }
  return elenco;
}

/**
 * Legge i turni.
 *
 * Prima dal backend, che legge il foglio in quel momento. Il CSV pubblicato
 * arriva da istantanee che Google tiene separate: due letture ravvicinate
 * possono cadere su istantanee diverse e far ballare la pagina tra "sei
 * prenotato" e "non sei prenotato". Il backend non ha questo problema.
 * Il CSV resta come riserva, per quando la web app non risponde.
 */
async function caricaTurni() {
  if (URL_BACKEND) {
    try {
      return await turniDaBackend();
    } catch (err) {
      if (!URL_CSV) throw err;
    }
  }
  return turniDaCsvPubblicato();
}

async function turniDaBackend() {
  const url = `${URL_BACKEND}?azione=turni&_=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Il backend non risponde (" + res.status + ").");
  const dati = await res.json();
  if (!dati || !dati.ok || !Array.isArray(dati.turni)) {
    throw new Error((dati && dati.errore) || "Il backend ha risposto in modo strano.");
  }
  return dati.turni.map((t) => ({
    chiave: t.chiave || chiavePartita(t.data, t.casa, t.trasferta),
    data: t.data,
    casa: t.casa,
    trasferta: t.trasferta,
    refertisti: (t.refertisti || []).filter(Boolean),
    addetti: (t.addetti || []).filter(Boolean),
    postiRefertista: Math.max(0, POSTI_REFERTISTA - (t.refertisti || []).length),
  }));
}

async function turniDaCsvPubblicato() {
  if (!URL_CSV) throw new Error("Indirizzo del foglio mancante in config.js.");
  const url = `${URL_CSV}${URL_CSV.includes("?") ? "&" : "?"}_=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Il foglio non risponde (" + res.status + ").");
  const testo = await res.text();
  return turniDaCsv(testo, POSTI_REFERTISTA);
}

// Un solo refertista per partita. Deve combaciare con POSTI_REFERTISTA in
// foglio/prenotazioni.gs, che e' chi decide davvero: qui serve solo a mostrare
// "posti liberi". L'addetto all'arbitro lo assegna la dirigenza a mano.
const POSTI_REFERTISTA = 1;

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

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/**
 * Spezza "YYYY-MM-DD HH:MM" nei pezzi che servono alla scheda: numero del
 * giorno, mese, giorno della settimana, ora. Mezzogiorno forzato: con la
 * mezzanotte un fuso a ovest mostrerebbe il giorno prima.
 */
function dataParti(testo) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(testo || "");
  if (!m) return { g: "", mese: "", sett: "", ora: "", iso: testo || "" };
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
  return {
    g: String(d.getDate()),
    mese: MESI[d.getMonth()],
    sett: GIORNI[d.getDay()],
    ora: `${m[4]}:${m[5]}`,
    iso: `${m[1]}-${m[2]}-${m[3]}`,
  };
}

function meseDi(testo) {
  const m = /^(\d{4})-(\d{2})/.exec(testo || "");
  return m ? `${m[1]}-${m[2]}` : "";
}

function nomeMese(chiave) {
  const m = /^(\d{4})-(\d{2})$/.exec(chiave || "");
  return m ? `${MESI[+m[2] - 1]} ${m[1]}` : chiave;
}

/**
 * Tinta stabile per persona: stessa persona, stesso colore, sempre. Senza
 * questa, ogni ridisegno cambierebbe i colori e la pagina sembrerebbe impazzita.
 */
function tinta(nome) {
  let h = 0;
  const s = impronta(nome);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 52% 38%)`;
}

function iniziali(nome) {
  const parti = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!parti.length) return "?";
  if (parti.length === 1) return parti[0].slice(0, 2).toUpperCase();
  return (parti[0][0] + parti[parti.length - 1][0]).toUpperCase();
}

function avatar(nome, classe = "") {
  return `<span class="prn-av ${classe}" style="background:${tinta(nome)}" title="${escapeHtml(nome)}">${escapeHtml(iniziali(nome))}</span>`;
}

function messaggioBanner(testo, tipo = "errore") {
  const b = $("prn-banner");
  if (!testo) return nascondi(b);
  b.textContent = testo;
  b.className = `prn-banner prn-banner-${tipo}`;
  mostra(b);
}

/**
 * Mese aperto nell'elenco. Vuoto = si vedono le card dei mesi.
 * Vive fuori dal DOM perche' ogni prenotazione ridisegna tutto: senza questa
 * variabile si tornerebbe sempre all'elenco dopo aver toccato "Ci sono".
 */
let meseAperto = "";

/** Ultimi turni letti: servono a ridisegnare cambiando mese, senza rifetch. */
let turniCorrenti = [];

/**
 * Prenotazioni fatte da questo telefono che il CSV non mostra ancora.
 *
 * Il backend scrive il foglio subito, ma il CSV pubblicato da Google si
 * allinea con minuti di ritardo. Rileggendo solo il CSV, la scheda tornava
 * vuota dopo la prenotazione: il messaggio diceva "prenotato" e la partita
 * sembrava libera. Qui si tiene il dato finche' il foglio non lo conferma.
 */
const modificheLocali = new Map();
const DURATA_MODIFICA = 10 * 60 * 1000;

/** Vero se il turno e' prenotato a questo nome. L'addetto non si prenota qui. */
function eMio(turno, nome) {
  const n = impronta(nome);
  return (turno.refertisti || []).some((x) => impronta(x) === n);
}

function schedaHtml(turno, nome) {
  const mio = eMio(turno, nome);
  const occupato = (turno.refertisti || []).length > 0;
  const d = dataParti(turno.data);

  const classi = ["prn-turno"];
  if (mio) classi.push("prn-turno-mio");
  else if (occupato) classi.push("prn-turno-pieno");

  // Un solo posto: o l'avatar di chi c'e', o il cerchio tratteggiato vuoto.
  const stack = occupato
    ? avatar(turno.refertisti[0], "sm")
    : `<span class="prn-slot"></span>`;

  const palestra = PALESTRE[turno.chiave] || "";

  let bottone;
  if (mio) {
    bottone = `<button class="prn-btn prn-btn-on" data-azione="libera" data-chiave="${escapeHtml(turno.chiave)}" type="button">Ci sono ✓</button>`;
  } else if (occupato) {
    bottone = `<button class="prn-btn" type="button" disabled title="Turno gia' preso da ${escapeHtml(turno.refertisti.join(", "))}">Occupato</button>`;
  } else {
    bottone = `<button class="prn-btn" data-azione="prenota" data-chiave="${escapeHtml(turno.chiave)}" type="button">Ci sono</button>`;
  }

  return `
    <article class="${classi.join(" ")}">
      <div class="prn-data">
        <span class="d">${escapeHtml(d.g)}</span>
        <span class="m">${escapeHtml(d.mese.slice(0, 3))}</span>
        <span class="w">${escapeHtml(d.sett.slice(0, 3))}</span>
      </div>
      <div class="prn-info">
        <h3>${escapeHtml(turno.casa)} – ${escapeHtml(turno.trasferta)}</h3>
        <div class="prn-meta">
          <span>${escapeHtml(d.sett)} ${escapeHtml(d.g)} ${escapeHtml(d.mese)} · ${escapeHtml(d.ora)}</span>
          ${palestra ? `<span class="dot">·</span>
          <span class="prn-palestra">${escapeHtml(palestra)}</span>` : ""}
        </div>
      </div>
      <div class="prn-side">
        <div class="prn-stack">${stack}</div>
        ${bottone}
      </div>
    </article>`;
}

/** Sovrappone al CSV le prenotazioni locali non ancora pubblicate. */
function applicaModifiche(turni) {
  const adesso = Date.now();
  for (const [chiave, m] of modificheLocali) {
    const t = turni.find((x) => x.chiave === chiave);
    // Scaduta, oppure la partita non c'e' piu': la memoria non serve.
    if (adesso - m.quando > DURATA_MODIFICA || !t) {
      modificheLocali.delete(chiave);
      continue;
    }
    const nelFoglio = (n) => t.refertisti.some((x) => impronta(x) === impronta(n));
    // Il foglio ha gia' lo stato voluto: da qui in poi comanda lui.
    const allineato = m.refertisti.length
      ? m.refertisti.every(nelFoglio)
      : t.refertisti.length === 0;
    if (allineato) {
      modificheLocali.delete(chiave);
      continue;
    }
    t.refertisti = m.refertisti.slice();
    t.postiRefertista = Math.max(0, POSTI_REFERTISTA - t.refertisti.length);
  }
  return turni;
}

/** Ricorda l'esito di una prenotazione, per non mostrarla annullata. */
function ricordaModifica(azione, chiave, nome) {
  const t = turniCorrenti.find((x) => x.chiave === chiave);
  if (!t) return;
  const altri = (t.refertisti || []).filter((x) => impronta(x) !== impronta(nome));
  modificheLocali.set(chiave, {
    refertisti: azione === "libera" ? altri : [...altri, nome],
    quando: Date.now(),
  });
}

/**
 * Card di un mese nell'elenco. Il colore del bordo dice se resta qualcosa da
 * prendere: e' l'informazione che serve per capire dove andare, senza aprire.
 */
function cardMese(chiave, lista, nome) {
  const liberi = lista.filter((t) => eMio(t, nome) || t.postiRefertista > 0).length;
  const primo = dataParti(lista[0].data);
  const stato = liberi === 0 ? "pieno" : liberi === lista.length ? "libero" : "parziale";
  const testo = liberi === 0 ? "tutto preso" : liberi === 1 ? "1 posto libero" : `${liberi} posti liberi`;
  return `
    <button class="prn-mese-card prn-mese-${stato}" type="button" data-mese="${escapeHtml(chiave)}">
      <span class="prn-mese-nome">${escapeHtml(nomeMese(chiave))}</span>
      <span class="prn-mese-n">${lista.length === 1 ? "1 partita" : `${lista.length} partite`}</span>
      <span class="prn-mese-prima">prima: ${escapeHtml(primo.sett)} ${escapeHtml(primo.g)} · ${escapeHtml(primo.ora)}</span>
      <span class="prn-mese-stato">${escapeHtml(testo)}</span>
    </button>`;
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

  // Se il mese aperto non esiste piu' (foglio cambiato) si torna all'elenco.
  if (meseAperto && !perMese.has(meseAperto)) meseAperto = "";

  if (!meseAperto) {
    $("prn-lista").innerHTML = `<div class="prn-mesi">${[...perMese.entries()]
      .map(([k, lista]) => cardMese(k, lista, nome))
      .join("")}</div>`;
    $("prn-sub").textContent =
      `${futuri.length} partite in casa, da ${nomeMese(meseDi(futuri[0].data))}. Scegli il mese.`;
  } else {
    const lista = perMese.get(meseAperto);
    const liberi = lista.filter((t) => eMio(t, nome) || t.postiRefertista > 0).length;
    $("prn-lista").innerHTML = `
      <button class="prn-indietro" type="button" data-mesi-tutti>← tutti i mesi</button>
      <section class="prn-mese">
        <h3 class="prn-mese-tit">${escapeHtml(nomeMese(meseAperto))}
          <span class="prn-mese-conta">${lista.length === 1 ? "1 partita" : `${lista.length} partite`}${liberi ? ` · ${liberi} con posti` : ""}</span>
        </h3>
        ${lista.map((t) => schedaHtml(t, nome)).join("")}
      </section>`;
    $("prn-sub").textContent = `${nomeMese(meseAperto)}: ${lista.length === 1 ? "1 partita" : `${lista.length} partite`}, ${liberi} con posti.`;
  }
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
    const turni = applicaModifiche(await caricaTurni());
    turniCorrenti = turni;
    render(turni, nome);
  } catch (err) {
    nascondi($("prn-loading"));
    messaggioBanner(err.message, "errore");
  }
}

function impostaNome(nome) {
  const precedente = localStorage.getItem(CHIAVE_NOME) || nomePrecedente;
  localStorage.setItem(CHIAVE_NOME, nome);
  nomePrecedente = null;
  messaggioBanner("");
  const nota = $("prn-io-nota");
  if (nota) nota.hidden = !(precedente && precedente !== nome);
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
    .map((n) => `<button class="prn-nome" data-nome="${escapeHtml(n)}" type="button">${avatar(n)}${escapeHtml(n)}</button>`)
    .join("");
}

/**
 * Elenco dei nomi da proporre.
 *
 * Quello fisso di nomi.js ha la precedenza: e' l'unico modo per far comparire
 * chi non ha ancora mai prenotato. Se non e' compilato si ripiega sui nomi gia'
 * presenti nei turni del foglio, cosi' la pagina resta usabile.
 */
function personeDaProporre(turni) {
  if (NOMI_REFERTISTI && NOMI_REFERTISTI.length) {
    return NOMI_REFERTISTI.slice().sort((a, b) => a.localeCompare(b, "it"));
  }
  const visti = new Set();
  const nomi = [];
  turni.forEach((t) => {
    (t.refertisti || []).forEach((n) => {
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
    chiediNome(personeDaProporre(turni));
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

    const card = ev.target.closest("[data-mese]");
    if (card) {
      meseAperto = card.dataset.mese;
      render(turniCorrenti, localStorage.getItem(CHIAVE_NOME) || "");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (ev.target.closest("[data-mesi-tutti]")) {
      meseAperto = "";
      render(turniCorrenti, localStorage.getItem(CHIAVE_NOME) || "");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

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
      });
      messaggioBanner(esito.messaggio || "Fatto.", "ok");
      ricordaModifica(bottone.dataset.azione, bottone.dataset.chiave, nome);
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
    // Il nome va ricordato prima di cancellarlo: e' quello che permette alla
    // nota di dire "i turni sono rimasti a X".
    nomePrecedente = localStorage.getItem(CHIAVE_NOME);
    localStorage.removeItem(CHIAVE_NOME);
    nascondi($("prn-io"));
    nascondi($("prn-turni"));
    nascondi($("prn-io-nota"));
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
