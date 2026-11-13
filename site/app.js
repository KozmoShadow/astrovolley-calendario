import { fetchLiveFipav } from "./fipav-live.js";

const OUR_PATTERN = "astro";
const DATA_URL = "data/schedule.json";

const state = {
  data: null,
  competitions: [],
  view: "ours", // "ours" oppure l'id di una competizione
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
const fmtTime = (d) => d.toTimeString().slice(0, 5);
const isOurs = (name) => (name || "").toLowerCase().includes(OUR_PATTERN);
const matchIsOurs = (m) => isOurs(m.casa) || isOurs(m.trasferta);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

const escapeAttr = (s) => (s ? escapeHtml(s) : "");

function allMatches() {
  const rows = [];
  for (const comp of state.competitions) {
    for (const m of comp.matches) rows.push({ ...m, _comp: comp });
  }
  return rows;
}

function visibleMatches() {
  const q = state.query.trim().toLowerCase();
  let rows = allMatches();
  if (state.view === "ours") {
    rows = rows.filter(matchIsOurs);
  } else {
    rows = rows.filter((m) => m._comp.id === state.view);
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

function closeChampMenu() {
  const menu = $("#champ-menu");
  const toggle = $("#champ-toggle");
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function renderViewFilter() {
  const box = $("#view-filter");
  const comps = state.competitions;
  const selected = currentCompetition();

  const oursActive = state.view === "ours";
  let html = `<button class="chip" data-id="ours" aria-pressed="${oursActive}">Le nostre partite</button>`;

  if (comps.length) {
    const label = selected ? selected.titolo : "Campionati";
    html += `
      <div class="dropdown">
        <button class="chip chip-dropdown ${selected ? "is-active" : ""}" id="champ-toggle"
                aria-haspopup="true" aria-expanded="false">
          <span class="chip-label">${escapeHtml(label)}</span>
          <span class="caret" aria-hidden="true">▾</span>
        </button>
        <div class="dropdown-menu" id="champ-menu" role="menu" hidden>
          ${comps
            .map(
              (c) =>
                `<button role="menuitem" class="dropdown-item ${
                  state.view === c.id ? "is-active" : ""
                }" data-id="${c.id}">${escapeHtml(c.titolo)}</button>`
            )
            .join("")}
        </div>
      </div>`;
  }
  box.innerHTML = html;

  box.querySelector('[data-id="ours"]').addEventListener("click", () => {
    state.view = "ours";
    closeChampMenu();
    renderViewFilter();
    renderList();
    renderStandings();
  });

  const toggle = $("#champ-toggle");
  if (toggle) {
    const menu = $("#champ-menu");
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
    menu.addEventListener("click", (e) => e.stopPropagation());
    menu.querySelectorAll(".dropdown-item").forEach((item) =>
      item.addEventListener("click", () => {
        state.view = item.dataset.id;
        closeChampMenu();
        renderViewFilter();
        renderList();
        renderStandings();
      })
    );
  }
}

function renderList() {
  const box = $("#calendar");
  const rows = visibleMatches();
  $("#list-title").textContent =
    state.view === "ours"
      ? "Le nostre partite"
      : state.competitions.find((c) => c.id === state.view)?.titolo || "Calendario";

  if (!rows.length) {
    box.innerHTML = `<p class="empty">Nessuna partita trovata con questi filtri.</p>`;
    return;
  }

  let html = "";
  let currentDay = "";
  rows.forEach((m, idx) => {
    const d = parseDate(m.data);
    const dayKey = d ? fmtDay(d) : "Data da definire";
    if (dayKey !== currentDay) {
      html += `<div class="day-label">${escapeHtml(dayKey)}</div>`;
      currentDay = dayKey;
    }
    const ours = matchIsOurs(m);
    const time = d ? fmtTime(d) : "--:--";
    const result = m.risultato
      ? `<span class="result">${escapeHtml(m.risultato)}</span>`
      : `<span class="vs">vs</span>`;
    const metaParts = [];
    if (m.campionato) metaParts.push(escapeHtml(m.campionato));
    const fonte = (m._comp.fonte || "manuale").toLowerCase();
    html += `
      <article class="match ${ours ? "is-ours" : ""}" data-idx="${idx}" tabindex="0" role="button"
               aria-label="Dettagli partita">
        <div class="match-time">${time}</div>
        <div class="match-body">
          <div class="teams">
            <span class="team-name ${isOurs(m.casa) ? "ours" : ""}">${escapeHtml(m.casa || "—")}</span>
            ${result}
            <span class="team-name ${isOurs(m.trasferta) ? "ours" : ""}">${escapeHtml(m.trasferta || "—")}</span>
          </div>
          <div class="meta">${metaParts.join(" · ")}</div>
        </div>
        <span class="badge ${fonte}">${escapeHtml(m._comp.categoria || fonte)}</span>
      </article>`;
  });
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
  const loghi = [m.logo_casa, m.logo_trasferta].some(Boolean)
    ? `<div class="detail-logos">
         <img src="${escapeAttr(m.logo_casa)}" alt="" loading="lazy" onerror="this.remove()" />
         <img src="${escapeAttr(m.logo_trasferta)}" alt="" loading="lazy" onerror="this.remove()" />
       </div>`
    : "";
  const fonte = (m._comp.fonte || "manuale").toLowerCase();
  $("#modal-content").innerHTML = `
    <p class="modal-kicker">${escapeHtml(m._comp.titolo || m.campionato || "")}${
      m.giornata ? ` · Giornata ${escapeHtml(String(m.giornata))}` : ""
    }</p>
    <div class="detail-score">
      <div class="detail-team">
        <span class="detail-team-name ${isOurs(m.casa) ? "ours" : ""}">${escapeHtml(m.casa || "—")}</span>
      </div>
      <div class="detail-result">${m.risultato ? escapeHtml(m.risultato) : "vs"}</div>
      <div class="detail-team">
        <span class="detail-team-name ${isOurs(m.trasferta) ? "ours" : ""}">${escapeHtml(m.trasferta || "—")}</span>
      </div>
    </div>
    ${setChips}
    ${loghi}
    <div class="detail-list">
      ${riga("Data", quando)}
      ${riga("Campionato", m.campionato || m.girone)}
      ${riga("Girone", m.girone && m.girone !== m.campionato ? m.girone : "")}
      ${riga("Palestra", m.palestra)}
      ${riga("Impianto", m.impianto)}
      ${riga("Fonte", m._comp.fonte === "fipav" ? "FIPAV (ufficiale)" : m._comp.fonte)}
    </div>
    <span class="badge ${fonte} modal-badge">${escapeHtml(m._comp.categoria || fonte)}</span>
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
  const comp = currentCompetition();
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
  const nonFipav = state.competitions.filter((c) => (c.fonte || "").toLowerCase() !== "fipav");
  const fipav = liveComps.map((comp) => ({
    id: comp.campionato_id ? `fipav-${comp.campionato_id}` : `fipav-${comp.titolo}`,
    titolo: comp.titolo,
    fonte: "fipav",
    categoria: "FIPAV",
    campionato_id: comp.campionato_id,
    matches: comp.matches.map((m) => ({
      ...m,
      fonte: "fipav",
      campionato_id: comp.campionato_id,
      campionato: comp.titolo,
      girone: comp.titolo,
    })),
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
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    $("#calendar").innerHTML = `<p class="empty">Impossibile caricare i dati (${escapeHtml(err.message)}).</p>`;
    return;
  }
  state.competitions = state.data.competitions || [];
  renderHeader();
  setupStandingsToggle();
  renderViewFilter();
  renderList();
  renderStandings();

  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
  });

  document.addEventListener("click", closeChampMenu);

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

  // Opzione C: prova a leggere i dati freschi da FIPAV nel browser.
  // Se riesce, sostituisce la parte FIPAV; altrimenti resta lo snapshot.
  if (state.data.live && state.data.live.base_url) {
    try {
      const liveComps = await fetchLiveFipav(state.data.live);
      if (liveComps.length) {
        mergeLive(liveComps);
        state.live = true;
        renderHeader();
        renderViewFilter();
        renderList();
        renderStandings();
      }
    } catch (err) {
      state.liveError = err;
      state.live = false;
    }
  }
}

init();
