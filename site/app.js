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

function visibleMatches() {
  let rows = allMatches();
  if (state.view === "week") {
    const range = weekRange();
    rows = rows.filter((m) => matchIsOurs(m) && inWeek(m, range));
  } else {
    rows = rows.filter(matchIsOurs);
  }
  if (state.team) rows = rows.filter(teamMatcher(state.team));
  return rows.sort((a, b) => (a.data || "").localeCompare(b.data || ""));
}

function viewLabel() {
  return state.view === "week" ? "Questa settimana" : "Le nostre partite";
}

function closeFilters() {
  const panel = $("#filters-panel");
  const toggle = $("#filters-toggle");
  if (panel) panel.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

// Cambia vista e ridisegna tutto.
function applyView(view, team, opts = {}) {
  state.view = view === "week" ? "week" : "ours";
  state.team = team || "";
  closeFilters();
  renderViewFilter();
  renderList();
  renderStandings();
  if (isPanelOpen()) renderChampionship();
  if (!opts.fromUrl) syncUrl();
}

function isPanelOpen() {
  const panel = $("#campionato-panel");
  return Boolean(panel && !panel.hasAttribute("hidden"));
}

// L'indirizzo rispecchia filtri e pannello aperto, cosi' il link si puo'
// copiare e incollare (es. nei gruppi delle squadre) e riapre la stessa vista.
// I cambi fatti dall'utente finiscono nella cronologia: il tasto Indietro
// annulla il filtro invece di uscire dal sito.
function syncUrl(opts = {}) {
  if (!window.history?.pushState) return;
  const params = new URLSearchParams();
  if (state.view !== "ours") params.set("vista", state.view);
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

  state.view = vista === "week" ? "week" : "ours";
  state.team = team && ourTeams().some((t) => t.slug === team) ? team : "";
  // I vecchi link usavano ?vista=<id campionato> per aprire un campionato:
  // ora il campionato e' un pannello, quindi si accetta anche quella forma.
  const legacy = vista && vista !== "week" && vista !== "ours" ? vista : "";
  const scelto = campionato || legacy;
  state.panel = state.competitions.some((c) => c.id === scelto) ? scelto : "";
  state.round = null;
  return Boolean(state.team || state.panel);
}

function renderViewFilter() {
  const box = $("#view-filter");
  const teams = ourTeams();
  const filtriActive = Boolean(state.team);

  let html = `<span class="chip chip-current" aria-current="true">${escapeHtml(viewLabel())}</span>
    <button class="chip chip-dropdown ${filtriActive ? "is-active" : ""}" id="filters-toggle"
            aria-haspopup="true" aria-expanded="false">
      Filtri${state.team ? ` · 1` : ""}
      <span class="caret" aria-hidden="true">▾</span>
    </button>
    <div class="dropdown-menu filters-panel" id="filters-panel" role="menu" hidden>`;

  // Vista
  html += `<div class="filter-group"><div class="filter-head">Vista</div>
    <button role="menuitem" class="dropdown-item ${state.view === "ours" ? "is-active" : ""}" data-view="ours">
      Le nostre partite</button>
    <button role="menuitem" class="dropdown-item ${state.view === "week" ? "is-active" : ""}" data-view="week">
      Questa settimana</button></div>`;

  // Squadra
  html += `<div class="filter-group"><div class="filter-head">Squadra</div>
    <button role="menuitem" class="dropdown-item ${!state.team ? "is-active" : ""}" data-team="">
      Tutte le nostre</button>`;
  for (const t of teams) {
    html += `<button role="menuitem" class="dropdown-item ${state.team === t.slug ? "is-active" : ""}" data-team="${escapeAttr(t.slug)}">
      <span class="filter-team">${escapeHtml(t.nome)}</span>
      <span class="filter-sub">${escapeHtml(t.comp)} · ${t.partite} partite</span></button>`;
  }
  html += `</div>`;

  html += `</div>`;
  box.innerHTML = html;

  const toggle = $("#filters-toggle");
  const panel = $("#filters-panel");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  panel.querySelectorAll(".dropdown-item").forEach((item) =>
    item.addEventListener("click", () => {
      if (item.dataset.team !== undefined) applyView(state.view, item.dataset.team);
      else applyView(item.dataset.view, "");
    })
  );
}

// Blocchetto calendario per il pannello Campionato: mese e anno nella barretta,
// giorno in grande, ora sotto. L'anno sta nella barretta perche' la stagione
// scavalca il 31 dicembre: senza, "11/11" e "11/01" sarebbero indistinguibili.
const MESI = ["GEN", "FEB", "MAR", "APR", "MAG", "GIU", "LUG", "AGO", "SET", "OTT", "NOV", "DIC"];

function whenBlock(d) {
  if (!d) {
    return `<div class="cal"><span class="m">—</span><span class="g">--</span><span class="t">--:--</span></div>`;
  }
  const giorno = String(d.getDate()).padStart(2, "0");
  return `<div class="cal">
            <span class="m" aria-hidden="true">${MESI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}</span>
            <span class="g" aria-hidden="true">${giorno}</span>
            <span class="t" aria-hidden="true">${fmtTime(d)}</span>
            <span class="sr-only">${escapeHtml(fmtDay(d))}, ore ${fmtTime(d)}</span>
          </div>`;
}

function matchCard(m, idx, opts = {}) {
  const d = parseDate(m.data);
  const ours = matchIsOurs(m);
  const time = d ? fmtTime(d) : "--:--";
  // Nel pannello Campionato la data serve: le partite di una giornata cadono in
  // giorni diversi. Nella lista no, perche' il giorno e' gia' nell'intestazione.
  const quando = opts.showDate ? whenBlock(d) : `<div class="match-time">${time}</div>`;
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
  if (opts.showDate && d) metaParts.push(escapeHtml(fmtDay(d)));
  else if (m.campionato) metaParts.push(escapeHtml(m.campionato));
  const fonte = (m._comp.fonte || "manuale").toLowerCase();
  const ente = (m._comp.fonte || "manuale").toUpperCase();
  return `
      <article class="match ${ours ? "is-ours" : ""} ${esito} ${annullata ? "is-cancelled" : ""}" data-idx="${idx}" tabindex="0" role="button"
               aria-label="Dettagli partita${annullata ? " (annullata)" : ""}">
        ${quando}
        <div class="match-body">
          <div class="teams ${hasScore ? "is-played" : "is-upcoming"}">
            <span class="team-name name-casa ${isOurs(m.casa) ? "ours" : ""}">${escapeHtml(m.casa || "—")}</span>
            ${scoreCasa}
            ${result}
            <span class="team-name name-ospite ${isOurs(m.trasferta) ? "ours" : ""}">${escapeHtml(m.trasferta || "—")}</span>
            ${scoreOspite}
          </div>
          <div class="meta">${metaParts.join(" · ")}</div>
        </div>
        <span class="badge ${fonte}">${escapeHtml(ente)}</span>
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
  const rows = visibleMatches();
  let title = viewLabel();
  const tn = teamName(state.team);
  if (tn) title += ` — ${tn}`;
  $("#list-title").textContent = title;

  if (!rows.length) {
    box.innerHTML = `<p class="empty">Nessuna partita trovata con questi filtri.</p>`;
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
      ? `<img src="${escapeAttr(logoUrl(url))}" alt="Logo ${escapeAttr(nome || "")}" loading="lazy"
           class="logo-zoom" role="button" tabindex="0"
           data-logo="${escapeAttr(logoUrl(url))}" data-nome="${escapeAttr(nome || "")}" />`
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
    <p class="modal-kicker">${escapeHtml(m._comp.titolo || m.campionato || "")}${
      m.giornata ? ` · Giornata ${escapeHtml(String(m.giornata))}` : ""
    }</p>
    <div class="detail-score">
      <div class="detail-team">
        ${logoCasa}
        <span class="detail-team-name ${isOurs(m.casa) ? "ours" : ""}">${escapeHtml(m.casa || "—")}</span>
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
        <span class="detail-team-name ${isOurs(m.trasferta) ? "ours" : ""}">${escapeHtml(m.trasferta || "—")}</span>
      </div>
    </div>
    ${setChips}
    <div class="detail-list">
      ${riga("Data", quando)}
      ${riga("Campionato", m.campionato || m.girone)}
      ${riga("Girone", m.girone && m.girone !== m.campionato ? m.girone : "")}
      ${riga("Palestra", m.palestra)}
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
  const comp = panelCompetition();
  if (!box) return;

  // Selettore di campionato: serve solo se ce n'e' piu' di uno.
  let html = "";
  if (state.competitions.length > 1) {
    html += `<label class="champ-select">
      <span class="sr-only">Campionato</span>
      <select id="champ-picker">${state.competitions
        .map(
          (c) =>
            `<option value="${escapeAttr(c.id)}" ${c.id === state.panel ? "selected" : ""}>${escapeHtml(
              c.titolo
            )}</option>`
        )
        .join("")}</select>
    </label>`;
  }

  if (!comp) {
    box.innerHTML = html + `<p class="empty">Nessun campionato disponibile.</p>`;
    return;
  }

  const { rounds, senza } = roundsOf(comp);
  if (!rounds.length && !senza.length) {
    box.innerHTML = html + `<p class="empty">Nessuna partita in questo campionato.</p>`;
    return;
  }

  if (state.round === null && rounds.length) state.round = defaultRound(rounds);
  const corrente = rounds.find((r) => r.n === state.round) || rounds[0] || null;
  const pos = corrente ? rounds.findIndex((r) => r.n === corrente.n) : -1;
  const partite = (corrente ? corrente.matches : senza.slice()).sort((a, b) =>
    (a.data || "").localeCompare(b.data || "")
  );

  if (rounds.length) {
    html += `<div class="round-nav">
      <button class="round-step" id="round-prev" aria-label="Giornata precedente" ${
        pos <= 0 ? "disabled" : ""
      }>‹</button>
      <div class="round-current">
        <span class="round-name">Giornata ${escapeHtml(String(corrente.n))}</span>
        <span class="round-count">${pos + 1} di ${rounds.length} · ${partite.length} partite</span>
      </div>
      <button class="round-step" id="round-next" aria-label="Giornata successiva" ${
        pos >= rounds.length - 1 ? "disabled" : ""
      }>›</button>
    </div>`;

    html += `<div class="round-strip" role="tablist" aria-label="Giornate">${rounds
      .map(
        (r) =>
          `<button role="tab" class="round-tab ${r.n === corrente.n ? "is-active" : ""}"
             data-round="${r.n}" aria-selected="${r.n === corrente.n}">${escapeHtml(String(r.n))}</button>`
      )
      .join("")}</div>`;
  }

  html += `<div id="round-matches" class="round-matches" role="tabpanel"></div>`;
  box.innerHTML = html;

  // Le partite della giornata: stessa scheda della lista, cosi' il dettaglio
  // si apre allo stesso modo. state.panelRows tiene gli indici di QUESTO
  // contenitore, altrimenti si aprirebbe la partita sbagliata.
  const list = $("#round-matches");
  state.panelRows = partite;
  list.innerHTML = partite.length
    ? partite.map((m, i) => matchCard(m, i, { showDate: true })).join("")
    : `<p class="empty">Nessuna partita in questa giornata.</p>`;
  list.querySelectorAll(".match").forEach((el) =>
    el.addEventListener("click", () => openMatchModal(state.panelRows[Number(el.dataset.idx)]))
  );

  const picker = $("#champ-picker");
  if (picker) {
    picker.addEventListener("change", (e) => {
      state.panel = e.target.value;
      state.round = null;
      renderChampionship();
      renderStandings();
      syncUrl();
    });
  }
  const prev = $("#round-prev");
  const next = $("#round-next");
  if (prev) prev.addEventListener("click", () => goRound(pos - 1));
  if (next) next.addEventListener("click", () => goRound(pos + 1));
  box.querySelectorAll(".round-tab").forEach((tab) =>
    tab.addEventListener("click", () => goRound(Number(tab.dataset.round), true))
  );
  // La giornata attiva deve restare visibile nella striscia, anche quando e'
  // l'ultima e la striscia e' piu' larga dello schermo.
  const attivo = box.querySelector(".round-tab.is-active");
  if (attivo) {
    const strip = attivo.parentElement;
    const sinistra = attivo.offsetLeft - strip.clientWidth / 2 + attivo.clientWidth / 2;
    strip.scrollLeft = Math.max(0, sinistra);
  }
}

// Cambia giornata: `valore` e' l'indice (dalle frecce) o il numero (dai tab).
function goRound(valore, eNumero = false) {
  const comp = panelCompetition();
  if (!comp) return;
  const { rounds } = roundsOf(comp);
  const i = eNumero ? rounds.findIndex((r) => r.n === Number(valore)) : Number(valore);
  if (i < 0 || i >= rounds.length) return;
  state.round = rounds[i].n;
  renderChampionship();
}

// Apre o chiude il pannello. All'apertura sceglie un campionato sensato:
// quello della squadra filtrata, altrimenti il primo.
function togglePanel(open) {
  const panel = $("#campionato-panel");
  const btn = $("#toggle-campionato");
  if (!panel || !btn) return;
  const apri = open === undefined ? panel.hasAttribute("hidden") : open;
  if (apri && !state.panel) {
    const comp = competitionForTeam(state.team) || state.competitions[0];
    state.panel = comp ? comp.id : "";
    state.round = null;
  }
  if (apri) panel.removeAttribute("hidden");
  else {
    panel.setAttribute("hidden", "");
    // Il campionato scelto non resta nell'indirizzo: il link non deve dire
    // che il pannello e' aperto quando non lo e'.
    state.panel = "";
    state.round = null;
  }
  btn.setAttribute("aria-expanded", String(apri));
  if (apri) renderChampionship();
  syncUrl();
}

function renderStandings() {
  const box = $("#standings");
  // Con un campionato aperto nel pannello si mostra la sua classifica; con una
  // squadra selezionata, quella del campionato in cui gioca. Altrimenti tutte.
  let comp = state.panel ? state.competitions.find((c) => c.id === state.panel) : null;
  if (!comp && state.team) {
    const match = teamMatcher(state.team);
    comp = state.competitions.find((c) => c.matches.some(match)) || null;
  }
  const comps = (comp ? [comp] : state.competitions).filter(
    (c) => c.standings && c.standings.length
  );
  $("#standings-title").textContent = comp ? "Classifica" : "Classifiche";
  if (!comps.length) {
    box.innerHTML = `<p class="empty">Nessuna classifica disponibile al momento.</p>`;
    return;
  }
  box.innerHTML = comps
    .map((c) => {
      const rows = c.standings
        .map((s, i) => {
          const ours = isOurs(s.squadra);
          return `<tr class="${ours ? "is-ours" : ""}">
            <td class="num">${i + 1}</td>
            <td>${escapeHtml(s.squadra)}</td>
            <td class="num">${s.punti}</td>
            <td class="num">${s.pg}</td>
            <td class="num">${s.pv}-${s.pp}</td>
            <td class="num">${s.sf}-${s.ss}</td>
          </tr>`;
        })
        .join("");
      return `<div class="standing-card">
        <h3>${escapeHtml(c.titolo)}</h3>
        <table>
          <thead><tr>
            <th class="num">#</th><th>Squadra</th>
            <th class="num">Pti</th><th class="num">PG</th>
            <th class="num">V-P</th><th class="num">Set</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");
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

function setupStandingsToggle() {
  const btn = $("#toggle-standings");
  const panel = $("#standings-panel");
  btn.addEventListener("click", () => {
    const open = panel.hasAttribute("hidden");
    if (open) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
    btn.setAttribute("aria-expanded", String(open));
  });
}

function setupCampionatoToggle() {
  $("#toggle-campionato").addEventListener("click", () => togglePanel());
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
  setupStandingsToggle();
  setupCampionatoToggle();
  renderViewFilter();
  renderList();
  renderStandings();
  // Un link con ?campionato= apre direttamente il pannello.
  if (state.panel) togglePanel(true);
  if (daUrl) syncUrl({ replace: true });
  window.addEventListener("popstate", () => {
    state.view = "ours";
    state.team = "";
    state.panel = "";
    applyUrlState();
    renderViewFilter();
    renderList();
    renderStandings();
    togglePanel(Boolean(state.panel));
    syncUrl({ replace: true });
  });

  document.addEventListener("click", closeFilters);

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
  // Invio o spazio aprono il dettaglio, sia nella lista sia nel pannello.
  for (const contenitore of ["#calendar", "#campionato"]) {
    $(contenitore).addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".match");
      if (!card) return;
      e.preventDefault();
      const righe = card.closest("#round-matches") ? state.panelRows : state.rows;
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
    renderViewFilter();
    renderList();
    renderStandings();
    if (isPanelOpen()) renderChampionship();
  }
}

init();
