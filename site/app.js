const OUR_PATTERN = "astro";
const DATA_URL = "data/schedule.json";

const state = {
  data: null,
  competitions: [],
  activeCompetition: "all",
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
  // "2026-11-12 21:30:00" -> Date locale
  const iso = value.replace(" ", "T");
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function fmtDay(d) {
  return dayFmt.format(d);
}

function fmtTime(d) {
  return d.toTimeString().slice(0, 5);
}

function isOurs(name) {
  return (name || "").toLowerCase().includes(OUR_PATTERN);
}

function matchIsOurs(m) {
  return isOurs(m.casa) || isOurs(m.trasferta);
}

function allMatches() {
  const rows = [];
  for (const comp of state.competitions) {
    for (const m of comp.matches) {
      rows.push({ ...m, _comp: comp });
    }
  }
  return rows;
}

function filteredMatches() {
  const q = state.query.trim().toLowerCase();
  return allMatches().filter((m) => {
    if (state.activeCompetition !== "all" && m._comp.id !== state.activeCompetition) return false;
    if (!q) return true;
    const hay = [m.casa, m.trasferta, m.campionato, m.palestra].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function renderCompetitionFilter() {
  const box = $("#competition-filter");
  const chips = [{ id: "all", label: "Tutti i campionati", fonte: "" }, ...state.competitions];
  box.innerHTML = chips
    .map(
      (c) =>
        `<button class="chip" data-id="${c.id}" aria-pressed="${state.activeCompetition === c.id}">${escapeHtml(
          c.label || c.titolo
        )}</button>`
    )
    .join("");
  box.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeCompetition = btn.dataset.id;
      renderCompetitionFilter();
      renderCalendar();
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

function renderCalendar() {
  const box = $("#calendar");
  const rows = filteredMatches().sort((a, b) => (a.data || "").localeCompare(b.data || ""));
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
    const casaOurs = isOurs(m.casa);
    const trasOurs = isOurs(m.trasferta);
    const result = m.risultato
      ? `<span class="result">${escapeHtml(m.risultato)}</span>`
      : `<span class="vs">vs</span>`;
    const metaParts = [];
    if (m.campionato) metaParts.push(escapeHtml(m.campionato));
    if (m.parziali) metaParts.push(`Parziali: ${escapeHtml(m.parziali)}`);
    if (m.palestra) metaParts.push(escapeHtml(m.palestra));
    const fonte = (m._comp.fonte || "manuale").toLowerCase();
    html += `
      <article class="match ${ours ? "is-ours" : ""}">
        <div class="match-time">${time}</div>
        <div class="match-body">
          <div class="teams">
            <span class="team-name ${casaOurs ? "ours" : ""}">${escapeHtml(m.casa || "—")}</span>
            ${result}
            <span class="team-name ${trasOurs ? "ours" : ""}">${escapeHtml(m.trasferta || "—")}</span>
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
  const comps = state.competitions.filter(
    (c) => c.standings && c.standings.length && (state.activeCompetition === "all" || c.id === state.activeCompetition)
  );
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
  renderCompetitionFilter();
  renderCalendar();
  renderStandings();

  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderCalendar();
  });
}

init();
