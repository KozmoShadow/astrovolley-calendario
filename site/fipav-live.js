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
  if (!titleAttr) return { palestra: "", impianto: "", parziali: "" };
  const txt = decodeEntities(titleAttr);
  const b = /<b>([\s\S]*?)<\/b>/i.exec(txt);
  const palestra = b ? stripTags(b[1]) : "";
  let full = txt.split(/PARZIALI:|Arbitro designato/)[0];
  full = stripTags(full.replace("IMPIANTO DI GARA:", ""));
  const parziali = matchAll(txt, /class="parziali">([^<]*)<\/span>/gi)
    .map((m) => m[1].trim())
    .filter(Boolean)
    .join(" ");
  return { palestra, impianto: full, parziali };
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
    let parziali = "";
    if (cells.length >= 7) {
      const info = /title="(IMPIANTO DI GARA:[\s\S]*?)"/i.exec(cells[6]);
      if (info) ({ palestra, impianto, parziali } = parseImpianto(info[1]));
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

// FIPAV rileva il dispositivo dallo User-Agent: ai telefoni risponde con un
// redirect 302 verso /mobile/, che non contiene le tabelle. Il browser mobile
// non puo' cambiare il proprio User-Agent, quindi questa pagina non e' leggibile
// dal vivo da telefono. Si tenta comunque (per il desktop funziona) e in caso di
// fallimento si usa lo snapshot. Le pagine /mobile/ non sono un'alternativa: non
// riportano le date delle partite.

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
