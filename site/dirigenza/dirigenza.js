// Area dirigenza: sola lettura. Mostra le partite in casa mese per mese, con
// refertisti e addetti all'arbitro.
//
// I turni arrivano da un Google Sheet pubblicato (vedi dirigenza.json): si
// scrive li' e il sito li vede subito, senza commit. Se il foglio non risponde
// si torna a data/turni.json, cosi' la pagina non resta mai vuota.
//
// Legge solo lo snapshot delle partite: qui contano i turni, non i risultati, e
// il live FIPAV riporta le sole partite della nostra societa', quindi
// scarterebbe quelle dell'altra societa' di cui curiamo il referto.
const DATA_URL = "../data/schedule.json";
const CONFIG_URL = "../data/dirigenza.json";
const TURNI_URL = "../data/turni.json";

const FOGLIO_TIMEOUT = 8000;

const MESI_LUNGHI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

const state = {
  competitions: [],
  config: { societa: ["astro"], altraSocieta: { nome: "", pattern: "" }, foglio: { id: "", gid: "0", nome: "" } },
  turni: new Map(),
  origineTurni: "file", // foglio | file
  filtro: "casa", // casa | tutte
  mese: "", // "" = elenco dei mesi
};

const $ = (sel) => document.querySelector(sel);

const norm = (s) => (s || "").toLowerCase();

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}
const escapeAttr = (s) => (s ? escapeHtml(s) : "");

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  return isNaN(d) ? null : d;
}

const fmtTime = (d) => d.toTimeString().slice(0, 5);
const fmtGiorno = (d) =>
  new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "2-digit", month: "short" }).format(d);
const fmtDataLunga = (d) =>
  new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" }).format(d);

// Chiave di una partita. Serve a due cose: agganciare i turni e non contare
// due volte la stessa partita.
function matchKey(m) {
  return `${m.data}|${norm(m.casa)}|${norm(m.trasferta)}`;
}

function isOurTeam(name) {
  const n = norm(name);
  return state.config.societa.some((p) => p && n.includes(p));
}

function isAltraSquadra(name) {
  const p = state.config.altraSocieta.pattern;
  return Boolean(p) && norm(name).includes(p);
}

// Partita in casa: gioca in casa una squadra nostra, oppure quella di cui
// curiamo il referto.
const inCasa = (m) => isOurTeam(m.casa) || isAltraSquadra(m.casa);
const nostre = (m) => isOurTeam(m.casa) || isOurTeam(m.trasferta) || isAltraSquadra(m.casa) || isAltraSquadra(m.trasferta);

// Una lista piatta con le partite che ci interessano. Il filtro e' sulla singola
// partita, non sulla squadra: cosi' una partita tra due nostre squadre (es.
// Cercola - Portici) compare una volta sola, non una per squadra.
function tutteLePartite() {
  const rows = [];
  const viste = new Set();
  for (const c of state.competitions) {
    for (const m of c.matches || []) {
      if (!m.data) continue;
      const key = matchKey(m);
      if (viste.has(key)) continue; // rete di sicurezza contro i doppioni
      viste.add(key);
      rows.push({ ...m, _comp: c, _key: key });
    }
  }
  return rows.sort((a, b) => a.data.localeCompare(b.data));
}

function partiteFiltrate() {
  const tutte = tutteLePartite();
  return tutte.filter((m) => (state.filtro === "casa" ? inCasa(m) : nostre(m)));
}

const meseDi = (m) => (m.data || "").slice(0, 7);

function nomeMese(chiave) {
  const [anno, mese] = chiave.split("-");
  const nome = MESI_LUNGHI[Number(mese) - 1] || mese;
  return `${nome} ${anno}`;
}

// ---------------------------------------------------------------- caricamento

async function loadJson(url, etichetta) {
  const res = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${etichetta}: HTTP ${res.status}`);
  return res.json();
}

function leggiConfig(cfg) {
  const societa = (cfg.societa || ["astro"]).map(norm).filter(Boolean);
  const altra = cfg.altra_societa || {};
  const foglio = cfg.foglio_turni || {};
  return {
    societa: societa.length ? societa : ["astro"],
    altraSocieta: { nome: altra.nome || "", pattern: norm(altra.pattern) },
    foglio: { id: foglio.id || "", gid: foglio.gid ?? "0", nome: foglio.nome || "" },
  };
}

function leggiTurni(doc) {
  const mappa = new Map();
  for (const t of doc.turni || []) {
    const key = `${t.data}|${norm(t.casa)}|${norm(t.trasferta)}`;
    mappa.set(key, {
      refertisti: (t.refertisti || []).filter(Boolean),
      addetti: (t.addetti_arbitro || []).filter(Boolean),
    });
  }
  return mappa;
}

// Modifiche locali rimosse: i turni ora stanno sul Google Sheet, che si modifica
// direttamente da li'. Resta solo la mappa dei turni letti (foglio o file).

// I turni effettivi, per chiave partita.
function turniDi(key) {
  return state.turni.get(key) || { refertisti: [], addetti: [] };
}

// Una partita e' coperta quando ha almeno un refertista.
const coperta = (m) => turniDi(m._key).refertisti.length > 0;

// ---------------------------------------------------------------- Google Sheet

// Parser CSV vero: i nomi possono contenere virgole tra virgolette, e un
// semplice split(",") spezzerebbe "Rossi, Mario" in due.
function parseCsv(testo) {
  const righe = [];
  let riga = [];
  let campo = "";
  let dentro = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (dentro) {
      if (c === '"') {
        if (testo[i + 1] === '"') {
          campo += '"';
          i++;
        } else dentro = false;
      } else campo += c;
    } else if (c === '"') {
      dentro = true;
    } else if (c === ",") {
      riga.push(campo);
      campo = "";
    } else if (c === "\n") {
      riga.push(campo);
      righe.push(riga);
      riga = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo !== "" || riga.length) {
    riga.push(campo);
    righe.push(riga);
  }
  return righe.filter((r) => r.some((v) => v.trim() !== ""));
}

// I nomi si separano con la virgola; i ";" e i ritorni a capo dentro la cella
// arrivano da chi scrive di fretta, quindi valgono uguale.
function separaNomi(cella) {
  return (cella || "")
    .split(/[,;\n]/)
    .map((n) => n.trim())
    .filter(Boolean);
}

// L'intestazione si cerca per nome, non per posizione: cosi' il foglio si puo'
// riordinare o allargare senza rompere la pagina.
function indiceColonne(intestazione) {
  const normCol = (s) => norm(s).replace(/[^a-z0-9]/g, "");
  const idx = {};
  intestazione.forEach((nome, i) => {
    const n = normCol(nome);
    if (n === "data") idx.data = i;
    else if (n === "casa") idx.casa = i;
    else if (n === "trasferta") idx.trasferta = i;
    else if (n.startsWith("refertist")) idx.refertisti = i;
    else if (n.startsWith("addett")) idx.addetti = i;
  });
  return idx;
}

// Da CSV del foglio alla stessa mappa usata dal file JSON.
function turniDaCsv(testo) {
  const righe = parseCsv(testo);
  const mappa = new Map();
  if (!righe.length) return mappa;
  const idx = indiceColonne(righe[0]);
  if (idx.data === undefined || idx.casa === undefined || idx.trasferta === undefined) {
    throw new Error("intestazione senza data/casa/trasferta");
  }
  for (const r of righe.slice(1)) {
    const data = (r[idx.data] || "").trim();
    const casa = (r[idx.casa] || "").trim();
    const trasferta = (r[idx.trasferta] || "").trim();
    if (!data || !casa || !trasferta) continue;
    const refertisti = idx.refertisti !== undefined ? separaNomi(r[idx.refertisti]) : [];
    const addetti = idx.addetti !== undefined ? separaNomi(r[idx.addetti]) : [];
    if (!refertisti.length && !addetti.length) continue;
    mappa.set(`${data}|${norm(casa)}|${norm(trasferta)}`, { refertisti, addetti });
  }
  return mappa;
}

// URL del foglio in CSV. Accetta tre formati, perche' il link che si copia da
// Google cambia a seconda di come si e' pubblicato:
//   - .../d/<id>/edit          foglio normale condiviso in lettura
//   - .../d/e/<id>/pubhtml     pubblicato sul web (quello consigliato)
//   - il solo id, nudo
// Nel formato pubblicato il tab non si sceglie per nome ma per gid, quindi li'
// si usa il primo foglio pubblicato.
function urlFoglio(foglio) {
  const grezzo = (foglio.id || "").trim();
  if (!grezzo) return "";
  const daUrl = grezzo.match(/\/d\/(?:e\/)?([A-Za-z0-9_-]+)/);
  const id = daUrl ? daUrl[1] : grezzo;
  const pubblicato = id.startsWith("2PACX-");
  if (pubblicato) {
    const gid = String(foglio.gid ?? "0").trim() || "0";
    // Il CSV pubblicato viene servito con max-age=300: senza un parametro che
    // cambia, Google puo' restituire una copia vecchia di 5 minuti. Il cache-buster
    // fa arrivare sempre la versione fresca.
    return `https://docs.google.com/spreadsheets/d/e/${id}/pub?output=csv&gid=${encodeURIComponent(gid)}&_=${Date.now()}`;
  }
  const base = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
  const nome = (foglio.nome || "").trim();
  return nome ? `${base}&sheet=${encodeURIComponent(nome)}` : base;
}

async function caricaTurniDaFoglio(foglio) {
  const url = urlFoglio(foglio);
  if (!url) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FOGLIO_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const testo = await res.text();
    // Un foglio privato risponde 200 con la pagina di login di Google.
    if (/^\s*<!DOCTYPE html/i.test(testo)) throw new Error("foglio non pubblico");
    const mappa = turniDaCsv(testo);
    return mappa;
  } finally {
    clearTimeout(t);
  }
}

// Il foglio lo compila una persona, quindi i nomi possono differire per maiuscole,
// spazi doppi o accenti. Per l'aggancio si confronta una forma ripulita.
const impronta = (s) =>
  norm(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Riallinea le chiavi del foglio alle partite vere. Se la data e la squadra di
// casa combaciano ma la trasferta e' scritta in altro modo, il turno si aggancia
// lo stesso: e' l'errore di battitura piu' probabile. Le voci che restano fuori
// vengono restituite, per poterle segnalare invece di perderle in silenzio.
function riallineaTurni(turniFoglio, partite) {
  const perChiave = new Map();
  const perDataCasa = new Map();
  for (const m of partite) {
    perChiave.set(impronta(`${m.data}|${m.casa}|${m.trasferta}`), m._key);
    const dc = `${impronta(m.data)}|${impronta(m.casa)}`;
    if (!perDataCasa.has(dc)) perDataCasa.set(dc, []);
    perDataCasa.get(dc).push(m);
  }

  const allineati = new Map();
  const orfani = [];
  for (const [k, v] of turniFoglio) {
    const [data, casa, trasferta] = k.split("|");
    const diretto = perChiave.get(impronta(`${data}|${casa}|${trasferta}`));
    if (diretto) {
      allineati.set(diretto, v);
      continue;
    }
    // Ripiego su data+casa, ma solo se quella coppia e' unica: con due partite
    // in casa lo stesso giorno non si puo' indovinare quale sia.
    const candidate = perDataCasa.get(`${impronta(data)}|${impronta(casa)}`) || [];
    if (candidate.length === 1) allineati.set(candidate[0]._key, v);
    else orfani.push({ data, casa, trasferta });
  }
  return { allineati, orfani };
}

// ------------------------------------------------------------------- rendering

function chipEnte(fonte) {
  const f = norm(fonte);
  const etichetta = f === "fipav" ? "FIPAV" : f === "asi" ? "ASI" : "Manuale";
  return `<span class="dir-ente dir-ente-${escapeAttr(f || "manuale")}">${etichetta}</span>`;
}

function etichettaAltra(m) {
  if (!isAltraSquadra(m.casa) && !isAltraSquadra(m.trasferta)) return "";
  const nome = state.config.altraSocieta.nome || "altra società";
  return `<span class="dir-alien">Referto ${escapeHtml(nome)}</span>`;
}

function renderMesi() {
  const rows = partiteFiltrate();
  const grid = $("#mesi-grid");
  const empty = $("#dir-empty");

  $("#mesi-sub").textContent =
    state.filtro === "casa"
      ? `${rows.length} partite in casa in stagione`
      : `${rows.length} partite in stagione, in casa e in trasferta`;

  if (!rows.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "Nessuna partita da mostrare.";
    return;
  }
  empty.hidden = true;

  const perMese = new Map();
  for (const m of rows) {
    const k = meseDi(m);
    if (!perMese.has(k)) perMese.set(k, []);
    perMese.get(k).push(m);
  }

  grid.innerHTML = [...perMese.entries()]
    .map(([k, partite]) => {
      const prima = partite[0];
      const d = parseDate(prima.data);
      // Le trasferte non hanno turni da coprire: contarle come "scoperte"
      // renderebbe rosso ogni mese del filtro "Tutte le partite".
      const inCasaMese = partite.filter((m) => !(!inCasa(m) && nostre(m)));
      const coperte = inCasaMese.filter(coperta).length;
      const scoperte = inCasaMese.length - coperte;
      const stato =
        inCasaMese.length === 0 ? "neutro" : scoperte === 0 ? "ok" : coperte === 0 ? "ko" : "warn";
      const testo =
        inCasaMese.length === 0
          ? "Solo trasferte"
          : scoperte === 0
            ? "Tutte coperte"
            : coperte === 0
              ? `Nessun refertista`
              : `${coperte}/${inCasaMese.length} coperte`;
      return `
        <button class="mese-card mese-${stato}" type="button" data-mese="${escapeAttr(k)}">
          <span class="mese-nome">${escapeHtml(nomeMese(k))}</span>
          <span class="mese-conteggio">${partite.length} ${partite.length === 1 ? "partita" : "partite"}</span>
          <span class="mese-prima">${d ? `${escapeHtml(fmtGiorno(d))} · ${escapeHtml(fmtTime(d))}` : "—"}</span>
          <span class="mese-stato ${stato}">${testo}</span>
        </button>`;
    })
    .join("");
}

function bloccoNomi(titolo, nomi) {
  const vuoto = `<span class="dir-vuoto">da assegnare</span>`;
  return `
    <div class="dir-turno">
      <span class="dir-turno-tit">${escapeHtml(titolo)}</span>
      <span class="dir-turno-nomi">${
        nomi.length ? nomi.map((n) => `<span class="dir-persona">${escapeHtml(n)}</span>`).join("") : vuoto
      }</span>
    </div>`;
}

function rigaPartita(m) {
  const d = parseDate(m.data);
  const t = turniDi(m._key);
  const annullata = (m.stato || "") === "cancelled";
  const risultato = (m.risultato || "").trim();
  const trasferta = !inCasa(m) && nostre(m);
  // Le trasferte si mostrano e basta: nessun turno da coprire, quindi niente
  // verde/rosso. Il colore qui significa "manca il refertista", e in trasferta
  // il referto non lo curiamo noi.
  const stato = trasferta ? "esterna" : coperta(m) ? "coperta" : "scoperta";

  return `
    <article class="partita-riga ${stato}${annullata ? " annullata" : ""}">
      <div class="pr-quando">
        <span class="pr-giorno">${d ? escapeHtml(fmtDataLunga(d)) : "—"}</span>
        <span class="pr-ora">${d ? escapeHtml(fmtTime(d)) : "--:--"}</span>
      </div>
      <div class="pr-incontro">
        <div class="pr-squadre">
          <span class="pr-casa">${escapeHtml(m.casa)}</span>
          <span class="pr-vs">${risultato ? escapeHtml(risultato) : "vs"}</span>
          <span class="pr-trasferta">${escapeHtml(m.trasferta)}</span>
        </div>
        <div class="pr-meta">
          ${chipEnte(m._comp.fonte)}
          <span class="pr-comp">${escapeHtml(m.campionato || m._comp.titolo || "")}</span>
          ${trasferta ? `<span class="dir-esterna">trasferta</span>` : ""}
          ${etichettaAltra(m)}
          ${annullata ? `<span class="dir-annullata">annullata</span>` : ""}
        </div>
        ${m.palestra ? `<p class="pr-palestra">${escapeHtml(m.palestra)}</p>` : ""}
      </div>
      ${
        trasferta
          ? ""
          : `<div class="pr-turni">
        ${bloccoNomi("Refertisti", t.refertisti)}
        ${bloccoNomi("Addetti arbitro", t.addetti)}
      </div>`
      }
    </article>`;
}

function renderMese() {
  const rows = partiteFiltrate().filter((m) => meseDi(m) === state.mese);
  const lista = $("#mese-lista");
  $("#mese-titolo").textContent = nomeMese(state.mese);
  $("#mese-sub").textContent =
    `${rows.length} ${rows.length === 1 ? "partita" : "partite"} · ` +
    (state.filtro === "casa" ? "solo in casa" : "tutte");

  if (!rows.length) {
    lista.innerHTML = `<p class="dir-empty">Nessuna partita in questo mese.</p>`;
    return;
  }

  const perGiorno = new Map();
  for (const m of rows) {
    const g = (m.data || "").slice(0, 10);
    if (!perGiorno.has(g)) perGiorno.set(g, []);
    perGiorno.get(g).push(m);
  }

  lista.innerHTML = [...perGiorno.entries()]
    .map(([, partite]) => partite.map(rigaPartita).join(""))
    .join("");
}

// ------------------------------------------------------------------ navigazione

function mostraMesi() {
  state.mese = "";
  $("#mese-view").hidden = true;
  $("#mesi-view").hidden = false;
  renderMesi();
  syncUrl();
}

function apriMese(chiave) {
  state.mese = chiave;
  $("#mesi-view").hidden = true;
  $("#mese-view").hidden = false;
  renderMese();
  syncUrl();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setFiltro(filtro) {
  state.filtro = filtro === "tutte" ? "tutte" : "casa";
  $("#filtro-casa").setAttribute("aria-pressed", String(state.filtro === "casa"));
  $("#filtro-tutte").setAttribute("aria-pressed", String(state.filtro === "tutte"));
  if (state.mese) renderMese();
  else renderMesi();
  syncUrl();
}

function syncUrl(opts = {}) {
  if (!window.history?.pushState) return;
  const params = new URLSearchParams();
  if (state.filtro !== "casa") params.set("filtro", state.filtro);
  if (state.mese) params.set("mese", state.mese);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  if (opts.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

function leggiUrl() {
  const p = new URLSearchParams(window.location.search);
  state.filtro = p.get("filtro") === "tutte" ? "tutte" : "casa";
  state.mese = /^\d{4}-\d{2}$/.test(p.get("mese") || "") ? p.get("mese") : "";
  $("#filtro-casa").setAttribute("aria-pressed", String(state.filtro === "casa"));
  $("#filtro-tutte").setAttribute("aria-pressed", String(state.filtro === "tutte"));
}

function bind() {
  $("#filtro-casa").addEventListener("click", () => setFiltro("casa"));
  $("#filtro-tutte").addEventListener("click", () => setFiltro("tutte"));
  $("#torna-mesi").addEventListener("click", mostraMesi);
  $("#mesi-grid").addEventListener("click", (e) => {
    const card = e.target.closest("[data-mese]");
    if (card) apriMese(card.dataset.mese);
  });
  window.addEventListener("popstate", () => {
    leggiUrl();
    if (state.mese) apriMese(state.mese);
    else mostraMesi();
  });
}

// --------------------------------------------------------------------- avvisi

// Se il foglio non si legge, lo si dice invece di mostrare turni vuoti come se
// non ci fosse nulla da fare.
function mostraAvvisoFoglio(motivo) {
  const el = $("#dir-banner");
  if (!el) return;
  el.hidden = false;
  el.className = "dir-banner dir-banner-errore";
  el.querySelector(".dir-banner-testo").textContent =
    `Turni non aggiornati dal foglio (${motivo}). Sto mostrando i turni salvati nel file.`;
  el.querySelector(".dir-banner-btn")?.remove();
}

// Turni scritti nel foglio che non corrispondono a nessuna partita: quasi sempre
// un nome squadra o una data diversi da schedule.json. Meglio dirlo che far
// sparire il turno senza spiegazioni.
function mostraTurniOrfani(orfani) {
  const el = $("#turni-nota");
  if (!el) return;
  const elenco = orfani
    .map((o) => `${o.data} ${o.casa} - ${o.trasferta}`)
    .join("; ");
  el.textContent =
    `${orfani.length === 1 ? "1 turno del foglio non trova la partita" : `${orfani.length} turni del foglio non trovano la partita`}` +
    ` (${elenco}). Controlla data e nomi squadra.`;
  el.classList.add("turni-nota-avviso");
}

// Nota discreta sull'origine dei turni, per capire se i dati sono live.
function aggiornaNotaTurni() {
  const el = $("#turni-nota");
  if (!el) return;
  if (!state.config.foglio.id) {
    el.textContent = "Turni letti da data/turni.json.";
    return;
  }
  el.textContent =
    state.origineTurni === "foglio"
      ? "Turni in tempo reale dal Google Sheet."
      : "Turni letti da data/turni.json.";
}

// ----------------------------------------------------------------------- init

function renderHeader() {
  const doc = state.competitions[0]?._doc;
  if (doc) {
    if (doc.societa) $("#societa").textContent = doc.societa;
    if (doc.stagione) $("#stagione").textContent = doc.stagione;
    const g = doc.generato_il ? parseDate(doc.generato_il.slice(0, 19)) : null;
    $("#updated").textContent = g
      ? `Dati aggiornati: ${new Intl.DateTimeFormat("it-IT", {
          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
        }).format(g)}`
      : "";
  }
}

async function init() {
  bind();
  leggiUrl();

  try {
    const [schedule, cfg, turni] = await Promise.all([
      loadJson(DATA_URL, "calendario"),
      loadJson(CONFIG_URL, "configurazione").catch(() => ({})),
      loadJson(TURNI_URL, "turni").catch(() => ({ turni: [] })),
    ]);

    state.config = leggiConfig(cfg);
    state.turni = leggiTurni(turni);
    state.competitions = (schedule.competitions || []).map((c) => ({ ...c, _doc: schedule }));
    renderHeader();

    // Prima il foglio (live, senza commit). Se non risponde si usa il file, che
    // resta come rete di sicurezza quando Google e' giu' o il foglio torna privato.
    let origine = "file";
    let orfani = [];
    if (state.config.foglio.id) {
      try {
        const daFoglio = await caricaTurniDaFoglio(state.config.foglio);
        if (daFoglio) {
          const esito = riallineaTurni(daFoglio, tutteLePartite());
          state.turni = esito.allineati;
          orfani = esito.orfani;
          origine = "foglio";
        }
      } catch (err) {
        console.warn("Foglio turni non leggibile, uso data/turni.json:", err.message);
        mostraAvvisoFoglio(err.message);
      }
    }
    state.origineTurni = origine;
    aggiornaNotaTurni();
    if (orfani.length) mostraTurniOrfani(orfani);

    if (state.mese) apriMese(state.mese);
    else mostraMesi();
  } catch (err) {
    $("#dir-empty").hidden = false;
    $("#dir-empty").textContent = `Impossibile caricare i dati (${err.message}).`;
  }
}

init();
