const OUR_PATTERN = "astro";
const DATA_URL = "data/schedule.json";

const state = {
  data: null,
  competitions: [],
  view: "ours", // "ours" oppure l'id di una competizione
  query: "",
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

function renderViewFilter() {
  const box = $("#view-filter");
  const items = [{ id: "ours", label: "Le nostre partite" }].concat(
    state.competitions.map((c) => ({ id: c.id, label: c.titolo }))
  );
  box.innerHTML = items
    .map(
      (it) =>
        `<button class="chip" data-id="${it.id}" aria-pressed="${state.view === it.id}">${escapeHtml(
          it.label
        )}</button>`
    )
    .join("");
  box.querySelectorAll(".chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.view = btn.dataset.id;
      renderViewFilter();
      renderList();
    })
  );
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
  for (const m of rows) {
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
    if (m.palestra) metaParts.push(escapeHtml(m.palestra));
    const fonte = (m._comp.fonte || "manuale").toLowerCase();
    html += `
      <article class="match ${ours ? "is-ours" : ""}">
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
  }
  box.innerHTML = html;
}

function renderStandings() {
  const box = $("#standings");
  const comps = state.competitions.filter((c) => c.standings && c.standings.length);
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
  $("#updated").textContent = gen ? `${fmtDay(gen)} ${fmtTime(gen)}` : "—";
  document.title = `${state.data.societa || "Calendario"} — Calendario e Classifiche`;
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
}

init();
