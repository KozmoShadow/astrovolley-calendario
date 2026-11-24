// Pezzi condivisi da tutte le viste del sito: escape dell'HTML, lettura delle
// date, nomi di mesi e giorni, normalizzazione dei nomi.
//
// Stanno qui e non in app.js perche' app.js lo carica solo la home: prenota.js e
// dirigenza.js sono moduli separati e ne avevano copie proprie, gia' divergenti
// (tre escapeHtml, due parseDate, e una normalizzazione delle chiavi che in un
// punto toglieva gli accenti e in un altro no).

// ---------------------------------------------------------------- HTML

const ENTITA = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ENTITA[c]);
}

export const escapeAttr = (s) => (s ? escapeHtml(s) : "");

// ---------------------------------------------------------------- Date

// "2026-11-08 18:00" -> Date locale. Con il formato ISO diretto il browser lo
// leggerebbe come UTC e in Italia la partita slitterebbe di un'ora.
export function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(" ", "T"));
  return isNaN(d) ? null : d;
}

export const fmtTime = (d) => d.toTimeString().slice(0, 5);

const dayFmt = new Intl.DateTimeFormat("it-IT", {
  weekday: "short", day: "2-digit", month: "short", year: "numeric",
});
const shortDayFmt = new Intl.DateTimeFormat("it-IT", {
  weekday: "short", day: "2-digit", month: "short",
});
const longDayFmt = new Intl.DateTimeFormat("it-IT", {
  weekday: "long", day: "numeric", month: "long",
});

export const fmtDay = (d) => dayFmt.format(d);
export const fmtShortDay = (d) => shortDayFmt.format(d);
export const fmtDataLunga = (d) => longDayFmt.format(d);

export const MESI_LUNGHI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

export const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

export const GIORNI = [
  "domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato",
];

// Tre lettere maiuscole, per la barretta del quadratino calendario.
export const MESI_BREVI = ["GEN", "FEB", "MAR", "APR", "MAG", "GIU", "LUG", "AGO", "SET", "OTT", "NOV", "DIC"];

// ---------------------------------------------------------------- Nomi

// Forma canonica di un nome, per confrontare e per costruire le chiavi.
//
// E' l'unica definizione della regola: la usano il sito, la pagina prenota e
// l'area dirigenza. Deve restare identica a impronta() in foglio/prenotazioni.gs
// e a impronta() in scripts/genera_palestre.py, altrimenti le chiavi delle
// prenotazioni non combaciano piu' e i turni si perdono in silenzio.
export function impronta(valore) {
  return String(valore ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// I nomi propri arrivano scritti in modi diversi ("ASD ASTROVOLLEY",
// "Astrovolley Cercola", "MINERVA MEDICA FLYER"): a schermo si mostrano tutti
// con la prima lettera maiuscola. Gli acronimi restano maiuscoli, le
// preposizioni restano minuscole, e dopo apostrofo o virgolette la lettera
// torna maiuscola.
const ACRONIMI = new Set(["ASD", "SSD", "AS", "US", "GS", "PD", "IC", "APD", "SMS", "A", "B", "C", "D"]);
const MINUSCOLE = new Set(["di", "del", "della", "dei", "degli", "delle", "da", "dal", "in", "con",
  "su", "per", "e", "ed", "il", "lo", "la", "i", "gli", "le", "un", "una", "al", "alla", "dello", "dell"]);

// Refusi presenti nei nomi ufficiali FIPAV. Si correggono solo a schermo: i
// dati restano quelli federali, cosi' il confronto con la fonte regge e una
// rigenerazione dell'importer non annulla la correzione.
const REFUSI = [
  [/\bfemmnile\b/gi, "Femminile"],
  // "Femminile- Eccellenza": nei dati il trattino e' attaccato alla parola
  // prima. Si distanzia per leggibilita', senza toccare i trattini interni.
  [/\s*-\s*/g, " - "],
];

export function correggiRefusi(s) {
  return REFUSI.reduce((acc, [re, giusto]) => acc.replace(re, giusto), s || "");
}

export function titolaNome(s) {
  const testo = (s || "").trim();
  if (!testo) return "";
  let n = 0;
  const composto = testo
    .split(/(\s+|[-–/])/)
    .map((pezzo) => {
      if (!pezzo || /^\s+$/.test(pezzo) || /^[-–/]$/.test(pezzo)) return pezzo;
      const primaParola = n === 0;
      n++;
      const apo = pezzo.match(/^([A-Za-zÀ-ÿ]+)(['’])(.*)$/);
      if (apo && !primaParola && MINUSCOLE.has(apo[1].toLowerCase())) {
        return apo[1].toLowerCase() + apo[2] +
          apo[3].toLowerCase().replace(/^([a-zà-ÿ])/, (c) => c.toUpperCase());
      }
      const puro = pezzo.replace(/[().,"'’]/g, "");
      if (ACRONIMI.has(puro.toUpperCase())) return pezzo.toUpperCase();
      if (!primaParola && MINUSCOLE.has(puro.toLowerCase())) return pezzo.toLowerCase();
      return pezzo.toLowerCase().replace(/(^|['’"(\[.])([a-zà-ÿ])/g, (_, p2, c) => p2 + c.toUpperCase());
    })
    .join("");
  return correggiRefusi(composto);
}

export function slugify(s) {
  return impronta(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Una partita si identifica con "data|casa|trasferta", in forma canonica.
// Usata da prenota, dirigenza e dal foglio delle prenotazioni.
export function chiavePartita(data, casa, trasferta) {
  return `${impronta(data)}|${impronta(casa)}|${impronta(trasferta)}`;
}
