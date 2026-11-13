// Lettura dal vivo del sito ufficiale FIPAV Napoli, direttamente dal browser.
// Il sito FIPAV espone access-control-allow-origin: *, quindi il fetch cross-origin
// funziona senza proxy. Se qualcosa fallisce, il chiamante usa lo snapshot salvato.

const FIPAV_UA_NOTE = "richiede un browser reale (User-Agent) per rispondere";

function stripTags(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s) {
  const el = document.createElement("textarea");
  el.innerHTML = s;
  return el.value;
}

function matchAll(html, re) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(html)) !== null) out.push(m);
  return out;
}

function cellTexts(rowHtml) {
  return matchAll(rowHtml, /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi).map((m) => m[1]);
}

function rowHtmls(tableHtml) {
  return matchAll(tableHtml, /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi).map((m) => m[1]);
}

function tableHtmls(page) {
  return matchAll(page, /<table\b[\s\S]*?<\/table>/gi).map((m) => m[0]);
}

function absolute(base, url) {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return base.replace(/\/$/, "") + url;
  return url;
}

function parseFipavDate(value) {
  const m = /(\d{2})\/(\d{2})\/(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(value || "");
  if (!m) return "";
  const [, dd, mm, yy, hh, min] = m;
  const year = 2000 + parseInt(yy, 10);
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  let stamp = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (hh !== undefined) stamp += ` ${String(parseInt(hh, 10)).padStart(2, "0")}:${min}`;
  return stamp;
}

function parseImpianto(titleAttr) {
  if (!titleAttr) return { palestra: "", impianto: "", indirizzo: "", parziali: "" };
  const txt = decodeEntities(titleAttr);
  const b = /<b>([\s\S]*?)<\/b>/i.exec(txt);
  const palestra = b ? stripTags(b[1]) : "";
  const corpo = txt.split(/PARZIALI:|Arbitro designato/)[0].replace("IMPIANTO DI GARA:", "");
  const full = stripTags(corpo);
  // L'impianto e' palestra + citta' + via: per l'indirizzo si prendono le righe
  // dopo la palestra, con la via prima della citta' ("VIA X, CITTA' NA").
  const righe = corpo
    .replace(/<b>[\s\S]*?<\/b>/i, "")
    .split(/<br\s*\/?>/i)
    .map(stripTags)
    .filter(Boolean);
  const indirizzo = righe.length >= 2 ? righe.slice().reverse().join(", ") : righe[0] || "";
  const parziali = matchAll(txt, /class="parziali">([^<]*)<\/span>/gi)
    .map((m) => m[1].trim())
    .filter(Boolean)
    .join(" ");
  return { palestra, impianto: full, indirizzo, parziali };
}

function teamFromCell(cell, base) {
  const src = /src="([^"]+)"/i.exec(cell);
  return {
    name: stripTags(cell),
    logo: src ? absolute(base, decodeEntities(src[1])) : "",
  };
}

function parseMatches(tableHtml, base) {
  const matches = [];
  for (const row of rowHtmls(tableHtml)) {
    const cells = cellTexts(row);
    if (cells.length < 6) continue;
    const data = parseFipavDate(stripTags(cells[2]));
    if (!data) continue;
    const casa = teamFromCell(cells[3], base);
    const trasferta = teamFromCell(cells[4], base);
    let risultato = stripTags(cells[5]);
    if (risultato === "-") risultato = "";
    let palestra = "";
    let impianto = "";
    let indirizzo = "";
    let parziali = "";
    if (cells.length >= 7) {
      // La cella info ha due title: lo stato gara ("da disputare ...") e
      // l'impianto, che e' l'unico con <b>palestra</b>. Il prefisso
      // "IMPIANTO DI GARA:" compare solo per le gare giocate, quindi non si
      // puo' cercare quello: le gare future hanno l'impianto senza prefisso.
      const titles = matchAll(cells[6], /title="([\s\S]*?)"/gi).map((m) => m[1]);
      const impiantoTitle = titles.find((t) => /<b>|<p>/i.test(decodeEntities(t)));
      if (impiantoTitle) ({ palestra, impianto, indirizzo, parziali } = parseImpianto(impiantoTitle));
    }
    matches.push({
      data,
      giornata: stripTags(cells[1]),
      casa: casa.name,
      trasferta: trasferta.name,
      risultato,
      parziali,
      palestra,
      impianto,
      indirizzo,
      logo_casa: casa.logo,
      logo_trasferta: trasferta.logo,
    });
  }
  return matches;
}

function asInt(value) {
  const m = /-?\d+/.exec(stripTags(value));
  return m ? parseInt(m[0], 10) : 0;
}

function parseStandings(page) {
  for (const table of tableHtmls(page)) {
    if (!table.includes("Squadra") || !table.includes("Punti") || table.includes("Squadra casa"))
      continue;
    const rows = [];
    for (const row of rowHtmls(table)) {
      const cells = cellTexts(row);
      if (cells.length < 8) continue;
      const squadra = stripTags(cells[1]);
      if (!squadra || squadra.toLowerCase() === "squadra") continue;
      rows.push({
        squadra,
        punti: asInt(cells[2]),
        pg: asInt(cells[3]),
        pv: asInt(cells[4]),
        pp: asInt(cells[5]),
        sf: asInt(cells[6]),
        ss: asInt(cells[7]),
        pf: cells.length > 9 ? asInt(cells[9]) : 0,
        ps: cells.length > 10 ? asInt(cells[10]) : 0,
      });
    }
    if (rows.length) return rows;
  }
  return [];
}

function societyUrl(live) {
  const q = new URLSearchParams({
    PId: live.pid,
    StId: live.stagione_id,
    CId: "",
    SId: live.societa_id,
    StatoGara: "",
    DataDa: "",
    ComitatoId: live.comitato_id,
    btFiltro: "CERCA",
  });
  return `${live.base_url.replace(/\/$/, "")}/risultati-classifiche.aspx?${q}`;
}

function championshipUrl(live, cid) {
  const q = new URLSearchParams({
    PId: live.pid,
    StId: live.stagione_id,
    CId: cid,
    SId: "",
    StatoGara: "",
    DataDa: "",
    ComitatoId: live.comitato_id,
    btFiltro: "CERCA",
  });
  return `${live.base_url.replace(/\/$/, "")}/risultati-classifiche.aspx?${q}`;
}

// ---------------------------------------------------------------- mobile
// FIPAV rileva il dispositivo dallo User-Agent: ai telefoni risponde con un
// redirect 302 verso /mobile/. Il browser mobile non puo' cambiare il proprio
// User-Agent, quindi la pagina desktop non e' leggibile dal vivo da telefono.
// La versione /mobile/ invece ha CORS aperto, ma struttura diversa: l'elenco
// non riporta le date, percio' serve una richiesta per partita (il dettaglio)
// per avere data, ora, parziali e impianto.

function mobileUrl(live, cid) {
  return `${live.base_url.replace(/\/$/, "")}/mobile/risultati.asp?CampionatoId=${encodeURIComponent(cid)}`;
}

function mobileDetailUrl(live, cid, gid) {
  return `${mobileUrl(live, cid)}&GaraId=${encodeURIComponent(gid)}`;
}

function mobileStandingsUrl(live, cid) {
  return `${mobileUrl(live, cid)}&vis=classifica`;
}

// Elenco partite: ogni gruppo e' preceduto da <div class="divGiornata">Giornata N</div>.
function parseMobileList(page) {
  const out = [];
  const chunks = page.split(/<div class="divGiornata"[^>]*>([\s\S]*?)<\/div>/i);
  // chunks = [prima, "Giornata 1", blocco1, "Giornata 2", blocco2, ...]
  for (let i = 1; i < chunks.length; i += 2) {
    const giornata = stripTags(chunks[i]).replace(/^giornata\s*/i, "").trim();
    const block = chunks[i + 1] || "";
    const re = /<a\b[^>]*href="([^"]*GaraId=(\d+))"[^>]*class="gara"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of matchAll(block, re)) {
      const body = m[3];
      const nome = (cls) => {
        const r = new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)<div class="set`, "i").exec(body);
        return r ? stripTags(r[1]) : "";
      };
      const set = (cls) => {
        const r = new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</div>`, "i").exec(body);
        return r ? stripTags(r[1]) : "";
      };
      out.push({
        gara_id: m[2],
        giornata,
        casa: nome("squadraCasa"),
        trasferta: nome("squadraOspite"),
        set_casa: set("setCasa"),
        set_ospite: set("setOspite"),
      });
    }
  }
  return out;
}

// Dettaglio gara: data, ora, parziali e impianto. Le gare non ancora disputate
// non hanno i blocchi risultatoCasa/risultatoOspite ("da disputare").
function parseMobileDetail(page) {
  const txt = stripTags(page);
  const dt = /(\d{2})\/(\d{2})\/(\d{4})\s+ore\s+(\d{1,2}):(\d{2})/.exec(txt);
  const data = dt
    ? `${dt[3]}-${dt[2]}-${dt[1]} ${String(parseInt(dt[4], 10)).padStart(2, "0")}:${dt[5]}`
    : "";

  const block = (startId, endRe) => {
    const r = new RegExp(`id="${startId}"[^>]*>([\\s\\S]*?)${endRe}`, "i").exec(page);
    return r ? r[1] : "";
  };
  const parz = (html) =>
    matchAll(html, /class="parziale"[^>]*>([^<]*)</gi).map((m) => stripTags(m[1])).filter(Boolean);
  const setDi = (html) => {
    const m = /class="set[^"]*"[^>]*>([^<]*)</i.exec(html);
    return m ? stripTags(m[1]) : "";
  };

  const casaHtml = block("risultatoCasa", '<div id="risultatoOspite"');
  const ospHtml = block("risultatoOspite", '<div class="squadraOspite"');
  const setCasa = casaHtml ? setDi(casaHtml) : "";
  const setOspite = ospHtml ? setDi(ospHtml) : "";
  const risultato = setCasa && setOspite ? `${setCasa} - ${setOspite}` : "";
  const pc = parz(casaHtml);
  const po = parz(ospHtml);
  const parziali = pc.map((v, i) => (po[i] ? `${v}-${po[i]}` : v)).join(" ");

  let palestra = "";
  let indirizzo = "";
  let impianto = "";
  let mappa = "";
  // La pagina mobile non ha <b>, quindi la palestra e' sulla prima riga e la
  // via sulle successive. Il link a Google Maps (con coordinate, se note) e'
  // nell'ancora attorno al riquadro dell'impianto.
  const anc = /<a[^>]*class="nodecoration"[^>]*href="([^"]+)"[^>]*>\s*<div class="divImpianto"[^>]*>([\s\S]*?)<\/div>/i.exec(page);
  const impHtml = anc ? anc[2] : ((/class="divImpianto"[^>]*>([\s\S]*?)<\/div>/i.exec(page) || [])[1] || "");
  if (anc) mappa = decodeEntities(anc[1]);
  if (impHtml) {
    const raw = impHtml.replace(/<img[^>]*>/gi, " ");
    const righe = raw.split(/<br\s*\/?>/i).map(stripTags).filter(Boolean);
    palestra = righe[0] || "";
    indirizzo = righe.slice(1).join(", ");
    impianto = stripTags(raw);
  }
  return { data, risultato, parziali, palestra, indirizzo, impianto, mappa };
}

function parseMobileStandings(page) {
  const table = tableHtmls(page).find((t) => t.includes("tabellaClassifica"));
  if (!table) return [];
  const rows = [];
  for (const row of rowHtmls(table)) {
    const cella = (cls) => {
      const m = new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</td>`, "i").exec(row);
      return m ? stripTags(m[1]) : "";
    };
    const squadra = cella("claSquadra");
    if (!squadra) continue;
    rows.push({
      squadra,
      punti: asInt(cella("claPunti")),
      pg: asInt(cella("claGareGiocate")),
      pv: asInt(cella("claGareVinte")),
      pp: asInt(cella("claGarePerse")),
      sf: asInt(cella("claSetFatti")),
      ss: asInt(cella("claSetSubiti")),
      pf: asInt(cella("claPuntiFatti")),
      ps: asInt(cella("claPuntiSubiti")),
    });
  }
  return rows;
}

// Esegue le richieste con concorrenza limitata, per non sommergere il server.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Legge dal vivo le competizioni FIPAV passando dalla versione mobile.
// `cids` sono i campionati noti dallo snapshot: { campionato_id, titolo }.
export async function fetchLiveFipavMobile(live, cids, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const getText = async (url) => {
    const r = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  };
  try {
    const competitions = [];
    for (const { campionato_id: cid, titolo } of cids) {
      const listPage = await getText(mobileUrl(live, cid));
      const entries = parseMobileList(listPage);
      if (!entries.length) throw new Error(`elenco vuoto per il campionato ${cid}`);
      const matches = await mapLimit(entries, 8, async (e) => {
        let det = {};
        try {
          det = parseMobileDetail(await getText(mobileDetailUrl(live, cid, e.gara_id)));
        } catch {
          /* senza dettaglio la partita resta senza data/ora */
        }
        return {
          data: det.data || "",
          giornata: e.giornata,
          casa: e.casa,
          trasferta: e.trasferta,
          risultato: det.risultato || (e.set_casa && e.set_ospite ? `${e.set_casa} - ${e.set_ospite}` : ""),
          parziali: det.parziali || "",
          palestra: det.palestra || "",
          indirizzo: det.indirizzo || "",
          impianto: det.impianto || "",
          mappa: det.mappa || "",
          logo_casa: "",
          logo_trasferta: "",
        };
      });
      let standings = [];
      try {
        standings = parseMobileStandings(await getText(mobileStandingsUrl(live, cid)));
      } catch {
        /* classifica non disponibile: si prosegue */
      }
      competitions.push({ campionato_id: cid, titolo, matches, standings });
    }
    return competitions;
  } finally {
    clearTimeout(timer);
  }
}

// Scarica dal vivo calendario e classifiche di tutte le competizioni FIPAV.
export async function fetchLiveFipav(live, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(societyUrl(live), { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const page = await res.text();
    const base = live.base_url;

    const competitions = [];
    for (const table of tableHtmls(page)) {
      if (!table.includes("Squadra casa")) continue;
      const cap = /<caption>([\s\S]*?)<\/caption>/i.exec(table);
      const titolo = cap ? stripTags(cap[1]) : "";
      const cidMatch = /classifica\.aspx\?CId=(\d+)/i.exec(table);
      const cid = cidMatch ? cidMatch[1] : "";
      competitions.push({ campionato_id: cid, titolo, matches: parseMatches(table, base) });
    }
    if (!competitions.length) throw new Error("nessuna tabella partite (probabile redirect mobile)");

    // Per ogni campionato si scarica il girone completo (tutte le partite,
    // non solo le nostre) insieme alla classifica. In parallelo.
    await Promise.all(
      competitions.map(async (comp) => {
        comp.standings = [];
        if (!comp.campionato_id) return;
        try {
          const r = await fetch(championshipUrl(live, comp.campionato_id), {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!r.ok) return;
          const champPage = await r.text();
          const full = tableHtmls(champPage).find((t) => t.includes("Squadra casa"));
          if (full) comp.matches = parseMatches(full, base);
          comp.standings = parseStandings(champPage);
        } catch {
          /* si tiene quanto gia' letto (pagina societa') */
        }
      })
    );
    return competitions;
  } finally {
    clearTimeout(timer);
  }
}
