// Regole di scrittura dei nomi, condivise fra la home e la pagina prenota.
//
// Stanno qui e non in app.js perche' servono anche a prenota.js: due copie
// divergerebbero e lo stesso nome comparirebbe scritto in due modi.

// Confronto fra nomi: maiuscole, accenti e spazi non contano. Serve perche'
// FIPAV e ASI scrivono lo stesso nome in modi diversi ("ASD ASTROVOLLEY").
export function normName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// I nomi arrivano scritti in modi diversi ("ASD ASTROVOLLEY", "Astrovolley
// Cercola", "MINERVA MEDICA FLYER"): in card si mostrano tutti con la prima
// lettera maiuscola. Gli acronimi restano maiuscoli, le preposizioni restano
// minuscole, e dopo apostrofo o virgolette la lettera torna maiuscola.
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
  return normName(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
