// Lettura dal vivo dei campionati ASI, direttamente dal browser.
//
// L'API `campionati/api/public.php` di Spike Volley e' pubblica (nessun login)
// e manda `access-control-allow-origin` per qualunque origine, quindi il fetch
// cross-origin funziona da GitHub Pages senza proxy. Verificato: e' lo stesso
// backend (`tuttoincodice.com/livescore`) che l'importer usa come riserva FIPAV.
//
// Se qualcosa fallisce il chiamante usa lo snapshot salvato in schedule.json.

const API = "https://www.spikevolley.it/campionati/api/public.php";
const TEAM_LOGO_BASE = "https://www.spikevolley.it/campionati/";

const GIOCATA = "completed";
const ANNULLATA = "cancelled";

async function getJson(params, signal) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}?${qs}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body || body.success !== true) {
    throw new Error(body && body.message ? body.message : "risposta non valida");
  }
  return body.data || [];
}

function parziali(m) {
  const out = [];
  for (let i = 1; i <= 5; i += 1) {
    const a = m[`set${i}_score1`];
    const b = m[`set${i}_score2`];
    if (a || b) out.push(`${a}-${b}`);
  }
  return out.join(" ");
}

// Stessa separazione palestra/indirizzo dell'importer Python: l'API usa sia
// "NOME - INDIRIZZO" sia "NOME (INDIRIZZO)", a volte mescolati.
function parenToDash(value) {
  if (!value.endsWith(")")) return value;
  let depth = 0;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    if (value[i] === ")") depth += 1;
    else if (value[i] === "(") {
      depth -= 1;
      if (depth === 0) {
        const head = value.slice(0, i).trim();
        const inner = value.slice(i + 1, -1).trim();
        return head && inner ? `${head} - ${inner}` : value;
      }
    }
  }
  return value;
}

function parenSplit(value) {
  if (!value.endsWith(")")) return [value, ""];
  let depth = 0;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    if (value[i] === ")") depth += 1;
    else if (value[i] === "(") {
      depth -= 1;
      if (depth === 0) return [value.slice(0, i).trim(), value.slice(i + 1, -1).trim()];
    }
  }
  return [value, ""];
}

function splitCourt(court) {
  const value = (court || "").trim();
  let depth = 0;
  for (let i = 0; i < value.length - 2; i += 1) {
    const ch = value[i];
    if (ch === '"') depth ^= 1;
    else if (depth === 0 && value.slice(i, i + 3) === " - ") {
      return [value.slice(0, i).trim(), parenToDash(value.slice(i + 3).trim())];
    }
  }
  return parenSplit(value);
}

function logoUrl(path) {
  if (!path) return "";
  return path.startsWith("http") ? path : TEAM_LOGO_BASE + path.replace(/^\/+/, "");
}

// Trasforma una partita dell'API nel formato usato da schedule.json.
// Le annullate arrivano con score 0-0: non e' un risultato, quindi resta vuoto.
function toMatch(m) {
  const stato = String(m.status || "").toLowerCase();
  const giocata = stato === GIOCATA;
  const [palestra, indirizzo] = splitCourt(m.court || "");
  return {
    gara: String(m.id || ""),
    giornata: String(m.round || ""),
    data: `${m.match_date || ""} ${m.match_time || ""}`.trim(),
    casa: (m.team1_name || "").trim(),
    trasferta: (m.team2_name || "").trim(),
    risultato: giocata ? `${m.score1} - ${m.score2}` : "",
    parziali: giocata ? parziali(m) : "",
    palestra,
    indirizzo,
    stato: stato || "pending",
    logo_casa: logoUrl(m.team1_logo),
    logo_trasferta: logoUrl(m.team2_logo),
  };
}

// Classifica calcolata dai risultati: 3-0/3-1 = 3 punti, 3-2 = 2, 2-3 = 1.
// Le annullate non hanno risultato e quindi non entrano.
function calcolaClassifica(matches) {
  const stats = new Map();
  const riga = (sq) => {
    if (!stats.has(sq)) {
      stats.set(sq, { squadra: sq, punti: 0, pg: 0, pv: 0, pp: 0, sf: 0, ss: 0 });
    }
    return stats.get(sq);
  };
  for (const m of matches) {
    riga(m.casa);
    riga(m.trasferta);
    const parts = (m.risultato || "").split(/\s*[-–]\s*/);
    if (parts.length !== 2) continue;
    const s1 = Number(parts[0]);
    const s2 = Number(parts[1]);
    if (!Number.isFinite(s1) || !Number.isFinite(s2)) continue;
    const punti = (vinti, persi) => {
      if (vinti === 3 && persi <= 1) return 3;
      if (vinti === 3) return 2;
      if (vinti === 2 && persi === 3) return 1;
      return 0;
    };
    for (const [sq, pti, vinto, sf, ss] of [
      [m.casa, punti(s1, s2), s1 > s2, s1, s2],
      [m.trasferta, punti(s2, s1), s2 > s1, s2, s1],
    ]) {
      const r = riga(sq);
      r.punti += pti;
      r.pg += 1;
      r[vinto ? "pv" : "pp"] += 1;
      r.sf += sf;
      r.ss += ss;
    }
  }
  const qs = (r) => (r.ss ? r.sf / r.ss : r.sf);
  return [...stats.values()].sort((a, b) => b.punti - a.punti || qs(b) - qs(a));
}

// Scarica i campionati ASI indicati in `asi.tornei` (id configurato -> id API),
// tenendo solo quelli che hanno davvero partite.
export async function fetchLiveAsi(asi, timeoutMs = 20000) {
  const tornei = (asi && asi.tornei) || [];
  if (!tornei.length) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const out = await Promise.all(
      tornei.map(async ({ id, tournament_id: tid, titolo }) => {
        try {
          const partite = await getJson(
            { action: "partite", tournament_id: tid },
            controller.signal
          );
          if (!partite.length) return null;
          const matches = partite.map(toMatch);
          return {
            id,
            titolo: titolo || id,
            matches,
            standings: calcolaClassifica(matches),
          };
        } catch {
          return null;
        }
      })
    );
    return out.filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}
