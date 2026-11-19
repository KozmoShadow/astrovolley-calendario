import { fetchLiveFipav, fetchLiveFipavMobile } from "./fipav-live.js";

const OUR_PATTERN = "astro";
const DATA_URL = "data/schedule.json";
const SQUADRE_URL = "data/squadre.json";

const state = {
  data: null,
  competitions: [],
  squadre: [], // configurazione delle squadre (data/squadre.json)
  view: "ours", // "ours" | "week" | id di una competizione
  team: "", // "" = tutte le nostre squadre, altrimenti il nome di una squadra
  query: "",
  live: false, // true se i dati FIPAV sono stati letti dal vivo adesso
  liveError: null,
  rows: [], // partite attualmente mostrate (per la scheda dettagli)
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
// assets/loghi/; qui riscriviamo gli URL FIPAV verso quei file locali.
function logoUrl(url) {
  const m = /\/img\/(\d+)\/Loghi\/[^/]+\.(jpe?g|png|gif)/i.exec(url || "");
  return m ? `assets/loghi/${m[1]}.${m[2].toLowerCase()}` : url || "";
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
  const q = state.query.trim().toLowerCase();
  let rows = allMatches();
  if (state.view === "week") {
    const range = weekRange();
    rows = rows.filter((m) => matchIsOurs(m) && inWeek(m, range));
  } else if (state.view === "ours") {
    rows = rows.filter(matchIsOurs);
  } else {
    rows = rows.filter((m) => m._comp.id === state.view);
  }
  // Il filtro per squadra vale solo quando si guardano le nostre partite.
  if (state.team && (state.view === "ours" || state.view === "week")) {
    const match = teamMatcher(state.team);
    rows = rows.filter(match);
  }
  if (q) {
    rows = rows.filter((m) =>
      [m.casa, m.trasferta, m.palestra, m.campionato].join(" ").toLowerCase().includes(q)
    );
  }
  return rows.sort((a, b) => (a.data || "").localeCompare(b.data || ""));
}

function currentCompetition() {
  return state.competitions.find((c) => c.id === state.view) || null;
}

function viewLabel() {
  if (state.view === "week") return "Questa settimana";
  if (state.view === "ours") return "Le nostre partite";
  return state.competitions.find((c) => c.id === state.view)?.titolo || "Calendario";
}

function closeFilters() {
  const panel = $("#filters-panel");
  const toggle = $("#filters-toggle");
  if (panel) panel.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

// Cambia vista e ridisegna tutto. Scegliendo un campionato il filtro per
// squadra si azzera, perche' le squadre appartengono a "Le nostre partite".
function applyView(view, team, opts = {}) {
  state.view = view;
  state.team = view === "ours" || view === "week" ? team || "" : "";
  closeFilters();
  renderViewFilter();
  renderList();
  renderStandings();
  if (!opts.fromUrl) syncUrl();
}

// L'indirizzo rispecchia i filtri, cosi' il link si puo' copiare e incollare
// (es. nei gruppi delle squadre) e riapre la stessa vista. I cambi fatti
// dall'utente finiscono nella cronologia: il tasto Indietro annulla il filtro
// invece di uscire dal sito.
function syncUrl(opts = {}) {
  if (!window.history?.pushState) return;
  const params = new URLSearchParams();
  if (state.view !== "ours") params.set("vista", state.view);
  if (state.team) params.set("squadra", state.team);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (opts.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

// All'apertura i filtri arrivano dall'indirizzo. Uno slug sconosciuto non deve
// rompere la pagina: si apre il calendario normale.
function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  const team = (params.get("squadra") || "").trim();
  const vista = (params.get("vista") || "").trim();
  const valida = team && ourTeams().some((t) => t.slug === team);

  if (valida) {
    state.view = vista === "week" ? "week" : "ours";
    state.team = team;
    return true;
  }
  if (vista && (vista === "week" || state.competitions.some((c) => c.id === vista))) {
    state.view = vista;
    state.team = "";
    return true;
  }
  return false;
}

function renderViewFilter() {
  const box = $("#view-filter");
  const comps = state.competitions;
  const isChamp = state.view !== "ours" && state.view !== "week";
  const teams = ourTeams();
  const filtriActive = state.team || isChamp;

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

  // Squadra: compare solo per "Le nostre partite" e "Questa settimana".
  if (!isChamp) {
    html += `<div class="filter-group"><div class="filter-head">Squadra</div>
      <button role="menuitem" class="dropdown-item ${!state.team ? "is-active" : ""}" data-team="">
        Tutte le nostre</button>`;
    for (const t of teams) {
      html += `<button role="menuitem" class="dropdown-item ${state.team === t.slug ? "is-active" : ""}" data-team="${escapeAttr(t.slug)}">
        <span class="filter-team">${escapeHtml(t.nome)}</span>
        <span class="filter-sub">${escapeHtml(t.comp)} · ${t.partite} partite</span></button>`;
    }
    html += `</div>`;
  }

  // Campionato
  if (comps.length) {
    html += `<div class="filter-group"><div class="filter-head">Campionato</div>
      <button role="menuitem" class="dropdown-item ${!isChamp ? "is-active" : ""}" data-view="ours">
        Tutti i campionati</button>`;
    for (const c of comps) {
      html += `<button role="menuitem" class="dropdown-item ${state.view === c.id ? "is-active" : ""}" data-view="${escapeAttr(c.id)}">
        ${escapeHtml(c.titolo)}</button>`;
    }
    html += `</div>`;
  }

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
      if (item.dataset.team !== undefined) applyView(state.view === "week" ? "week" : "ours", item.dataset.team);
      else applyView(item.dataset.view, "");
    })
  );
}

function matchCard(m, idx, opts = {}) {
  const d = parseDate(m.data);
  const ours = matchIsOurs(m);
  const time = d ? fmtTime(d) : "--:--";
  const parts = (m.risultato || "").split(/\s*[-–]\s*/);
  const hasScore = parts.length === 2;
  const result = m.risultato
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
      <article class="match ${ours ? "is-ours" : ""} ${esito}" data-idx="${idx}" tabindex="0" role="button"
               aria-label="Dettagli partita">
        <div class="match-time">${time}</div>
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

// Raggruppa le partite: per giornata quando si guarda un singolo campionato
// (cosi' le gare della stessa giornata finiscono nello stesso riquadro),
// altrimenti per data. L'indice resta quello di `rows`, per la scheda dettagli.
function groupRows(rows) {
  const byRound = state.view !== "ours" && state.view !== "week" && rows.length > 0 && rows.every((r) => r.giornata);
  const groups = [];
  const index = new Map();
  rows.forEach((m, idx) => {
    const d = parseDate(m.data);
    const key = byRound ? `g${m.giornata}` : d ? `d${d.toDateString()}` : "nd";
    let g = index.get(key);
    if (!g) {
      g = {
        key,
        label: byRound ? `Giornata ${m.giornata}` : d ? fmtDay(d) : "Data da definire",
        items: [],
      };
      index.set(key, g);
      groups.push(g);
    }
    g.items.push({ m, idx });
  });
  return { groups, byRound };
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

  const { groups, byRound } = groupRows(rows);
  let html = "";
  for (const g of groups) {
    const cards = g.items.map(({ m, idx }) => matchCard(m, idx, { showDate: byRound })).join("");
    html += byRound
      ? `<section class="round"><div class="round-head">${escapeHtml(g.label)}</div>${cards}</section>`
      : `<div class="day-label">${escapeHtml(g.label)}</div>${cards}`;
  }
  box.innerHTML = html;
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
  const logoCasa = m.logo_casa
    ? `<img src="${escapeAttr(logoUrl(m.logo_casa))}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
  const logoTrasf = m.logo_trasferta
    ? `<img src="${escapeAttr(logoUrl(m.logo_trasferta))}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
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
      <div class="detail-result">${m.risultato ? escapeHtml(m.risultato) : "vs"}</div>
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

function renderStandings() {
  const box = $("#standings");
  let comp = currentCompetition();
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
  const gen = parseDate((state.data.generato_il || "").replace("T", " ").slice(0, 19));
  const el = $("#updated");
  if (state.live) {
    el.innerHTML = `Risultati aggiornati <strong>adesso</strong> da FIPAV`;
    el.classList.add("is-live");
  } else if (gen) {
    el.textContent = `Dati FIPAV aggiornati ${fmtRelative(gen)}`;
    el.title = `Ultimo aggiornamento automatico: ${fmtDay(gen)} ${fmtTime(gen)}`;
    el.classList.remove("is-live");
  } else {
    el.textContent = "Aggiornamento automatico in corso";
    el.classList.remove("is-live");
  }
  document.title = `${state.data.societa || "Calendario"} — Calendario e Classifiche`;
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
  renderViewFilter();
  renderList();
  renderStandings();
  if (daUrl) syncUrl({ replace: true });
  window.addEventListener("popstate", () => {
    state.view = "ours";
    state.team = "";
    applyUrlState();
    renderViewFilter();
    renderList();
    renderStandings();
  });

  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
  });

  document.addEventListener("click", closeFilters);

  // Scheda dettagli: chiusura con click fuori, tasto Chiudi o Esc.
  const modal = $("#match-modal");
  modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  $("#calendar").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".match");
    if (card) {
      e.preventDefault();
      openMatchModal(state.rows[Number(card.dataset.idx)]);
    }
  });

  // Prova a leggere i dati freschi da FIPAV nel browser. Da PC si legge la
  // pagina desktop; da telefono FIPAV reindirizza (302) e il browser non puo'
  // cambiare User-Agent, quindi si ripiega sulla versione /mobile/, che ha
  // CORS aperto. Se anche questa fallisce, resta lo snapshot.
  if (state.data.live && state.data.live.base_url) {
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
      state.live = true;
      renderHeader();
      renderViewFilter();
      renderList();
      renderStandings();
    }
  }
}

init();
