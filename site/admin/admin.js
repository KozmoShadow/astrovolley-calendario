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
const state = {
  token: "",
  user: null,
  comps: [],
  current: null,
  currentComp: null,
  pending: {}, // modifiche ai risultati non ancora salvate
  loghi: {}, // loghi squadre (URL) non ancora salvati
  loghiDirty: 0,
  modalGara: null,
};

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

// Stato locale delle modifiche non ancora salvate, per non fare un commit
// a ogni partita: si compila la giornata e si salva una volta sola.
//   state.pending[gara] = { risultato: "3 - 1", parziali: "25-20 ..." }
//   state.loghi[squadra] = "https://..."
function pendingOf(gara) {
  return state.pending[gara] || { risultato: "", parziali: "" };
}

function setPending(gara, patch) {
  const cur = pendingOf(gara);
  const next = { ...cur, ...patch };
  if (!next.risultato && !next.parziali) delete state.pending[gara];
  else state.pending[gara] = next;
  markDirty();
}

function markDirty() {
  const n = Object.keys(state.pending).length + state.loghiDirty;
  const el = $("#save-status");
  if (el) el.textContent = n ? "Modifiche non salvate." : "";
}

function parseScore(s) {
  const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec((s || "").trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// Quanti parziali servono: la somma dei set del risultato (3-1 -> 4).
function setCount(risultato) {
  const p = parseScore(risultato);
  return p ? p[0] + p[1] : 0;
}

function logoOf(m, key) {
  const url = (m[key] || "").trim();
  if (!url) return "";
  return url.startsWith("assets/") ? `../${url}` : url;
}

async function loadResults() {
  const id = $("#sel-comp").value;
  state.current = id;
  const comp = state.comps.find((c) => c.id === id);
  if (!comp) return;
  state.currentComp = comp;

  const res = (await ghReadJson(`${ASI_DIR}/${id}.risultati.json`)) || { risultati: {} };
  state.pending = {};
  for (const [gara, r] of Object.entries(res.risultati || {})) {
    state.pending[gara] = { risultato: r.risultato || "", parziali: r.parziali || "" };
  }

  const sq = (await ghReadJson(`${ASI_DIR}/${id}.squadre.json`)) || { loghi: {} };
  state.loghi = { ...(sq.loghi || {}) };
  state.loghiDirty = 0;

  renderMatchList();
  renderLogoForm();
  markDirty();
}

function renderMatchList() {
  const comp = state.currentComp;
  if (!comp) return;
  $("#matches").innerHTML = comp.matches
    .map((m) => {
      const p = pendingOf(m.gara);
      const parts = (p.risultato || "").split(/\s*[-–]\s*/);
      const hasScore = parts.length === 2;
      const result = hasScore
        ? `<span class="result">${escapeHtml(p.risultato)}</span>`
        : `<span class="vs">vs</span>`;
      return `<article class="match-row" data-gara="${escapeHtml(m.gara)}" tabindex="0" role="button" aria-label="Modifica partita">
        <div class="gara">${escapeHtml(m.gara)}</div>
        <div class="info">
          <div class="teams ${hasScore ? "is-played" : ""}">
            <span class="team-name">${escapeHtml(m.casa)}</span>
            ${result}
            <span class="team-name">${escapeHtml(m.trasferta)}</span>
          </div>
          <div class="meta">G${escapeHtml(String(m.giornata))} · ${escapeHtml(m.data)} · ${escapeHtml(m.palestra)}</div>
          ${p.parziali ? `<div class="parz-preview">${escapeHtml(p.parziali)}</div>` : ""}
        </div>
      </article>`;
    })
    .join("");
  $("#matches")
    .querySelectorAll(".match-row")
    .forEach((el) =>
      el.addEventListener("click", () => openMatchModal(el.dataset.gara))
    );
}

function renderLogoForm() {
  const comp = state.currentComp;
  if (!comp) return;
  const squadre = [...new Set(comp.matches.flatMap((m) => [m.casa, m.trasferta]))].sort((a, b) =>
    a.localeCompare(b, "it")
  );
  $("#logo-form").innerHTML = squadre
    .map(
      (sq) => `<label class="logo-row">
        <span class="logo-name">${escapeHtml(sq)}</span>
        <span class="logo-input">
          <input type="url" data-squadra="${escapeHtml(sq)}" placeholder="https://…/logo.png"
                 value="${escapeHtml(state.loghi[sq] || "")}" />
          <img class="logo-preview" data-preview="${escapeHtml(sq)}"
               src="${escapeAttr(state.loghi[sq] || "")}" alt=""
               ${state.loghi[sq] ? "" : "hidden"} onerror="this.hidden=true" />
        </span>
      </label>`
    )
    .join("");
  $("#logo-form")
    .querySelectorAll("input[data-squadra]")
    .forEach((inp) =>
      inp.addEventListener("input", () => {
        const sq = inp.dataset.squadra;
        const url = inp.value.trim();
        const prev = url.startsWith("assets/") ? `../${url}` : url;
        const img = $(`[data-preview="${CSS.escape(sq)}"]`);
        if (url) {
          state.loghi[sq] = url;
          if (img) {
            img.src = prev;
            img.hidden = false;
          }
        } else {
          delete state.loghi[sq];
          if (img) img.hidden = true;
        }
        state.loghiDirty = 1;
        markDirty();
      })
    );
}

// Scheda dettaglio modificabile: stessa impostazione della scheda pubblica,
// ma con i campi per punteggio e parziali.
function openMatchModal(gara) {
  const comp = state.currentComp;
  const m = comp.matches.find((x) => x.gara === gara);
  if (!m) return;
  state.modalGara = gara;
  renderModal();
  const modal = $("#match-modal");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modal.querySelector(".modal-close").focus();
}

function renderModal() {
  const comp = state.currentComp;
  const m = comp.matches.find((x) => x.gara === state.modalGara);
  if (!m) return;
  const p = pendingOf(m.gara);

  const logoCasa = logoOf(m, "logo_casa")
    ? `<img src="${escapeAttr(logoOf(m, "logo_casa"))}" alt="" onerror="this.remove()" />`
    : "";
  const logoTrasf = logoOf(m, "logo_trasferta")
    ? `<img src="${escapeAttr(logoOf(m, "logo_trasferta"))}" alt="" onerror="this.remove()" />`
    : "";

  $("#modal-content").innerHTML = `
    <p class="modal-kicker">${escapeHtml(comp.titolo)}${m.giornata ? ` · Giornata ${escapeHtml(String(m.giornata))}` : ""}</p>
    <div class="detail-score">
      <div class="detail-team">${logoCasa}<span class="detail-team-name">${escapeHtml(m.casa)}</span></div>
      <div class="detail-result" id="score-slot"></div>
      <div class="detail-team">${logoTrasf}<span class="detail-team-name">${escapeHtml(m.trasferta)}</span></div>
    </div>
    <div id="sets-edit" class="sets-edit"></div>
    <div class="detail-list">
      <div class="detail-row"><span class="detail-label">Data</span><span class="detail-value">${escapeHtml(m.data)}</span></div>
      ${m.palestra ? `<div class="detail-row"><span class="detail-label">Palestra</span><span class="detail-value">${escapeHtml(m.palestra)}</span></div>` : ""}
      ${m.indirizzo ? `<div class="detail-row"><span class="detail-label">Indirizzo</span><span class="detail-value">${escapeHtml(m.indirizzo)}</span></div>` : ""}
      <div class="detail-row"><span class="detail-label">N. Gara</span><span class="detail-value">${escapeHtml(m.gara)}</span></div>
    </div>
    <p class="muted small modal-hint">
      Le modifiche restano in sospeso: premi <strong>Salva</strong> nella pagina per registrarle.
    </p>
    <div class="modal-actions">
      <button class="btn" id="btn-modal-close">Chiudi</button>
    </div>
  `;

  renderScoreSlot();
  renderSetsEdit();
  $("#btn-modal-close").addEventListener("click", closeModal);
}

// Il punteggio si mostra come nella scheda pubblica; cliccandolo diventa
// modificabile. Al termine si richiude da solo, cosi' non si cambia per sbaglio.
function renderScoreSlot() {
  const p = pendingOf(state.modalGara);
  const slot = $("#score-slot");
  if (p.risultato) {
    slot.innerHTML = `<button class="score-btn is-set" title="Modifica il risultato">${escapeHtml(p.risultato)}</button>`;
    slot.querySelector("button").addEventListener("click", showScoreInputs);
  } else {
    slot.innerHTML = `<button class="score-btn" title="Inserisci il risultato">vs</button>`;
    slot.querySelector("button").addEventListener("click", showScoreInputs);
  }
}

function showScoreInputs() {
  const cur = pendingOf(state.modalGara);
  const parts = (cur.risultato || "").split(/\s*[-–]\s*/);
  const slot = $("#score-slot");
  slot.innerHTML = `
    <span class="score-inputs">
      <input class="score-set" id="sc-a" inputmode="numeric" maxlength="1"
             value="${escapeHtml(parts[0] || "")}" placeholder="3" />
      <span class="score-dash">-</span>
      <input class="score-set" id="sc-b" inputmode="numeric" maxlength="1"
             value="${escapeHtml(parts[1] || "")}" placeholder="1" />
    </span>`;
  const a = $("#sc-a");
  const b = $("#sc-b");

  const apply = () => {
    const va = a.value.replace(/\D/g, "");
    const vb = b.value.replace(/\D/g, "");
    const ris = va && vb ? `${va} - ${vb}` : "";
    // Cambiando il punteggio i parziali gia' scritti restano; si tagliano solo
    // quelli in eccesso o se ne aggiungono di vuoti in coda.
    const tokens = (pendingOf(state.modalGara).parziali || "").trim().split(/\s+/).filter(Boolean);
    const kept = ris ? tokens.slice(0, setCount(ris)).join(" ") : "";
    setPending(state.modalGara, { risultato: ris, parziali: kept });
    renderSetsEdit();
  };
  const commit = () => {
    // Uscendo dal campo, il punteggio torna un'etichetta non modificabile.
    renderScoreSlot();
  };

  [a, b].forEach((inp, i) => {
    inp.addEventListener("input", () => {
      apply();
      if (i === 0 && a.value.length === 1) b.focus();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") commit();
    });
    inp.addEventListener("blur", () => {
      setTimeout(() => {
        if (!document.activeElement || !document.activeElement.classList.contains("score-set")) commit();
      }, 120);
    });
  });
  a.focus();
  a.select();
}

// Blocchi dei parziali: tanti quanti i set del risultato (3-1 -> 4). Cambiando
// il punteggio i blocchi gia' scritti restano; si aggiunge o toglie in coda.
function renderSetsEdit() {
  const box = $("#sets-edit");
  if (!box) return;
  const p = pendingOf(state.modalGara);
  const n = setCount(p.risultato);
  const tokens = (p.parziali || "").trim().split(/\s+/).filter(Boolean);

  if (!n) {
    box.classList.add("is-empty");
    box.innerHTML = `<span class="muted small">Inserisci il punteggio per generare i parziali.</span>`;
    return;
  }
  box.classList.remove("is-empty");
  box.innerHTML = Array.from({ length: n }, (_, i) => {
    return `<input class="set-edit" data-set="${i}" inputmode="numeric"
                   placeholder="25-20" value="${escapeHtml(tokens[i] || "")}" />`;
  }).join("");
  box.querySelectorAll(".set-edit").forEach((inp) =>
    inp.addEventListener("input", () => {
      const vals = Array.from({ length: n }, (_, i) => {
        const el = $(`#sets-edit .set-edit[data-set="${i}"]`);
        return el ? el.value.trim() : "";
      });
      setPending(state.modalGara, { parziali: vals.filter(Boolean).join(" ") });
    })
  );
}

function closeModal() {
  const modal = $("#match-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  state.modalGara = null;
  // La scheda si chiude e torna non modificabile: per rimettere mano ai
  // risultati bisogna riaprirla.
  renderMatchList();
  markDirty();
}

async function saveResults() {
  const id = state.current;
  const comp = state.comps.find((c) => c.id === id);
  $("#save-status").textContent = "Salvataggio…";
  try {
    // Un solo commit per i risultati dell'intera giornata compilata.
    const risultati = {};
    for (const [gara, r] of Object.entries(state.pending)) {
      if (r.risultato || r.parziali) {
        risultati[gara] = { risultato: r.risultato || "", parziali: r.parziali || "" };
      }
    }
    await ghPut(
      `${ASI_DIR}/${id}.risultati.json`,
      JSON.stringify(
        {
          _istruzioni:
            "Risultati indicizzati per N. Gara. Compila 'risultato' (es. '3 - 1') e 'parziali' dopo ogni partita. La classifica e' calcolata automaticamente.",
          competizione: id,
          risultati,
        },
        null,
        2
      ) + "\n",
      `Risultati ${comp?.titolo || id}`
    );

    // I loghi stanno in un file separato, cosi' rigenerare il calendario dal PDF
    // non li cancella. Si scrive solo se qualcosa e' cambiato: un salvataggio di
    // soli risultati non deve produrre un commit inutile.
    if (state.loghiDirty) {
      const loghi = {};
      for (const [sq, url] of Object.entries(state.loghi)) {
        if ((url || "").trim()) loghi[sq] = url.trim();
      }
      await ghPut(
        `${ASI_DIR}/${id}.squadre.json`,
        JSON.stringify({ competizione: id, loghi }, null, 2) + "\n",
        `Loghi ${comp?.titolo || id}`
      );
      state.loghiDirty = 0;
    }

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

const escapeAttr = (s) => (s ? escapeHtml(s) : "");

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

  // Chiusura della scheda dettaglio: X, sfondo, tasto Esc.
  $("#match-modal").querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", closeModal)
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

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
