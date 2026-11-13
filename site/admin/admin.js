import * as pdfjs from "./vendor/pdf.min.mjs";

// ---------------------------------------------------------------------------
// Configurazione
// ---------------------------------------------------------------------------
const REPO = { owner: "KozmoShadow", repo: "astrovolley-calendario", branch: "main" };
const ASI_DIR = "data/asi";
// URL della funzione serverless che scambia il codice OAuth.
// Si configura in site/admin/config.json (oauthWorkerUrl), senza toccare il codice.
// Se vuota, l'accesso con GitHub e' disattivato e resta il token personale.
let OAUTH_WORKER_URL = "";

const TOKEN_KEY = "astrovolley_admin_token";
// path qui e' relativo alla radice del repo (es. "data/asi/x.json"):
// l'helper aggiunge "contents/" da solo.
const contentsApi = (path) =>
  `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${path}`;

pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

// ---------------------------------------------------------------------------
// Stato
// ---------------------------------------------------------------------------
const state = { token: "", user: null, comps: [], current: null };

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// Autenticazione
// ---------------------------------------------------------------------------
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function ghGet(path) {
  const res = await fetch(contentsApi(path), {
    headers: { Authorization: `Bearer ${state.token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.json().catch(() => ({}))).message || ""}`);
  return res.json();
}

async function ghPut(path, contentStr, message) {
  const existing = await ghGet(path);
  const body = {
    message,
    content: b64encode(contentStr),
    branch: REPO.branch,
  };
  if (existing && existing.sha) body.sha = existing.sha;
  const res = await fetch(contentsApi(path), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Salvataggio fallito (${res.status}): ${(await res.json().catch(() => ({}))).message || ""}`);
  return res.json();
}

async function ghReadJson(path) {
  const data = await ghGet(path);
  if (!data || !data.content) return null;
  return JSON.parse(b64decode(data.content));
}

async function verifyToken() {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  if (!res.ok) throw new Error("Token non valido o scaduto.");
  return res.json();
}

function showLoginError(msg) {
  const el = $("#login-error");
  el.textContent = msg;
  el.hidden = false;
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  state.token = "";
  state.user = null;
  $("#app").hidden = true;
  $("#login-panel").hidden = false;
  $("#who").innerHTML = "";
}

async function enterApp(user) {
  state.user = user;
  $("#login-panel").hidden = true;
  $("#app").hidden = false;
  $("#who").innerHTML = user
    ? `<img src="${user.avatar_url}" alt="" /> <span>${user.login}</span>`
    : "";
  $("#repo-info").textContent = `${REPO.owner}/${REPO.repo} · ${REPO.branch}`;
  await refreshComps();
}

// Callback OAuth: il worker rimanda alla pagina con #token=...
async function handleOAuthCallback() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const token = hash.get("token");
  if (!token) return false;
  localStorage.setItem(TOKEN_KEY, token);
  // Toglie il token dalla barra degli indirizzi (resta solo nel browser).
  history.replaceState(null, "", location.pathname);
  return true;
}

// ---------------------------------------------------------------------------
// Parser PDF (equivalente JS di importer/asi_pdf.py)
// ---------------------------------------------------------------------------
function groupLines(items) {
  const rows = new Map();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const key = `${it.page}|${Math.round(it.transform[5])}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ x: it.transform[4], t: it.str });
  }
  return [...rows.values()].map((arr) => arr.sort((a, b) => a.x - b.x));
}

function isoDateTime(data, ora) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]} ${ora.trim()}`;
}

async function parsePdf(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) items.push({ ...it, page: p });
  }

  const matches = [];
  let anchors = null;
  let giornata = "";
  for (const line of groupLines(items)) {
    const text = line.map((i) => i.t).join(" ").replace(/\s+/g, " ").trim();

    if (text.includes("N. Gara") && text.includes("Data")) {
      const casa = line.find((i) => /^Squadra\s+Casa/.test(i.t));
      const ospite = line.find((i) => /^Squadra\s+Ospite/.test(i.t));
      if (casa && ospite) anchors = { casa: casa.x, ospite: ospite.x };
      continue;
    }
    if (/^GIORNATA/i.test(text)) {
      giornata = text.split(/\s+/)[1] || "";
      continue;
    }
    if (!anchors || !/^\d{4}\s/.test(text)) continue;

    const tol = 2;
    const left = line.filter((i) => i.x < anchors.casa - tol).map((i) => i.t).join(" ");
    const casa = line
      .filter((i) => i.x >= anchors.casa - tol && i.x < anchors.ospite - tol)
      .map((i) => i.t)
      .join(" ");
    let ospite = line
      .filter((i) => i.x >= anchors.ospite - tol)
      .map((i) => i.t)
      .join(" ");

    const nums = /^(\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s+(.*)$/.exec(left);
    if (!nums) continue;
    const impianto = nums[4];
    const dash = impianto.indexOf(" - ");
    const palestra = dash >= 0 ? impianto.slice(0, dash).trim() : impianto.trim();
    const indirizzo = dash >= 0 ? impianto.slice(dash + 3).trim() : "";

    // Il "giorno" (giovedì, domenica…) e' l'ultima parola dopo la squadra ospite.
    const words = ospite.split(" ");
    const giorno = words.length > 1 ? words.pop() : "";
    ospite = words.join(" ");

    matches.push({
      gara: nums[1],
      giornata,
      data: isoDateTime(nums[2], nums[3]),
      casa: casa.trim(),
      trasferta: ospite.trim(),
      giorno,
      palestra,
      indirizzo,
    });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Campionati ASI
// ---------------------------------------------------------------------------
async function refreshComps() {
  const listEl = $("#comp-list");
  listEl.innerHTML = `<li class="muted small">Carico…</li>`;
  const dir = await ghGet(`${ASI_DIR}?ref=${REPO.branch}`);
  const files = (dir || []).map((f) => f.name);
  const ids = files
    .filter((f) => f.endsWith(".calendario.json"))
    .map((f) => f.replace(".calendario.json", ""))
    .sort();

  state.comps = [];
  for (const id of ids) {
    const cal = await ghReadJson(`${ASI_DIR}/${id}.calendario.json`);
    if (cal) state.comps.push(cal);
  }

  if (!state.comps.length) {
    listEl.innerHTML = `<li class="muted small">Nessun campionato ASI: caricane uno dal PDF qui sotto.</li>`;
  } else {
    listEl.innerHTML = state.comps
      .map(
        (c) =>
          `<li><strong>${escapeHtml(c.titolo)}</strong>
             <span class="tag">${c.matches?.length || 0} partite · ${c.giornate?.length || 0} giornate</span></li>`
      )
      .join("");
  }

  const sel = $("#sel-comp");
  sel.innerHTML = state.comps
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.titolo)}</option>`)
    .join("");
  if (state.comps.length) {
    state.current = state.comps[0].id;
    await loadResults();
  } else {
    $("#matches").innerHTML = `<p class="muted small">Nessun campionato selezionabile.</p>`;
  }
}

async function loadResults() {
  const id = $("#sel-comp").value;
  state.current = id;
  const comp = state.comps.find((c) => c.id === id);
  if (!comp) return;
  const res = (await ghReadJson(`${ASI_DIR}/${id}.risultati.json`)) || { risultati: {} };
  const risultati = res.risultati || {};

  $("#matches").innerHTML = comp.matches
    .map((m) => {
      const r = risultati[m.gara] || {};
      const score = r.risultato || "";
      const parz = r.parziali || "";
      return `<div class="match-row" data-gara="${escapeHtml(m.gara)}">
        <div class="gara">${escapeHtml(m.gara)}</div>
        <div class="info">
          <div class="teams">${escapeHtml(m.casa)} – ${escapeHtml(m.trasferta)}</div>
          <div class="meta">G${escapeHtml(m.giornata)} · ${escapeHtml(m.data)} · ${escapeHtml(m.palestra)}</div>
          <div class="fields">
            <input class="score" placeholder="3 - 1" value="${escapeHtml(score)}" />
            <input class="parz" placeholder="25-20 22-25 25-18 25-19" value="${escapeHtml(parz)}" />
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function collectResults() {
  const out = {};
  document.querySelectorAll(".match-row").forEach((row) => {
    const score = row.querySelector(".score").value.trim();
    const parz = row.querySelector(".parz").value.trim();
    if (score || parz) out[row.dataset.gara] = { risultato: score, parziali: parz };
  });
  return out;
}

async function saveResults() {
  const id = state.current;
  const comp = state.comps.find((c) => c.id === id);
  const payload = {
    _istruzioni:
      "Risultati indicizzati per N. Gara. Compila 'risultato' (es. '3 - 1') e 'parziali' dopo ogni partita. La classifica e' calcolata automaticamente.",
    competizione: id,
    risultati: collectResults(),
  };
  $("#save-status").textContent = "Salvataggio…";
  try {
    await ghPut(
      `${ASI_DIR}/${id}.risultati.json`,
      JSON.stringify(payload, null, 2) + "\n",
      `Risultati ${comp?.titolo || id}`
    );
    $("#save-status").textContent = "Salvato. Il sito si aggiorna in pochi minuti.";
  } catch (err) {
    $("#save-status").textContent = `Errore: ${err.message}`;
  }
}

async function uploadCalendar() {
  const id = $("#up-id").value.trim();
  const titolo = $("#up-titolo").value.trim();
  const categoria = $("#up-categoria").value.trim() || "Open Misto";
  const comitato = $("#up-comitato").value.trim();
  const file = $("#up-pdf").files[0];
  const status = $("#upload-status");

  if (!id || !titolo || !file) {
    status.textContent = "Servono id, titolo e il PDF.";
    return;
  }
  status.textContent = "Leggo il PDF…";
  let matches;
  try {
    matches = await parsePdf(file);
  } catch (err) {
    status.textContent = `Impossibile leggere il PDF: ${err.message}`;
    return;
  }
  if (!matches.length) {
    status.textContent = "Nessuna partita trovata: il formato del PDF è cambiato?";
    return;
  }
  const squadre = [...new Set(matches.flatMap((m) => [m.casa, m.trasferta]))].sort();
  const calendar = {
    id,
    titolo,
    fonte: "asi",
    categoria,
    comitato,
    giornate: [...new Set(matches.map((m) => m.giornata))].sort((a, b) => Number(a) - Number(b)),
    squadre,
    matches,
  };

  status.textContent = `Trovate ${matches.length} partite. Salvo…`;
  try {
    await ghPut(
      `${ASI_DIR}/${id}.calendario.json`,
      JSON.stringify(calendar, null, 2) + "\n",
      `Calendario ${titolo}`
    );
    // Crea il file risultati se non esiste ancora.
    const resPath = `${ASI_DIR}/${id}.risultati.json`;
    if (!(await ghGet(`${resPath}?ref=${REPO.branch}`))) {
      await ghPut(
        resPath,
        JSON.stringify(
          { _istruzioni: "Risultati indicizzati per N. Gara.", competizione: id, risultati: {} },
          null,
          2
        ) + "\n",
        `Risultati ${titolo} (vuoto)`
      );
    }
    status.textContent = `Salvato: ${matches.length} partite in ${id}.calendario.json.`;
    await refreshComps();
  } catch (err) {
    status.textContent = `Errore: ${err.message}`;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      $("#tab-oauth").hidden = tab.dataset.tab !== "oauth";
      $("#tab-pat").hidden = tab.dataset.tab !== "pat";
    })
  );
}

async function boot() {
  setupTabs();

  // Configurazione (worker OAuth) letta da un file, cosi' non serve toccare il codice.
  try {
    const cfg = await (await fetch("./config.json", { cache: "no-store" })).json();
    OAUTH_WORKER_URL = (cfg.oauthWorkerUrl || "").trim().replace(/\/+$/, "");
  } catch {
    OAUTH_WORKER_URL = "";
  }

  if (!OAUTH_WORKER_URL) {
    $("#btn-oauth").disabled = true;
    $("#oauth-note").textContent =
      "Accesso con GitHub non ancora configurato (serve la funzione serverless). Usa il token personale.";
  } else {
    $("#btn-oauth").addEventListener("click", () => {
      location.href = `${OAUTH_WORKER_URL}/login`;
    });
  }

  $("#btn-pat").addEventListener("click", async () => {
    const token = $("#pat-input").value.trim();
    if (!token) return;
    state.token = token;
    try {
      const user = await verifyToken();
      localStorage.setItem(TOKEN_KEY, token);
      await enterApp(user);
    } catch (err) {
      showLoginError(err.message);
    }
  });

  $("#btn-logout").addEventListener("click", logout);
  $("#sel-comp").addEventListener("change", loadResults);
  $("#btn-save").addEventListener("click", saveResults);
  $("#btn-upload").addEventListener("click", uploadCalendar);

  // Sessione esistente?
  const oauth = await handleOAuthCallback();
  const saved = localStorage.getItem(TOKEN_KEY);
  if (oauth || saved) {
    state.token = localStorage.getItem(TOKEN_KEY);
    try {
      const user = await verifyToken();
      await enterApp(user);
    } catch {
      logout();
    }
  }
}

boot();
