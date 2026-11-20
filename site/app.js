import { fetchLiveFipav, fetchLiveFipavMobile } from "./fipav-live.js";
import { fetchLiveAsi } from "./asi-live.js";

const OUR_PATTERN = "astro";
const DATA_URL = "data/schedule.json";
const SQUADRE_URL = "data/squadre.json";

const state = {
  data: null,
  competitions: [],
  squadre: [], // configurazione delle squadre (data/squadre.json)
  view: "ours", // "ours" | "week"
  team: "", // "" = tutte le nostre squadre, altrimenti lo slug di una squadra
  panel: "", // id del campionato aperto nel pannello ("" = chiuso)
  round: null, // giornata selezionata nel pannello
  live: false, // true se almeno una fonte e' stata letta dal vivo adesso
  liveFonti: {}, // fonte -> true se letta dal vivo, false se da snapshot
  liveError: null,
  rows: [], // partite attualmente mostrate nella lista (per la scheda dettagli)
  panelRows: [], // partite mostrate nella giornata del pannello (indici separati)
};

const $ = (sel) => document.querySelector(sel);

const dayFmt = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  return isNaN(d) ? null : d;
}

const fmtDay = (d) => dayFmt.format(d);
const shortDayFmt = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "2-digit", month: "short" });
const fmtShortDay = (d) => shortDayFmt.format(d);
const fmtTime = (d) => d.toTimeString().slice(0, 5);
// Mese in tre lettere per la barretta del quadratino calendario.
const MESI = ["GEN", "FEB", "MAR", "APR", "MAG", "GIU", "LUG", "AGO", "SET", "OTT", "NOV", "DIC"];
const isOurs = (name) => (name || "").toLowerCase().includes(OUR_PATTERN);
const matchIsOurs = (m) => isOurs(m.casa) || isOurs(m.trasferta);

// Esito dal punto di vista dell'Astrovolley: vale anche giocando in trasferta.
function esitoOf(m, parts) {
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return "";
  const nostri = isOurs(m.casa) ? a : b;
  const loro = isOurs(m.casa) ? b : a;
  return nostri > loro ? "esito-win" : "esito-loss";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

const escapeAttr = (s) => (s ? escapeHtml(s) : "");

// Il sito FIPAV blocca l'hotlink dei loghi: al browser serve un placeholder
// identico per tutti. I loghi veri vengono scaricati dall'importer in
// assets/loghi/fipav/, gia' ridimensionati: qui riscriviamo gli URL FIPAV
// verso quei file locali.
function logoUrl(url) {
  // I loghi FIPAV si servono in locale: il portale blocca l'hotlink e le
  // miniature sono da 50px. Il file scaricato dall'importer si chiama con
  // l'id societa' (es. 5690.webp) ed e' gia' ottimizzato.
  const m = /\/img\/(\d+)\/Loghi\//i.exec(url || "");
  if (m) return `assets/loghi/fipav/${m[1]}.webp`;
  // Gli altri percorsi (locali ASI, o URL remoti di riserva) passano invariati.
  return url || "";
}

// Link a Google Maps per le indicazioni: si preferisce quello fornito da FIPAV
// (che ha le coordinate esatte), altrimenti si cerca palestra + indirizzo.
function mapsUrl(m) {
  if (m.mappa) return m.mappa;
  const q = [m.palestra, m.indirizzo].filter(Boolean).join(", ") || m.impianto || "";
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
}

function allMatches() {
  const rows = [];
  for (const comp of state.competitions) {
    for (const m of comp.matches) rows.push({ ...m, _comp: comp });
  }
  return rows;
}

// Confronto fra nomi: maiuscole, accenti e spazi non contano. Serve perche'
// FIPAV e ASI scrivono lo stesso nome in modi diversi ("ASD ASTROVOLLEY").
function normName(s) {
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
const ACRONIMI = new Set(["ASD", "SSD", "AS", "US", "GS", "PD", "IC", "APD", "A", "B", "C", "D"]);
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

function correggiRefusi(s) {
  return REFUSI.reduce((acc, [re, giusto]) => acc.replace(re, giusto), s || "");
}

function titolaNome(s) {
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

function slugify(s) {
  return normName(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function teamConfig(slug) {
  return (state.squadre || []).find((t) => t.slug === slug) || null;
}

// Una partita appartiene a una squadra se una delle due squadre in campo ha un
// nome elencato in configurazione. Se la squadra dichiara un campionato, la
// partita deve stare in un campionato con quel testo nel titolo: cosi' due
// squadre omonime in campionati diversi restano distinte.
function matchBelongsToTeam(m, cfg) {
  if (!cfg) return false;
  const casa = normName(m.casa);
  const trasferta = normName(m.trasferta);
  const nomi = (cfg.nomi || []).map(normName);
  if (!nomi.includes(casa) && !nomi.includes(trasferta)) return false;
  if (!cfg.campionato) return true;
  const titolo = normName(m._comp?.titolo || m.campionato || "");
  return titolo.includes(normName(cfg.campionato));
}

// Le squadre del club, prese da data/squadre.json. Una squadra compare solo se
// ha almeno una partita nei calendari, cosi' il filtro non mostra voci vuote.
// I nomi che contengono "astro" ma non sono in configurazione restano
// selezionabili lo stesso: meglio un'etichetta in piu' che una squadra che
// sparisce dal filtro senza che nessuno se ne accorga.
function ourTeams() {
  const rows = allMatches();
  const out = [];
  const coperti = new Set();

  for (const cfg of state.squadre || []) {
    const partite = rows.filter((m) => matchBelongsToTeam(m, cfg));
    if (!partite.length) continue;
    (cfg.nomi || []).forEach((n) => coperti.add(normName(n)));
    out.push({
      slug: cfg.slug,
      nome: cfg.nome || cfg.slug,
      partite: partite.length,
      comp: competitionLabelOf(partite),
    });
  }

  const extra = new Map();
  for (const m of rows) {
    for (const name of [m.casa, m.trasferta]) {
      if (!isOurs(name) || coperti.has(normName(name))) continue;
      extra.set(name, (extra.get(name) || 0) + 1);
    }
  }
  for (const [nome, partite] of extra) {
    out.push({
      slug: uniqueSlug(`auto-${slugify(nome)}`, out),
      nome,
      partite,
      comp: competitionLabelOf(rows.filter((m) => m.casa === nome || m.trasferta === nome)),
      auto: true,
    });
  }

  return out.sort((a, b) => a.nome.localeCompare(b.nome, "it"));
}

// Due nomi diversi possono ridursi allo stesso slug ("ASD ASTROVOLLEY" e
// "ASD Astrovolley"): senza un suffisso il link non distinguerebbe le due.
function uniqueSlug(base, usati) {
  const presi = new Set(usati.map((t) => t.slug));
  if (!presi.has(base)) return base;
  let i = 2;
  while (presi.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function competitionLabelOf(rows) {
  const titoli = [...new Set(rows.map((m) => m._comp?.titolo).filter(Boolean))];
  return titoli.join(" · ");
}

// Una squadra "automatica" (nome non in configurazione) si filtra per nome
// esatto; le altre passano dalla configurazione.
function teamMatcher(slug) {
  const cfg = teamConfig(slug);
  if (cfg) return (m) => matchBelongsToTeam(m, cfg);
  const t = ourTeams().find((x) => x.slug === slug);
  if (!t) return () => false;
  const nome = normName(t.nome);
  return (m) => normName(m.casa) === nome || normName(m.trasferta) === nome;
}

function teamName(slug) {
  if (!slug) return "";
  const t = ourTeams().find((x) => x.slug === slug);
  return t ? t.nome : "";
}

// Alias storico: il campionato di una squadra ora e' dentro ourTeams().
function teamCompetition(slug) {
  return ourTeams().find((t) => t.slug === slug)?.comp || "";
}

// "Questa settimana" = da oggi a domenica prossima (7 giorni).
function weekRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

function inWeek(m, range) {
  const d = parseDate(m.data);
  return d && d >= range.start && d < range.end;
}

// Senza filtri la lista mostra tutte le nostre partite, o solo quelle della
// squadra aperta.
function visibleMatches() {
  let rows = allMatches().filter(matchIsOurs);
  if (state.team) rows = rows.filter(teamMatcher(state.team));
  return rows.sort((a, b) => (a.data || "").localeCompare(b.data || ""));
}

// Apre una squadra e ridisegna la pagina. Non ci sono piu' filtri: la pagina
// mostra sempre tutto quello che riguarda la squadra scelta.
function applyView(view, team, opts = {}) {
  state.team = team || "";
  renderTeamHead();
  renderStandings();
  renderChampionship();
  renderList();
  if (!opts.fromUrl) syncUrl();
}

function isPanelOpen() {
  return true;
}

// L'indirizzo rispecchia filtri e pannello aperto, cosi' il link si puo'
// copiare e incollare (es. nei gruppi delle squadre) e riapre la stessa vista.
// I cambi fatti dall'utente finiscono nella cronologia: il tasto Indietro
// annulla il filtro invece di uscire dal sito.
function syncUrl(opts = {}) {
  if (!window.history?.pushState) return;
  const params = new URLSearchParams();
  if (state.team) params.set("squadra", state.team);
  if (state.panel) params.set("campionato", state.panel);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (opts.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

// All'apertura i filtri arrivano dall'indirizzo. Uno slug o un campionato
// sconosciuto non devono rompere la pagina: si apre il calendario normale.
function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  const team = (params.get("squadra") || "").trim();
  const vista = (params.get("vista") || "").trim();
  const campionato = (params.get("campionato") || "").trim();

  state.team = team && ourTeams().some((t) => t.slug === team) ? team : "";
  // I vecchi link usavano ?vista=<id campionato> per aprire un campionato:
  // ora il campionato e' un pannello, quindi si accetta anche quella forma.
  const legacy = vista && vista !== "week" && vista !== "ours" ? vista : "";
  const scelto = campionato || legacy;
  state.panel = state.competitions.some((c) => c.id === scelto) ? scelto : "";
  state.round = null;
  return Boolean(state.team || state.panel);
}

// Blocchetto calendario per il pannello Campionato: mese e anno nella barretta,
// giorno in grande, ora sotto. L'anno sta nella barretta perche' la stagione
// scavalca il 31 dicembre: senza, "11/11" e "11/01" sarebbero indistinguibili.

function matchCard(m, idx) {
  const d = parseDate(m.data);
  const ours = matchIsOurs(m);
  const time = d ? fmtTime(d) : "--:--";
  const quando = `<div class="match-time">${time}</div>`;
  const parts = (m.risultato || "").split(/\s*[-–]\s*/);
  const hasScore = parts.length === 2;
  const annullata = (m.stato || "") === "cancelled";
  const result = annullata
    ? `<span class="annullata">annullata</span>`
    : m.risultato
      ? `<span class="result">${escapeHtml(m.risultato)}</span>`
      : `<span class="vs">vs</span>`;
  const scoreCasa = hasScore ? `<span class="team-score score-casa">${escapeHtml(parts[0])}</span>` : "";
  const scoreOspite = hasScore ? `<span class="team-score score-ospite">${escapeHtml(parts[1])}</span>` : "";
  const esito = hasScore && ours ? esitoOf(m, parts) : "";
  const metaParts = [];
  if (m.campionato) metaParts.push(escapeHtml(titolaNome(m.campionato)));
  const fonte = (m._comp.fonte || "manuale").toLowerCase();
  const ente = (m._comp.fonte || "manuale").toUpperCase();
  return `
      <article class="match ${ours ? "is-ours" : ""} ${esito} ${annullata ? "is-cancelled" : ""}" data-idx="${idx}" tabindex="0" role="button"
               aria-label="Dettagli partita${annullata ? " (annullata)" : ""}">
        ${quando}
        <div class="match-body">
          <div class="teams ${hasScore ? "is-played" : "is-upcoming"}">
            <span class="team-name name-casa ${isOurs(m.casa) ? "ours" : ""}">${escapeHtml(titolaNome(m.casa) || "—")}</span>
            ${scoreCasa}
            ${result}
            <span class="team-name name-ospite ${isOurs(m.trasferta) ? "ours" : ""}">${escapeHtml(titolaNome(m.trasferta) || "—")}</span>
            ${scoreOspite}
          </div>
          <div class="meta">${metaParts.join(" · ")}</div>
        </div>
        <span class="badge ${fonte}">${ours ? '<span class="badge-star" aria-hidden="true">★</span>' : ""}${escapeHtml(ente)}</span>
      </article>`;
}

// Card della giornata: due squadre ai lati e il calendarietto al centro, come
// nel riferimento. Il resto delle informazioni sta sotto, in una riga sola.
function roundMatchCard(m, idx) {
  const d = parseDate(m.data);
  const ours = matchIsOurs(m);
  const annullata = (m.stato || "") === "cancelled";
  const parts = (m.risultato || "").split(/\s*[-–]\s*/);
  const hasScore = parts.length === 2;
  const esito = hasScore && ours ? esitoOf(m, parts) : "";
  const fonte = (m._comp.fonte || "manuale").toLowerCase();
  const ente = (m._comp.fonte || "manuale").toUpperCase();

  // Quadratino calendario come nella sezione Campionato del sito: mese e anno
  // nella barretta, giorno in grande, ora sotto. La stagione scavalca il 31
  // dicembre, quindi l'anno sta nella barretta.
  const quando = d
    ? `<div class="cal">
         <span class="m" aria-hidden="true">${MESI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}</span>
         <span class="g" aria-hidden="true">${String(d.getDate()).padStart(2, "0")}</span>
         <span class="t" aria-hidden="true">${fmtTime(d)}</span>
         <span class="sr-only">${escapeHtml(fmtDay(d))}, ore ${fmtTime(d)}</span>
       </div>`
    : `<div class="cal"><span class="m">—</span><span class="g">--</span><span class="t">--:--</span></div>`;

  const logoCasa = logoUrl(m.logo_casa);
  const logoTrasf = logoUrl(m.logo_trasferta);
  const logo = (url, nome) =>
    url
      ? `<img class="rm-logo" src="${escapeAttr(url)}" alt="" width="26" height="26" loading="lazy" onerror="this.remove()" />`
      : "";

  const risultato = annullata
    ? `<span class="annullata">annullata</span>`
    : hasScore
      ? `<span class="rm-score">${escapeHtml(m.risultato)}</span>`
      : "";

  return `
    <article class="round-match ${ours ? "is-ours" : ""} ${esito} ${annullata ? "is-cancelled" : ""}"
             data-idx="${idx}" tabindex="0" role="button"
             aria-label="Dettagli partita${annullata ? " (annullata)" : ""}">
      <div class="rm-side rm-casa">
        ${logo(logoCasa, m.casa)}
        <span class="rm-team ${isOurs(m.casa) ? "ours" : ""}">${escapeHtml(titolaNome(m.casa) || "—")}</span>
      </div>
      <div class="rm-center">
        ${quando}
        ${risultato}
      </div>
      <div class="rm-side rm-ospite">
        <span class="rm-team ${isOurs(m.trasferta) ? "ours" : ""}">${escapeHtml(titolaNome(m.trasferta) || "—")}</span>
        ${logo(logoTrasf, m.trasferta)}
      </div>
      <span class="rm-foot">
        <span class="badge ${fonte}">${ours ? '<span class="badge-star" aria-hidden="true">★</span>' : ""}${escapeHtml(ente)}</span>
      </span>
    </article>`;
}

// Raggruppa le partite per data. L'indice resta quello di `rows`, per la
// scheda dettagli.
function groupRows(rows) {
  const groups = [];
  const index = new Map();
  rows.forEach((m, idx) => {
    const d = parseDate(m.data);
    const key = d ? `d${d.toDateString()}` : "nd";
    let g = index.get(key);
    if (!g) {
      g = { key, label: d ? fmtDay(d) : "Data da definire", items: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.items.push({ m, idx });
  });
  return groups;
}

function renderList() {
  const box = $("#calendar");
  if (!box) return;
  const rows = visibleMatches();

  if (!rows.length) {
    box.innerHTML = `<p class="empty">Nessuna partita in calendario.</p>`;
    return;
  }

  box.innerHTML = groupRows(rows)
    .map(
      (g) =>
        `<div class="day-label">${escapeHtml(g.label)}</div>` +
        g.items.map(({ m, idx }) => matchCard(m, idx)).join("")
    )
    .join("");
  state.rows = rows;
  box.querySelectorAll(".match").forEach((el) =>
    el.addEventListener("click", () => openMatchModal(state.rows[Number(el.dataset.idx)]))
  );
}

function openMatchModal(m) {
  if (!m) return;
  const d = parseDate(m.data);
  const quando = d ? `${fmtDay(d)} · ore ${fmtTime(d)}` : "Data da definire";
  const riga = (label, val) =>
    val ? `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${escapeHtml(val)}</span></div>` : "";
  const parziali = (m.parziali || "").trim();
  const setChips = parziali
    ? `<div class="set-chips">${parziali
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => `<span class="set-chip">${escapeHtml(s)}</span>`)
        .join("")}</div>`
    : "";
  // Il logo si puo' cliccare per vederlo grande: l'immagine originale e'
  // spesso molto piu' definita di quanto mostrato a 46px.
  const logoImg = (url, nome) =>
    url
      ? `<img src="${escapeAttr(logoUrl(url))}" alt="Logo ${escapeAttr(titolaNome(nome))}" loading="lazy"
           class="logo-zoom" role="button" tabindex="0"
           data-logo="${escapeAttr(logoUrl(url))}" data-nome="${escapeAttr(titolaNome(nome))}" />`
      : "";
  const logoCasa = logoImg(m.logo_casa, m.casa);
  const logoTrasf = logoImg(m.logo_trasferta, m.trasferta);
  const indirizzo = (m.indirizzo || "").trim();
  const maps = mapsUrl(m);
  const rigaMappa =
    indirizzo && maps
      ? `<div class="detail-row"><span class="detail-label">Indirizzo</span><span class="detail-value"><a class="maps-link" href="${escapeAttr(
          maps
        )}" target="_blank" rel="noopener">${escapeHtml(indirizzo)}</a></span></div>`
      : indirizzo
      ? `<div class="detail-row"><span class="detail-label">Indirizzo</span><span class="detail-value">${escapeHtml(
          indirizzo
        )}</span></div>`
      : "";
  const fonte = (m._comp.fonte || "manuale").toLowerCase();
  const ente = (m._comp.fonte || "manuale").toUpperCase();
  $("#modal-content").innerHTML = `
    <p class="modal-kicker">${escapeHtml(titolaNome(m._comp.titolo || m.campionato || ""))}${
      m.giornata ? ` · Giornata ${escapeHtml(String(m.giornata))}` : ""
    }</p>
    <div class="detail-score">
      <div class="detail-team">
        ${logoCasa}
        <span class="detail-team-name ${isOurs(m.casa) ? "ours" : ""}">${escapeHtml(titolaNome(m.casa) || "—")}</span>
      </div>
      <div class="detail-result">${
        (m.stato || "") === "cancelled"
          ? `<span class="annullata">annullata</span>`
          : m.risultato
            ? escapeHtml(m.risultato)
            : "vs"
      }</div>
      <div class="detail-team">
        ${logoTrasf}
        <span class="detail-team-name ${isOurs(m.trasferta) ? "ours" : ""}">${escapeHtml(titolaNome(m.trasferta) || "—")}</span>
      </div>
    </div>
    ${setChips}
    <div class="detail-list">
      ${riga("Data", quando)}
      ${riga("Campionato", titolaNome(m.campionato || m.girone))}
      ${riga("Girone", m.girone && m.girone !== m.campionato ? titolaNome(m.girone) : "")}
      ${riga("Palestra", titolaNome(m.palestra))}
      ${rigaMappa}
      ${riga("Fonte", m._comp.fonte === "fipav" ? "FIPAV (ufficiale)" : m._comp.fonte)}
    </div>
    <span class="badge ${fonte} modal-badge">${escapeHtml(ente)}</span>
  `;
  openModal();
}

function openModal() {
  const modal = $("#match-modal");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modal.querySelector(".modal-close").focus();
}

function closeModal() {
  const modal = $("#match-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

// ------------------------------------------------------- ingrandimento logo
// Un logo da 46px nella scheda e' troppo piccolo per riconoscere lo stemma:
// qui lo si mostra alla sua risoluzione reale, senza ingrandirlo oltre.

function openLogo(nome, src) {
  const box = $("#logo-lightbox");
  if (!box || !src) return;
  const img = $("#lightbox-img");
  const nota = $("#lightbox-note");
  nota.textContent = "";
  img.style.maxWidth = "";
  img.style.maxHeight = "";
  img.onload = () => {
    const { naturalWidth: w, naturalHeight: h } = img;
    // Mai oltre la risoluzione del file (ingrandire un 50px lo rende solo
    // sgranato), ma nemmeno oltre lo schermo: min() tiene entrambi i limiti.
    img.style.maxWidth = `min(${w}px, 88vw)`;
    img.style.maxHeight = `min(${h}px, 74vh)`;
    const minore = Math.min(w, h);
    nota.textContent = minore < 200 ? `originale ${w}×${h} px, non ingrandito` : "";
  };
  img.src = src;
  img.alt = nome ? `Logo ${nome}` : "Logo squadra";
  $("#lightbox-name").textContent = nome || "";
  const link = $("#lightbox-link");
  link.href = src;
  box.hidden = false;
  document.body.classList.add("lightbox-open");
  box.querySelector(".lightbox-close").focus();
}

function closeLogo() {
  const box = $("#logo-lightbox");
  if (!box || box.hidden) return;
  box.hidden = true;
  document.body.classList.remove("lightbox-open");
  $("#lightbox-img").removeAttribute("src");
  // Il focus torna al logo da cui si e' partiti, se e' ancora nella pagina.
  const logo = document.querySelector(".modal-card .logo-zoom");
  if (logo) logo.focus();
}

// ---------------------------------------------------- pannello Campionato
// Il campionato non e' piu' una vista che sostituisce la lista: la lista resta
// sempre cronologica e il campionato si apre in un pannello, come la classifica.

function competitionForTeam(slug) {
  if (!slug) return null;
  const match = teamMatcher(slug);
  return state.competitions.find((c) => (c.matches || []).some(match)) || null;
}

function panelCompetition() {
  return state.competitions.find((c) => c.id === state.panel) || null;
}

// Le giornate del campionato in ordine, ognuna con le sue partite. Le gare
// senza numero di giornata restano fuori dal carosello ma non si perdono:
// finiscono in coda, in un gruppo a parte.
function roundsOf(comp) {
  const byRound = new Map();
  const senza = [];
  // comp.matches non passa da allMatches(): _comp va agganciato qui, altrimenti
  // la scheda non sa da quale campionato arriva la partita.
  for (const m of (comp.matches || []).map((m) => ({ ...m, _comp: comp }))) {
    const n = Number(m.giornata);
    if (!m.giornata || !Number.isFinite(n)) {
      senza.push(m);
      continue;
    }
    if (!byRound.has(n)) byRound.set(n, []);
    byRound.get(n).push(m);
  }
  const rounds = [...byRound.keys()]
    .sort((a, b) => a - b)
    .map((n) => ({
      n,
      matches: byRound.get(n).sort((a, b) => (a.data || "").localeCompare(b.data || "")),
    }));
  return { rounds, senza };
}

// All'apertura conviene la giornata della prossima partita da giocare: e' quella
// che interessa a chi apre la pagina. Non basta "la prima giornata con una gara
// senza risultato", perche' un rinvio in una giornata vecchia la farebbe
// sembrare la piu' attuale. Se il campionato e' finito, si apre l'ultima.
function defaultRound(rounds) {
  const soglia = Date.now() - 6 * 3600 * 1000;
  let migliore = null;
  for (const r of rounds) {
    for (const m of r.matches) {
      if (m.risultato) continue;
      const d = parseDate(m.data);
      if (!d || d.getTime() < soglia) continue;
      if (!migliore || d < migliore.data) migliore = { n: r.n, data: d };
    }
  }
  if (migliore) return migliore.n;
  const ultima = rounds[rounds.length - 1];
  return ultima ? ultima.n : null;
}

function renderChampionship() {
  const box = $("#campionato");
  const comp = panelCompetition() || competitionForTeam(state.team);
  if (!box || !comp) return;

  const { rounds, senza } = roundsOf(comp);
  if (!rounds.length && !senza.length) {
    box.innerHTML = `<p class="empty">Nessuna partita in questo campionato.</p>`;
    return;
  }

  if (state.round === null && rounds.length) state.round = defaultRound(rounds);
  const pos = Math.max(0, rounds.findIndex((r) => r.n === state.round));

  if (!rounds.length) {
    // Campionato senza giornate numerate: niente carosello, solo le partite.
    state.panelRows = senza.slice().sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    box.innerHTML = `<div id="round-matches" class="round-matches"></div>`;
    renderRoundList($("#round-matches"), state.panelRows);
    return;
  }

  // Ogni giornata e' una slide: la striscia si trascina di lato e le card
  // seguono il dito, invece di saltare alla giornata dopo.
  state.roundRows = new Map(
    rounds.map((r) => [r.n, r.matches.slice().sort((a, b) => (a.data || "").localeCompare(b.data || ""))])
  );

  const slides = rounds
    .map(
      (r) => `<div class="round-slide" data-round="${r.n}" role="group"
                   aria-label="Giornata ${escapeHtml(String(r.n))}">
                <div class="round-matches"></div>
              </div>`
    )
    .join("");

  box.innerHTML = `
    <div class="round-nav">
      <button class="arrow-btn" id="round-prev" aria-label="Giornata precedente" ${
        pos <= 0 ? "disabled" : ""
      }>&lsaquo;</button>
      <div class="round-pill" id="round-pill" aria-live="polite">Giornata ${escapeHtml(
        String(rounds[pos].n)
      )}</div>
      <button class="arrow-btn" id="round-next" aria-label="Giornata successiva" ${
        pos >= rounds.length - 1 ? "disabled" : ""
      }>&rsaquo;</button>
    </div>
    <p class="swipe-hint">Scorri per cambiare giornata</p>
    <div class="dots" aria-hidden="true">${rounds
      .map((r, i) => `<span class="dot ${i === pos ? "active" : ""}"></span>`)
      .join("")}</div>
    <div class="round-viewport" id="round-viewport" tabindex="0"
         aria-label="Giornate del campionato">
      <div class="round-track" id="round-track"
           style="transform: translateX(${-pos * 100}%)">${slides}</div>
    </div>`;

  const track = $("#round-track");
  const viewport = $("#round-viewport");
  const els = [...track.children];

  els.forEach((slide) => {
    const rows = state.roundRows.get(Number(slide.dataset.round)) || [];
    renderRoundList(slide.querySelector(".round-matches"), rows);
  });

  // Altezza = quella della giornata visibile, altrimenti la striscia
  // prenderebbe l'altezza della giornata piu' lunga e lascerebbe un buco.
  const adattaAltezza = (indice) => {
    if (!viewport || !els[indice]) return;
    viewport.style.height = `${els[indice].offsetHeight}px`;
  };
  adattaAltezza(pos);
  window.addEventListener("resize", () => adattaAltezza(indiceCorrente()), { passive: true });

  const indiceCorrente = () => Math.max(0, els.findIndex((e) => Number(e.dataset.round) === state.round));

  const vaiA = (indice, anima = true) => {
    const i = Math.max(0, Math.min(els.length - 1, indice));
    const n = Number(els[i].dataset.round);
    state.round = n;
    track.style.transition = anima ? "transform .34s cubic-bezier(.22,.61,.36,1)" : "none";
    track.style.transform = `translateX(${-i * 100}%)`;
    adattaAltezza(i);
    const pill = $("#round-pill");
    if (pill) pill.textContent = `Giornata ${n}`;
    box.querySelectorAll(".dot").forEach((d, k) => d.classList.toggle("active", k === i));
    const prev = $("#round-prev");
    const next = $("#round-next");
    if (prev) prev.disabled = i <= 0;
    if (next) next.disabled = i >= els.length - 1;
  };

  $("#round-prev")?.addEventListener("click", () => vaiA(indiceCorrente() - 1));
  $("#round-next")?.addEventListener("click", () => vaiA(indiceCorrente() + 1));

  setupRoundSwipe({ viewport, track, els, indiceCorrente, vaiA, adattaAltezza });
}

// Riempe un contenitore con le card della giornata; l'indice resta quello
// della riga nella giornata, per la scheda dettagli.
function renderRoundList(list, rows) {
  if (!list) return;
  list.innerHTML = rows.length
    ? rows.map((m, i) => roundMatchCard(m, i)).join("")
    : `<p class="empty">Nessuna partita in questa giornata.</p>`;
  list.querySelectorAll(".round-match").forEach((el) =>
    el.addEventListener("click", () => openMatchModal(rows[Number(el.dataset.idx)]))
  );
}
// Trascinamento della striscia delle giornate: le card seguono il dito (o il
// mouse) e, al rilascio, la giornata si aggancia a quella piu' vicina. Se il
// gesto e' piu' verticale che orizzontale si lascia scorrere la pagina.
function setupRoundSwipe({ viewport, track, els, indiceCorrente, vaiA }) {
  if (!viewport || !track || !els.length) return;

  let partenza = null;
  let indiceBase = 0;
  let larghezza = 0;

  const applica = (dx, anima) => {
    track.style.transition = anima ? "transform .34s cubic-bezier(.22,.61,.36,1)" : "none";
    track.style.transform = `translateX(calc(${-indiceBase * 100}% + ${dx}px))`;
  };

  const inizio = (x, y) => {
    indiceBase = indiceCorrente();
    larghezza = viewport.clientWidth || 1;
    partenza = { x, y, asse: null };
    track.style.transition = "none";
  };

  const muovi = (x, y) => {
    if (!partenza) return;
    const dx = x - partenza.x;
    const dy = y - partenza.y;
    if (!partenza.asse) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      partenza.asse = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (partenza.asse !== "x") return;
    // Resistenza ai bordi: agli estremi la striscia si muove meno.
    const aiBordo =
      (indiceBase === 0 && dx > 0) || (indiceBase === els.length - 1 && dx < 0);
    applica(aiBordo ? dx * 0.28 : dx, false);
  };

  const fine = (x, y) => {
    if (!partenza) return;
    const dx = x - partenza.x;
    const asse = partenza.asse;
    partenza = null;
    if (asse !== "x") return;
    // Un quinto di schermo, o un colpo deciso, basta per cambiare giornata.
    const soglia = Math.max(48, larghezza * 0.2);
    const verso = dx < 0 ? 1 : -1;
    if (Math.abs(dx) > soglia) vaiA(indiceBase + verso);
    else vaiA(indiceBase);
  };

  viewport.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    inizio(t.clientX, t.clientY);
  }, { passive: true });

  viewport.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    muovi(t.clientX, t.clientY);
    // Blocca lo scroll della pagina solo quando il gesto e' orizzontale.
    if (partenza && partenza.asse === "x" && e.cancelable) e.preventDefault();
  }, { passive: false });

  viewport.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    fine(t.clientX, t.clientY);
  }, { passive: true });

  viewport.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    inizio(e.clientX, e.clientY);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    muovi(e.clientX, e.clientY);
  });
  viewport.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") return;
    fine(e.clientX, e.clientY);
  });
  viewport.addEventListener("pointercancel", () => {
    partenza = null;
    track.style.transition = "transform .34s cubic-bezier(.22,.61,.36,1)";
    track.style.transform = `translateX(${-indiceCorrente() * 100}%)`;
  });
}

// Non c'e' piu' un pannello da aprire: la giornata e' sempre visibile.
// Resta questa funzione per scegliere il campionato giusto all'apertura.
function togglePanel(open) {
  if (!state.panel) {
    const comp = competitionForTeam(state.team) || state.competitions[0];
    state.panel = comp ? comp.id : "";
    state.round = null;
  }
  if (open !== false) renderChampionship();
  syncUrl();
}

// Testata della pagina squadra: titolo, campionato e stagione come scritte
// statiche nei riquadri (niente menu a tendina).
// Il titolo della pagina e' sempre "Classifica": la squadra si riconosce dal
// logo del club e dalla riga evidenziata in tabella. Sotto stanno campionato
// e stagione.
function renderTeamHead() {
  const titolo = $("#team-title");
  if (titolo) titolo.textContent = "Classifica";
  const comp = $("#team-comp");
  if (comp) comp.textContent = titolaNome(teamCompetition(state.team) || "");
  const stag = $("#team-season");
  if (stag) stag.textContent = state.data?.stagione || "—";
}

function renderStandings() {
  const box = $("#standings");
  if (!box) return;
  // Il campionato della squadra aperta; senza squadra, quello scelto o il primo.
  const comp = competitionForTeam(state.team) || panelCompetition() || state.competitions[0] || null;
  if (!comp) {
    box.innerHTML = `<p class="empty">Nessuna classifica disponibile.</p>`;
    return;
  }
  state.panel = comp.id;

  const rows = comp.standings || [];
  const sub = $("#standings-sub");
  if (sub) sub.textContent = giornataLabel(comp, rows);

  if (!rows.length) {
    box.innerHTML = `<p class="empty">Nessuna classifica disponibile al momento.</p>`;
    return;
  }

  // Sigle compatte come nel riferimento: PG, V, P, Punti. Il resto (set e
  // punti fatti/subiti) resta nella scheda della singola partita.
  const head = `<div class="table-head" role="row">
      <span>Pos</span><span>Squadra</span>
      <span>PG</span><span>V</span><span>P</span><span>Punti</span>
    </div>`;

  const body = rows
    .map((s, i) => {
      const ours = isHighlighted(s.squadra, comp);
      const logo = logoUrl(logoInComp(comp, s.squadra));
      return `<div class="team-row ${ours ? "highlight" : ""}" role="row">
        <span class="pos">${i + 1}</span>
        <span class="team-cell">
          ${logo ? `<img class="row-logo" src="${escapeAttr(logo)}" alt="" width="22" height="22" loading="lazy" onerror="this.remove()" />` : ""}
          <span class="row-name">${escapeHtml(titolaNome(s.squadra))}</span>
          ${ours ? `<span class="row-badge" aria-label="La nostra squadra">★</span>` : ""}
        </span>
        <span class="num">${s.pg}</span>
        <span class="num">${s.pv}</span>
        <span class="num">${s.pp}</span>
        <span class="num punti">${s.punti}</span>
      </div>`;
    })
    .join("");

  box.innerHTML = head + body;
}

// La riga da evidenziare in classifica. Con una squadra aperta conta solo
// quella: in Promozionale giocano Cercola e Portici, e senza questo controllo
// si accenderebbero entrambe le righe.
function isHighlighted(nome, comp) {
  if (state.team) {
    const cfg = teamConfig(state.team);
    if (cfg) {
      const cercato = normName(nome);
      if (!(cfg.nomi || []).map(normName).includes(cercato)) return false;
      const titolo = normName(comp?.titolo || "");
      return !cfg.campionato || titolo.includes(normName(cfg.campionato));
    }
  }
  return isOurs(nome);
}

// Logo di una squadra qualsiasi del campionato (non solo delle nostre): si
// guardano le partite del girone e si prende il lato in cui compare.
function logoInComp(comp, nome) {
  const cercato = normName(nome);
  for (const m of comp.matches || []) {
    if (normName(m.casa) === cercato && m.logo_casa) return m.logo_casa;
    if (normName(m.trasferta) === cercato && m.logo_trasferta) return m.logo_trasferta;
  }
  return "";
}

// "Giornata 6 · aggiornata dopo l'ultimo turno", come nel riferimento. Se il
// campionato non ha giornate numerate si ripiega sul numero di partite.
function giornataLabel(comp, rows) {
  const { rounds } = roundsOf(comp);
  if (!rounds.length) return `${rows.length} squadre`;
  // L'ultima giornata con almeno un risultato e' quella "giocata".
  let ultima = null;
  for (const r of rounds) {
    if (r.matches.some((m) => m.risultato)) ultima = r.n;
  }
  if (ultima === null) return `Giornata 1 · in attesa dei primi risultati`;
  return `Giornata ${ultima} · aggiornata dopo l'ultimo turno`;
}

function renderHeader() {
  $("#societa").textContent = state.data.societa || "Calendario";
  $("#stagione").textContent = state.data.stagione || "—";
  // `generato_il` e' in UTC con il fuso (+00:00): va passato intero, altrimenti
  // il browser lo legge come ora locale e in Italia il dato sembra vecchio di
  // un'ora appena scritto.
  const gen = parseDate(state.data.generato_il || "");
  $("#updated").innerHTML = updatedHtml(gen);
  if (gen) {
    $("#updated").title = `Ultimo aggiornamento automatico: ${fmtDay(gen)} ${fmtTime(gen)}`;
  }
  document.title = `${state.data.societa || "Calendario"} — Calendario e Classifiche`;
}

// Riga di stato: un bollino per fonte, verde se i dati sono letti dal vivo,
// rosso se si sta usando lo snapshot salvato. Le fonti che non hanno
// competizioni in questo calendario non compaiono.
function updatedHtml(gen) {
  const fonti = new Set(state.competitions.map((c) => (c.fonte || "manuale").toLowerCase()));
  const voci = [];
  for (const [fonte, nome] of [["fipav", "FIPAV"], ["asi", "ASI"]]) {
    if (!fonti.has(fonte)) continue;
    const live = !!state.liveFonti[fonte];
    voci.push(
      `<span class="fonte ${live ? "is-live" : "is-offline"}">${nome} ${live ? "in diretta" : "da archivio"}</span>`
    );
  }
  if (!voci.length) return gen ? `Dati aggiornati ${fmtRelative(gen)}` : "Aggiornamento automatico in corso";
  const quando = gen ? ` · aggiornati ${fmtRelative(gen)}` : "";
  return `${voci.join(" ")}${quando}`;
}

// Tempo relativo in italiano, per rendere evidente quanto sono freschi i dati.
function fmtRelative(d) {
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "adesso";
  if (min === 1) return "1 minuto fa";
  if (min < 60) return `${min} minuti fa`;
  const ore = Math.round(min / 60);
  if (ore === 1) return "1 ora fa";
  if (ore < 24) return `${ore} ore fa`;
  const gg = Math.round(ore / 24);
  return gg === 1 ? "ieri" : `${gg} giorni fa`;
}

// Sostituisce le competizioni FIPAV con quelle lette dal vivo, tenendo
// invariate le competizioni non-FIPAV (es. ASI da data/manual.json).
function mergeLive(liveComps) {
  // I loghi non sono nella pagina mobile: si recuperano dallo snapshot
  // abbinando la partita per campionato + giornata + squadre.
  const loghiSnapshot = new Map();
  for (const c of state.competitions) {
    for (const m of c.matches || []) {
      const key = `${c.campionato_id}|${m.giornata}|${m.casa}|${m.trasferta}`;
      if (m.logo_casa || m.logo_trasferta) loghiSnapshot.set(key, m);
    }
  }
  const nonFipav = state.competitions.filter((c) => (c.fonte || "").toLowerCase() !== "fipav");
  const fipav = liveComps.map((comp) => ({
    id: comp.campionato_id ? `fipav-${comp.campionato_id}` : `fipav-${comp.titolo}`,
    titolo: comp.titolo,
    fonte: "fipav",
    categoria: "FIPAV",
    campionato_id: comp.campionato_id,
    matches: comp.matches.map((m) => {
      const old = loghiSnapshot.get(`${comp.campionato_id}|${m.giornata}|${m.casa}|${m.trasferta}`);
      return {
        ...m,
        fonte: "fipav",
        campionato_id: comp.campionato_id,
        campionato: comp.titolo,
        girone: comp.titolo,
        logo_casa: m.logo_casa || (old ? old.logo_casa : ""),
        logo_trasferta: m.logo_trasferta || (old ? old.logo_trasferta : ""),
        indirizzo: m.indirizzo || (old ? old.indirizzo : ""),
        mappa: m.mappa || (old ? old.mappa : ""),
      };
    }),
    standings: comp.standings || [],
  }));
  state.competitions = fipav.concat(nonFipav);
}

// Sostituisce le competizioni ASI con quelle lette dal vivo. I loghi dello
// snapshot vincono su quelli dell'API: sono file locali (assets/loghi) che il
// sito serve da solo, piu' leggeri e indipendenti dal portale. L'URL remoto
// resta solo come riserva per una squadra nuova, che non ha ancora il file.
function mergeLiveAsi(liveComps) {
  const loghi = new Map();
  for (const c of state.competitions) {
    if ((c.fonte || "").toLowerCase() !== "asi") continue;
    for (const m of c.matches || []) {
      if (m.logo_casa || m.logo_trasferta) {
        loghi.set(`${m.casa}|${m.trasferta}`, m);
      }
    }
  }
  const altri = state.competitions.filter((c) => (c.fonte || "").toLowerCase() !== "asi");
  const asi = liveComps.map((comp) => ({
    id: comp.id,
    titolo: comp.titolo,
    fonte: "asi",
    categoria: "ASI",
    comitato: (state.competitions.find((c) => c.id === comp.id) || {}).comitato || "",
    matches: comp.matches.map((m) => {
      const old = loghi.get(`${m.casa}|${m.trasferta}`);
      return {
        ...m,
        fonte: "asi",
        campionato_id: comp.id,
        campionato: comp.titolo,
        girone: comp.titolo,
        logo_casa: (old && old.logo_casa) || m.logo_casa || "",
        logo_trasferta: (old && old.logo_trasferta) || m.logo_trasferta || "",
      };
    }),
    standings: comp.standings || [],
  }));
  state.competitions = altri.concat(asi);
}

/* ---------------------------------------------------------------------------
   Landing: una card per squadra.
   I dati vengono dalle stesse funzioni della vista calendario (ourTeams,
   teamMatcher, classifiche), quindi le card non possono divergere da quello
   che si vede aprendo la squadra.
   --------------------------------------------------------------------------- */

// I temi si assegnano in ordine di apparizione e si ripetono: aggiungere una
// squadra non richiede di toccare il codice, e il colore resta stabile finche'
// l'ordine delle squadre in squadre.json non cambia.
const TEMI = ["theme-1", "theme-2", "theme-3", "theme-4"];

function teamLogo(slug) {
  const match = teamMatcher(slug);
  for (const m of allMatches()) {
    if (!match(m)) continue;
    const cfg = teamConfig(slug);
    const nomi = (cfg?.nomi || []).map(normName);
    const casa = normName(m.casa);
    const trasferta = normName(m.trasferta);
    // Si prende il logo del lato in cui gioca la nostra squadra: quello
    // avversario sarebbe la maglia sbagliata.
    if (nomi.includes(casa) && m.logo_casa) return m.logo_casa;
    if (nomi.includes(trasferta) && m.logo_trasferta) return m.logo_trasferta;
    if (m.logo_casa) return m.logo_casa;
  }
  return "";
}

// Posizione in classifica della squadra. Con due squadre dello stesso club
// nello stesso girone (Promozionale) si cerca il nome esatto: "astro" da solo
// prenderebbe la prima che capita.
function teamRank(slug) {
  const cfg = teamConfig(slug);
  const nomi = (cfg?.nomi || []).map(normName);
  const match = teamMatcher(slug);
  const comps = state.competitions.filter((c) => c.matches.some(match));
  for (const c of comps) {
    const rows = c.standings || [];
    const i = rows.findIndex((s) => nomi.includes(normName(s.squadra)));
    if (i >= 0) return { pos: i + 1, tot: rows.length, punti: rows[i].punti };
  }
  return null;
}

// Prossima partita non ancora giocata, dalla piu' vicina nel tempo.
function teamNextMatch(slug) {
  const match = teamMatcher(slug);
  const now = new Date();
  const future = allMatches()
    .filter(match)
    .filter((m) => !m.annullata)
    .map((m) => ({ m, d: parseDate(m.data) }))
    .filter(({ d }) => d && d >= now)
    .sort((a, b) => a.d - b.d);
  return future.length ? future[0] : null;
}

// Icona del campo: casa per le partite in casa, aereo per le trasferte.
// Sostituisce "vs"/"@" che erano ambigui da leggere a colpo d'occhio.
function venueIcon(inCasa) {
  if (inCasa) {
    return `<svg class="venue-icon" width="26" height="26" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-6h5v6"/></svg>`;
  }
  return `<svg class="venue-icon" width="26" height="26" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><path d="M10.5 13.5 3 11V8.5l7.5 1V5a1.5 1.5 0 0 1 3 0v4.5l7.5-1V11l-7.5 2.5V18l2.5 1.5V21L12 20l-4 1v-1.5L10.5 18z"/></svg>`;
}

// Le partite vengono rilette dal vivo dopo il primo disegno e l'ordine
// cambia: un indice salvato nel DOM non e' piu' affidabile. Si usa una chiave
// fatta di data, squadre e campionato, che resta valida dopo il merge.
function matchKey(m) {
  return [m.data, m.casa, m.trasferta, m._comp?.id || m.campionato || ""].join("|");
}

// La prossima partita e' un bersaglio di click a se': sta dentro la card (che
// porta al calendario) ma aprira' la scheda di quella singola partita.
function nextMatchHtml(next, slug) {
  if (!next) {
    return `<div class="next-match is-empty">
      <div class="match-info">
        <div class="match-tag">Prossima partita</div>
        <div class="match-details">Nessuna in calendario</div>
      </div>
    </div>`;
  }
  const { m, d } = next;
  const inCasa = isOurs(m.casa);
  const avversario = inCasa ? m.trasferta : m.casa;
  const sede = m.palestra || m.impianto || "";
  return `<div class="next-match" role="button" tabindex="0"
    data-match-key="${escapeAttr(matchKey(m))}" data-slug="${escapeAttr(slug)}"
    aria-label="Dettagli della prossima partita: ${escapeAttr(titolaNome(avversario))}">
    <span class="venue-icon-wrap" aria-hidden="true">${venueIcon(inCasa)}</span>
    <div class="match-info">
      <div class="match-tag">Prossima partita</div>
      <div class="match-details">${escapeHtml(titolaNome(avversario))}</div>
      <div class="match-venue">${escapeHtml(fmtShortDay(d))} · ${fmtTime(d)}${sede ? ` · ${escapeHtml(titolaNome(sede))}` : ""}</div>
    </div>
  </div>`;
}

// Nella card il titolo del campionato va accorciato: e' lungo e su mobile
// occupa due righe. Si tiene la parte prima del trattino e il girone, che e'
// l'informazione che distingue due campionati omonimi.
function shortComp(titolo) {
  const t = (titolo || "").replace(/\s*-\s*/g, " - ");
  const girone = t.match(/girone\s+([a-z0-9]+)/i);
  const base = t.split(/\s+-\s+/)[0].replace(/\s+/g, " ").trim();
  if (!girone) return base;
  const g = girone[1];
  const etichetta = g.length > 1 ? g.charAt(0).toUpperCase() + g.slice(1).toLowerCase() : g.toUpperCase();
  return `${base} · Girone ${etichetta}`;
}

function teamCardHtml(t, i) {
  const tema = TEMI[i % TEMI.length];
  const rank = teamRank(t.slug);
  const next = teamNextMatch(t.slug);
  const logo = teamLogo(t.slug);
  // "3a posizione" si legge meglio del solo "3a"; il totale resta piccolo
  // accanto, perche' 3a su 8 non e' come 3a su 20.
  const rankHtml = rank
    ? `<div class="rank-value">${rank.pos}<sup>a</sup> posizione</div>
       <div class="rank-total">su ${rank.tot} squadre</div>`
    : `<div class="rank-empty">—</div>`;
  // La card intera porta al calendario. Il link e' vuoto e copre la card con
  // ::after: cosi' il click vale su tutta la superficie ma resta un solo
  // elemento da tastiera, e la prossima partita puo' stare sopra di lui.
  return `<article class="team-card ${tema}" data-slug="${escapeAttr(t.slug)}">
    <a class="card-link" href="?squadra=${escapeAttr(t.slug)}" data-action="calendario" data-slug="${escapeAttr(t.slug)}">
      <span class="sr-only">Calendario di ${escapeHtml(titolaNome(t.nome))}</span>
    </a>
    <div class="team-head">
      ${logo ? `<img class="team-logo" src="${escapeAttr(logo)}" alt="" width="46" height="46" loading="lazy" />` : ""}
      <div class="team-titles">
        <h3 class="team-name">${escapeHtml(titolaNome(t.nome))}</h3>
        <p class="team-comp">${escapeHtml(titolaNome(shortComp(t.comp)))}</p>
      </div>
    </div>
    <div class="team-middle">
      <div class="rank-block">
        <div class="rank-label">Classifica</div>
        ${rankHtml}
      </div>
      <div class="v-sep" aria-hidden="true"></div>
      <div class="team-actions">
        <button class="action-item" data-action="riepilogo" data-slug="${escapeAttr(t.slug)}" aria-label="Classifica di ${escapeAttr(titolaNome(t.nome))}">
          <span class="action-box" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M17 5h2.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7 5H4.5a2.5 2.5 0 0 0 0 5H7"/></svg>
          </span>
          Classifica
        </button>
      </div>
    </div>
    ${nextMatchHtml(next, t.slug)}
  </article>`;
}

function renderLanding() {
  const box = $("#landing-grid");
  if (!box) return;
  const teams = ourTeams();
  if (!teams.length) {
    box.innerHTML = `<p class="empty">Nessuna squadra in calendario.</p>`;
    return;
  }
  box.innerHTML = teams.map((t, i) => teamCardHtml(t, i)).join("");

  box.querySelectorAll("[data-action]").forEach((el) =>
    el.addEventListener("click", (e) => {
      // Il link del titolo copre la card: senza questo il click farebbe il
      // giro completo e ricaricherebbe la pagina.
      e.preventDefault();
      e.stopPropagation();
      const slug = el.dataset.slug;
      if (el.dataset.action === "calendario") showCalendar(slug, false);
      else showCalendar(slug, true);
    })
  );

  // La prossima partita apre la scheda di quella singola partita. Il click non
  // deve arrivare alla card sotto, che invece porta al calendario.
  box.querySelectorAll("[data-match-key]").forEach((el) => {
    const apri = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const m = allMatches().find((x) => matchKey(x) === el.dataset.matchKey);
      if (m) openMatchModal(m);
    };
    el.addEventListener("click", apri);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") apri(e);
    });
  });
}

// La landing e la vista calendario sono la stessa pagina: si scambiano, cosi'
// il tasto Indietro funziona e i link restano condivisibili.
function showLanding(opts = {}) {
  $("#landing")?.removeAttribute("hidden");
  $("#calendar-view")?.setAttribute("hidden", "");
  $("#back-to-landing")?.setAttribute("hidden", "");
  document.body.classList.add("on-landing");
  if (!opts.fromUrl) syncUrl();
}

function showCalendar(slug, riepilogo) {
  $("#landing")?.setAttribute("hidden", "");
  $("#calendar-view")?.removeAttribute("hidden");
  $("#back-to-landing")?.removeAttribute("hidden");
  document.body.classList.remove("on-landing");
  // Classifica e giornata sono sempre visibili. state.panel resta quello
  // scelto (o quello della squadra): azzerarlo qui farebbe cadere un link
  // ?campionato= sulla prima competizione.
  applyView("ours", slug || "");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function init() {
  try {
    // La CDN di GitHub Pages tiene schedule.json in cache fino a 10 minuti.
    // Un parametro unico per caricamento la aggira: cosi' i risultati appena
    // salvati si vedono subito, senza aspettare la scadenza.
    const res = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    $("#calendar").innerHTML = `<p class="empty">Impossibile caricare i dati (${escapeHtml(err.message)}).</p>`;
    return;
  }
  state.competitions = state.data.competitions || [];

  // Configurazione delle squadre (nomi e slug per i link diretti). Se il file
  // manca o e' rotto il sito funziona lo stesso: si ricade sui nomi "astro".
  try {
    const resSq = await fetch(`${SQUADRE_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (resSq.ok) {
      const cfg = await resSq.json();
      state.squadre = Array.isArray(cfg.squadre) ? cfg.squadre : [];
    }
  } catch {
    state.squadre = [];
  }

  // I filtri possono arrivare dall'indirizzo (?squadra=..., ?vista=...).
  const daUrl = applyUrlState();

  renderHeader();
  renderTeamHead();
  renderList();
  renderStandings();
  renderChampionship();
  renderLanding();

  // Un link con ?squadra= o ?campionato= deve continuare a funzionare: apre
  // direttamente il calendario invece della landing. Solo la radice mostra
  // le card.
  $("#back-to-landing")?.addEventListener("click", () => {
    state.team = "";
    state.panel = "";
    state.round = null;
    // Il calendario resta filtrato dietro le card: si riporta a "tutte le
    // nostre" e si richiude la classifica, cosi' riaprendo una squadra non si
    // trova il filtro della precedente.
    showLanding();
  });

  // "Tutte le partite": apre e chiude la lista cronologica sotto la giornata.
  $("#all-matches")?.addEventListener("click", (e) => {
    const panel = $("#all-matches-panel");
    if (!panel) return;
    const chiuso = panel.hasAttribute("hidden");
    panel.toggleAttribute("hidden", !chiuso);
    e.currentTarget.setAttribute("aria-expanded", String(chiuso));
    if (chiuso) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  if (daUrl) showCalendar(state.team);
  else showLanding({ fromUrl: true });
  if (daUrl) syncUrl({ replace: true });
  window.addEventListener("popstate", () => {
    state.team = "";
    state.panel = "";
    const conFiltri = applyUrlState();
    // Indietro fino all'URL nudo riporta alle card.
    if (conFiltri) showCalendar(state.team);
    else showLanding({ fromUrl: true });
    syncUrl({ replace: true });
  });

  // Scheda dettagli: chiusura con click fuori, tasto Chiudi o Esc.
  const modal = $("#match-modal");
  modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));

  // Click (o Invio) su un logo della scheda: lo si apre grande.
  modal.addEventListener("click", (e) => {
    const logo = e.target.closest(".logo-zoom");
    if (logo) openLogo(logo.dataset.nome, logo.dataset.logo);
  });
  modal.addEventListener("keydown", (e) => {
    const logo = e.target.closest(".logo-zoom");
    if (logo && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openLogo(logo.dataset.nome, logo.dataset.logo);
    }
  });
  // Un logo che non carica non deve lasciare un riquadro vuoto.
  modal.addEventListener(
    "error",
    (e) => {
      if (e.target.classList && e.target.classList.contains("logo-zoom")) e.target.remove();
    },
    true
  );

  const lightbox = $("#logo-lightbox");
  lightbox.querySelectorAll("[data-lightbox-close]").forEach((el) =>
    el.addEventListener("click", closeLogo)
  );

  // Esc chiude prima l'immagine, poi la scheda: evita di perdere la partita.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!lightbox.hidden) closeLogo();
    else closeModal();
  });
  // Invio o spazio aprono il dettaglio, sia nella lista sia nelle giornate.
  for (const contenitore of ["#calendar", "#campionato"]) {
    $(contenitore).addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".match, .round-match");
      if (!card) return;
      e.preventDefault();
      // Ogni slide ha le sue righe: si risale alla giornata che la contiene.
      const slide = card.closest(".round-slide");
      const righe = slide
        ? state.roundRows.get(Number(slide.dataset.round)) || []
        : state.panelRows.length
          ? state.panelRows
          : state.rows;
      openMatchModal(righe[Number(card.dataset.idx)]);
    });
  }

  // Prova a leggere i dati freschi da FIPAV nel browser. Da PC si legge la
  // pagina desktop; da telefono FIPAV reindirizza (302) e il browser non puo'
  // cambiare User-Agent, quindi si ripiega sulla versione /mobile/, che ha
  // CORS aperto. Se anche questa fallisce, resta lo snapshot.
  const fontiPresenti = new Set(
    state.competitions.map((c) => (c.fonte || "").toLowerCase())
  );
  let cambiato = false;

  if (fontiPresenti.has("fipav") && state.data.live && state.data.live.base_url) {
    const cids = state.competitions
      .filter((c) => (c.fonte || "").toLowerCase() === "fipav" && c.campionato_id)
      .map((c) => ({ campionato_id: c.campionato_id, titolo: c.titolo }));
    let liveComps = [];
    try {
      liveComps = await fetchLiveFipav(state.data.live);
    } catch {
      liveComps = [];
    }
    if (!liveComps.length) {
      try {
        liveComps = await fetchLiveFipavMobile(state.data.live, cids);
      } catch (err) {
        state.liveError = err;
      }
    }
    if (liveComps.length) {
      mergeLive(liveComps);
      state.liveFonti.fipav = true;
      state.live = true;
      cambiato = true;
    } else {
      state.liveFonti.fipav = false;
    }
  }

  if (fontiPresenti.has("asi")) {
    const liveAsi = await fetchLiveAsi(state.data.asi || {});
    if (liveAsi && liveAsi.length) {
      mergeLiveAsi(liveAsi);
      state.liveFonti.asi = true;
      state.live = true;
      cambiato = true;
    } else {
      state.liveFonti.asi = false;
    }
  }

  if (cambiato || Object.keys(state.liveFonti).length) {
    renderHeader();
    renderTeamHead();
    renderList();
    renderStandings();
    renderChampionship();
  }
}

init();
