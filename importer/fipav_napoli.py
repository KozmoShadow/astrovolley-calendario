"""Lettura di calendario e classifiche dal sito ufficiale FIPAV Napoli.

La pagina pubblica `risultati-classifiche.aspx` elenca, per una data societa',
tutte le partite di tutti i campionati in cui compare, raggruppate per
campionato (un <table> con <caption> per ciascuno). Ogni sezione contiene anche
la classifica, quindi basta una richiesta per avere tutto.

Questi dati sono la fonte ufficiale e sono piu' aggiornati del backend Spike.
"""

from __future__ import annotations

import html
import re
import urllib.parse
import urllib.request
from datetime import datetime

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
}


def build_society_url(base: str, pid: str, stagione_id: str, comitato_id: str, societa_id: str) -> str:
    params = {
        "PId": pid,
        "StId": stagione_id,
        "CId": "",
        "SId": societa_id,
        "StatoGara": "",
        "DataDa": "",
        "ComitatoId": comitato_id,
        "btFiltro": "CERCA",
    }
    return f"{base.rstrip('/')}/risultati-classifiche.aspx?{urllib.parse.urlencode(params)}"


def build_championship_url(
    base: str, pid: str, stagione_id: str, comitato_id: str, campionato_id: str
) -> str:
    params = {
        "PId": pid,
        "StId": stagione_id,
        "CId": campionato_id,
        "SId": "",
        "StatoGara": "",
        "DataDa": "",
        "ComitatoId": comitato_id,
        "btFiltro": "CERCA",
    }
    return f"{base.rstrip('/')}/risultati-classifiche.aspx?{urllib.parse.urlencode(params)}"


def fetch(url: str, timeout: int = 40) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


# ---------------------------------------------------------------- utilità HTML


def _strip_tags(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def _cells(row_html: str) -> list[str]:
    return re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", row_html, re.S | re.I)


def _rows(table_html: str) -> list[str]:
    return re.findall(r"<tr\b[^>]*>(.*?)</tr>", table_html, re.S | re.I)


def _absolute(base: str, url: str) -> str:
    if not url:
        return ""
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return base.rstrip("/") + url
    return url


def parse_fipav_date(value: str) -> str:
    """Converte '12/11/26 21:30' in '2026-11-12 21:30'. Ritorna '' se non valida."""
    value = (value or "").strip()
    m = re.match(r"(\d{2})/(\d{2})/(\d{2})(?:\s+(\d{1,2}):(\d{2}))?", value)
    if not m:
        return ""
    day, month, year, hh, mm = m.groups()
    year = 2000 + int(year)
    try:
        dt = datetime(year, int(month), int(day))
    except ValueError:
        return ""
    stamp = dt.strftime("%Y-%m-%d")
    if hh is not None:
        stamp += f" {int(hh):02d}:{mm}"
    return stamp


def _parse_impianto(title_attr: str) -> tuple[str, str, str]:
    """Dal title dell'icona info estrae (palestra, impianto completo, parziali)."""
    if not title_attr:
        return "", "", ""
    txt = html.unescape(title_attr)
    name = ""
    m = re.search(r"<b>(.*?)</b>", txt, re.S | re.I)
    if m:
        name = _strip_tags(m.group(1))
    # impianto completo: tutto il testo fino a "PARZIALI" o "Arbitro"
    full = re.split(r"PARZIALI:|Arbitro designato", txt)[0]
    full = _strip_tags(re.sub(r"IMPIANTO DI GARA:", "", full))
    parziali = re.findall(r'class="parziali">([^<]*)</span>', txt)
    return name, full, " ".join(p.strip() for p in parziali if p.strip())


def _team_from_cell(cell: str, base: str) -> tuple[str, str]:
    logo = ""
    m = re.search(r'src="([^"]+)"', cell)
    if m:
        logo = _absolute(base, html.unescape(m.group(1)))
    name = _strip_tags(cell)
    return name, logo


# ------------------------------------------------------------------ parser


def parse_competitions(page_html: str, base: str) -> list[dict]:
    """Estrae le competizioni (una per <table class="tbl-risultati">)."""
    competitions: list[dict] = []
    for table in re.findall(r"<table\b.*?</table>", page_html, re.S | re.I):
        if "Squadra casa" not in table:
            continue
        cap = re.search(r"<caption>(.*?)</caption>", table, re.S | re.I)
        titolo = _strip_tags(cap.group(1)) if cap else ""
        cid_match = re.search(r"classifica\.aspx\?CId=(\d+)", table)
        cid = cid_match.group(1) if cid_match else ""
        matches = parse_matches(table, base)
        competitions.append({"campionato_id": cid, "titolo": titolo, "matches": matches})
    return competitions


def parse_matches(table_html: str, base: str) -> list[dict]:
    matches: list[dict] = []
    for row in _rows(table_html):
        cells = _cells(row)
        if len(cells) < 6:
            continue
        data = parse_fipav_date(_strip_tags(cells[2]))
        if not data:
            continue
        casa, logo_casa = _team_from_cell(cells[3], base)
        trasferta, logo_trasf = _team_from_cell(cells[4], base)
        risultato = _strip_tags(cells[5])
        if risultato in ("-", ""):
            risultato = ""
        palestra = impianto = parziali = ""
        if len(cells) >= 7:
            info = re.search(r'title="(IMPIANTO DI GARA:.*?)"', cells[6], re.S)
            if info:
                palestra, impianto, parziali = _parse_impianto(info.group(1))
        matches.append(
            {
                "data": data,
                "giornata": _strip_tags(cells[1]),
                "casa": casa,
                "trasferta": trasferta,
                "risultato": risultato,
                "parziali": parziali,
                "palestra": palestra,
                "impianto": impianto,
                "logo_casa": logo_casa,
                "logo_trasferta": logo_trasf,
            }
        )
    return matches


def parse_standings(page_html: str) -> list[dict]:
    """Estrae la classifica da una pagina che ne contiene una (ultima tabella)."""
    for table in re.findall(r"<table\b.*?</table>", page_html, re.S | re.I):
        if "Squadra" not in table or "Punti" not in table or "Squadra casa" in table:
            continue
        standings: list[dict] = []
        for row in _rows(table):
            cells = _cells(row)
            if len(cells) < 8:
                continue
            squadra = _strip_tags(cells[1])
            if not squadra or squadra.lower() == "squadra":
                continue
            standings.append(
                {
                    "squadra": squadra,
                    "punti": _as_int(cells[2]),
                    "pg": _as_int(cells[3]),
                    "pv": _as_int(cells[4]),
                    "pp": _as_int(cells[5]),
                    "sf": _as_int(cells[6]),
                    "ss": _as_int(cells[7]),
                    "pf": _as_int(cells[9]) if len(cells) > 9 else 0,
                    "ps": _as_int(cells[10]) if len(cells) > 10 else 0,
                }
            )
        if standings:
            return standings
    return []


def _as_int(value: str) -> int:
    m = re.search(r"-?\d+", _strip_tags(value))
    return int(m.group(0)) if m else 0


def fetch_competitions(config: dict) -> list[dict]:
    """Scarica calendario completo + classifica di tutte le competizioni FIPAV.

    Passo 1: la pagina della societa' elenca i campionati in cui compare
    (titolo + CId). Passo 2: per ciascuno si scarica la pagina del girone
    completo, che contiene tutte le partite e la classifica.
    """
    base = config["base_url"]
    timeout = config.get("timeout", 40)
    society = fetch(
        build_society_url(
            base,
            config["pid"],
            config["stagione_id"],
            config["comitato_id"],
            config["societa_id"],
        ),
        timeout,
    )
    found = parse_competitions(society, base)

    out: list[dict] = []
    for comp in found:
        cid = comp["campionato_id"]
        titolo = comp["titolo"]
        matches = comp["matches"]
        standings: list[dict] = []
        if cid:
            try:
                page = fetch(
                    build_championship_url(
                        base, config["pid"], config["stagione_id"], config["comitato_id"], cid
                    ),
                    timeout,
                )
                full = parse_competitions(page, base)
                if full:
                    matches = full[0]["matches"]
                standings = parse_standings(page)
            except Exception:  # noqa: BLE001 - si tiene quanto gia' letto
                pass
        out.append(
            {
                "id": f"fipav-{cid}" if cid else f"fipav-{titolo}",
                "titolo": titolo,
                "fonte": "fipav",
                "categoria": "FIPAV",
                "comitato": config.get("comitato_nome", ""),
                "campionato_id": cid,
                "matches": [
                    {
                        "fonte": "fipav",
                        "campionato_id": cid,
                        "campionato": titolo,
                        "girone": titolo,
                        **m,
                    }
                    for m in matches
                ],
                "standings": standings,
            }
        )
    return out
