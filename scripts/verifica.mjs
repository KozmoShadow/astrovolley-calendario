// Controlli che non richiedono browser ne' dipendenze: si lanciano con
//
//     node scripts/verifica.mjs
//
// Servono a fermare la classe di errore piu' insidiosa di questo sito: le
// chiavi delle partite. Se due implementazioni della stessa normalizzazione
// divergono, la pagina non da' errore, semplicemente smette di trovare i dati.
// E' gia' successo: le chiavi delle palestre venivano scritte senza togliere gli
// accenti e lette togliendoli, e 30 partite perdevano la palestra in silenzio.

import { impronta, chiavePartita, titolaNome } from "../site/comune.js";
import { PALESTRE } from "../site/prenota/palestre.js";

let falliti = 0;

function verifica(nome, esito, dettaglio = "") {
  if (esito) {
    console.log(`ok   ${nome}`);
  } else {
    falliti++;
    console.log(`FAIL ${nome}${dettaglio ? "\n     " + dettaglio : ""}`);
  }
}

// ---------------------------------------------------------------- normalizzazione

const CASI = [
  ["ASD PARCO CITTÀ", "asd parco citta"],
  ["  ASD   ASTROVOLLEY  ", "asd astrovolley"],
  ["L'IMPRONTA ANDROMEDA", "l'impronta andromeda"],
  ["Perché È Così", "perche e cosi"],
  ["Ünder 19", "under 19"],
  ["", ""],
  [null, ""],
];

const sbagliati = CASI.filter(([ingresso, atteso]) => impronta(ingresso) !== atteso);
verifica(
  "impronta() toglie accenti, spazi doppi e maiuscole",
  sbagliati.length === 0,
  sbagliati.map(([i, a]) => `${JSON.stringify(i)} -> ${JSON.stringify(impronta(i))}, atteso ${JSON.stringify(a)}`).join("\n     ")
);

// Le tre copie della regola devono restare allineate: JS (sito), Python
// (scripts/genera_palestre.py) e Apps Script (foglio/prenotazioni.gs). Qui si
// controlla che i sorgenti contengano ancora la stessa catena di operazioni.
const fs = await import("node:fs/promises");
const python = await fs.readFile(new URL("../scripts/genera_palestre.py", import.meta.url), "utf8");
const gs = await fs.readFile(new URL("../foglio/prenotazioni.gs", import.meta.url), "utf8");
verifica(
  "Python e Apps Script normalizzano gli accenti come il sito",
  /unicodedata\.normalize\("NFD"/.test(python) && /category\(c\) != "Mn"/.test(python)
    && /normalize\("NFD"\)/.test(gs) && /u0300-\\u036f/.test(gs),
  "una delle copie ha perso la rimozione degli accenti"
);

// ---------------------------------------------------------------- chiavi palestre

const irraggiungibili = Object.keys(PALESTRE).filter((k) => {
  const [data, casa, trasferta] = k.split("|");
  return !PALESTRE[chiavePartita(data, casa, trasferta)];
});
verifica(
  `ogni chiave di palestre.js e' raggiungibile da chiavePartita() (${Object.keys(PALESTRE).length} chiavi)`,
  irraggiungibili.length === 0,
  irraggiungibili.slice(0, 5).map((k) => `${k} -> cercata come ${chiavePartita(...k.split("|"))}`).join("\n     ")
);

// Una palestra non deve restare appesa a una chiave che nessuno cerca: se
// succede, il generatore e il sito non concordano.
const chiaviGrezze = Object.keys(PALESTRE).filter((k) => k !== chiavePartita(...k.split("|")));
verifica(
  "palestre.js contiene solo chiavi gia' normalizzate",
  chiaviGrezze.length === 0,
  chiaviGrezze.slice(0, 5).join(", ")
);

// ---------------------------------------------------------------- nomi a schermo

const NOMI = [
  ["ASD ASTROVOLLEY", "ASD Astrovolley"],
  ["FLAT SPORT", "Flat Sport"],
  ["MINERVA MEDICA FLYER", "Minerva Medica Flyer"],
  ["L'IMPRONTA ANDROMEDA", "L'Impronta Andromeda"],
  ["UNDER 19 FEMMNILE- ECCELLENZA 2 - GIRONE B", "Under 19 Femminile - Eccellenza 2 - Girone B"],
];
const nomiSbagliati = NOMI.filter(([ingresso, atteso]) => titolaNome(ingresso) !== atteso);
verifica(
  "titolaNome() rende leggibili i nomi scritti in maiuscolo",
  nomiSbagliati.length === 0,
  nomiSbagliati.map(([i, a]) => `${JSON.stringify(i)} -> ${JSON.stringify(titolaNome(i))}, atteso ${JSON.stringify(a)}`).join("\n     ")
);

console.log(falliti ? `\n${falliti} controlli falliti` : "\ntutti i controlli superati");
process.exit(falliti ? 1 : 0);
