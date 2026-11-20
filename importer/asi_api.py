"""Calendario, risultati e classifica ASI letti dall'API pubblica di Spike Volley.

Sostituisce la lettura del PDF (`asi_pdf.py`) per i campionati ASI. L'API
`campionati/api/public.php` e' pubblica (nessun login), espone
`access-control-allow-origin` per qualunque origine, ed e' lo stesso backend
(`tuttoincodice.com/livescore`) che `import_schedule.py` usa gia' come riserva
per il FIPAV.

Endpoint usati:
    ?action=campionati&committee_id=<id>          -> elenco campionati del comitato
    ?action=partite&tournament_id=<id>            -> tutte le partite, con risultato
    ?action=classifica&tournament_id=<id>         -> classifica (usata solo per verifica)

Non esiste un filtro per societa': si scaricano i campionati del comitato e si
tengono quelli in cui compare una squadra nostra (come fa `scan_comitato` per
il FIPAV). Le squadre nostre arrivano da `site/data/squadre.json`, la stessa
fonte che usa il sito per i link `?squadra=`.

Uso:
    python importer/asi_api.py                # tutti i campionati del comitato
    python importer/asi_api.py --dry-run      # non scrive nulla, stampa e basta
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

API_BASE = "https://www.spikevolley.it/campionati/api/public.php"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (AstrovolleySchedule/1.0)",
    "Referer": "https://www.spikevolley.it/",
}

# Stati restituiti dall'API. `cancelled` porta score 0-0: se non lo si tratta a
# parte diventa una partita vera e sfalsa la classifica.
STATO_GIOCATA = "completed"
STATO_ANNULLATA = "cancelled"
STATO_RINVIATA = "postponed"


def _norm(value: str) -> str:
    """Minuscolo senza accenti: 'Volley World' == 'VOLLEY WORLD'."""
    s = unicodedata.normalize("NFD", (value or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn").strip()


def _get(params: dict, timeout: int = 40) -> dict:
    url = f"{API_BASE}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    data = json.loads(body)
    if not data.get("success"):
        raise RuntimeError(f"API ha risposto con errore: {data.get('message')} ({url})")
    return data


def _slug(value: str) -> str:
    """'Open Misto Élite - Girone Unico' -> 'open-misto-elite-girone-unico'."""
    s = _norm(value)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def _parziali(m: dict) -> str:
    """set1_score1..set5 -> '22-25 10-25 21-25'. Solo i set giocati."""
    out = []
    for i in range(1, 6):
        a = m.get(f"set{i}_score1")
        b = m.get(f"set{i}_score2")
        if a or b:
            out.append(f"{a}-{b}")
    return " ".join(out)


def _split_court(court: str) -> tuple[str, str]:
    """'IC "Custra" - Via Modigliani, 1, Cercola' -> (palestra, indirizzo).

    L'API usa due forme, a volte mescolate nella stessa partita:
        NOME - INDIRIZZO
        NOME (INDIRIZZO)
        NOME - Plesso X (INDIRIZZO)
    Il separatore e' il primo " - " **fuori dalle virgolette**: alcune palestre
    hanno un trattino nel nome (es. SMS "Illuminato - Cirino"). L'indirizzo tra
    parentesi viene riportato nella forma con il trattino, cosi' il sito mostra
    sempre lo stesso formato.
    """
    value = (court or "").strip()
    depth = 0
    for i in range(len(value) - 2):
        ch = value[i]
        if ch == '"':
            depth ^= 1
        elif depth == 0 and value[i : i + 3] == " - ":
            return value[:i].strip(), _paren_to_dash(value[i + 3 :].strip())
    return _paren_split(value)


def _paren_split(value: str) -> tuple[str, str]:
    """'NOME (INDIRIZZO)' -> (NOME, INDIRIZZO). Solo se la parentesi chiude in fondo."""
    if not value.endswith(")"):
        return value, ""
    depth = 0
    for i in range(len(value) - 1, -1, -1):
        ch = value[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                return value[:i].strip(), value[i + 1 : -1].strip()
    return value, ""


def _paren_to_dash(value: str) -> str:
    """'Plesso Troise (Vico Troise, Napoli)' -> 'Plesso Troise - Vico Troise, Napoli'."""
    if not value.endswith(")"):
        return value
    depth = 0
    for i in range(len(value) - 1, -1, -1):
        ch = value[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                head = value[:i].strip()
                inner = value[i + 1 : -1].strip()
                if head and inner:
                    return f"{head} - {inner}"
                return value
    return value


def nostre_squadre() -> list[dict]:
    path = ROOT / "site" / "data" / "squadre.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("squadre", [])


def is_nostra(nome: str, squadre: list[dict], pattern: str) -> bool:
    """True se il nome e' una delle nostre squadre (per `nomi`) o contiene il pattern."""
    n = _norm(nome)
    for s in squadre:
        for alias in s.get("nomi", []):
            if _norm(alias) == n:
                return True
    return bool(pattern) and pattern in n


def fetch_competitions(committee_id: str, squadre: list[dict], pattern: str) -> list[dict]:
    """Scansiona i campionati del comitato e tiene quelli con una squadra nostra."""
    campionati = _get({"action": "campionati", "committee_id": committee_id})["data"]
    print(f"[asi] {len(campionati)} campionati nel comitato {committee_id}", file=sys.stderr)

    tenuti: list[dict] = []
    for c in campionati:
        partite = _get({"action": "partite", "tournament_id": c["id"]})["data"]
        nomi = {m.get("team1_name") or "" for m in partite} | {
            m.get("team2_name") or "" for m in partite
        }
        nostre = sorted(n for n in nomi if is_nostra(n, squadre, pattern))
        if not nostre:
            print(f"[asi]   scarto {c['name']}: nessuna squadra nostra", file=sys.stderr)
            continue
        print(f"[asi]   tengo {c['name']}: {', '.join(nostre)}", file=sys.stderr)
        tenuti.append({"campionato": c, "partite": partite, "nostre": nostre})
    return tenuti


def build_competition(entry: dict, comitato_nome: str, stagione: str, comp_id: str) -> dict:
    c = entry["campionato"]
    partite = entry["partite"]

    matches = []
    for m in partite:
        stato = (m.get("status") or "").lower()
        palestra, indirizzo = _split_court(m.get("court") or "")
        giocata = stato == STATO_GIOCATA
        annullata = stato == STATO_ANNULLATA
        matches.append(
            {
                "gara": str(m.get("id") or ""),
                "giornata": str(m.get("round") or ""),
                "data": f"{m.get('match_date') or ''} {m.get('match_time') or ''}".strip(),
                "casa": (m.get("team1_name") or "").strip(),
                "trasferta": (m.get("team2_name") or "").strip(),
                # Un risultato esiste solo se la partita e' stata giocata: le
                # annullate arrivano dall'API con 0-0, che non e' un risultato.
                "risultato": f"{m.get('score1')} - {m.get('score2')}" if giocata else "",
                "parziali": _parziali(m) if giocata else "",
                "palestra": palestra,
                "indirizzo": indirizzo,
                "stato": stato or "pending",
                "logo_casa": _logo_url(m.get("team1_logo")),
                "logo_trasferta": _logo_url(m.get("team2_logo")),
            }
        )

    matches.sort(key=lambda m: (m["data"] or "9999", m["casa"]))

    giornate = sorted({m["giornata"] for m in matches if m["giornata"]}, key=lambda g: int(g or 0))
    return {
        "id": comp_id,
        "titolo": c["name"],
        "fonte": "asi",
        "categoria": "Open Misto" if "misto" in _norm(c["name"]) else "Giovanile",
        "comitato": comitato_nome,
        "stagione": stagione,
        "tournament_id": c["id"],
        "giornate": giornate,
        "squadre": sorted({m["casa"] for m in matches} | {m["trasferta"] for m in matches}),
        "matches": matches,
    }


def _logo_url(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith("http"):
        return path
    return f"https://www.spikevolley.it/campionati/{path.lstrip('/')}"


def _load_existing_loghi(asi_dir: Path, comp_id: str) -> dict:
    """Loghi inseriti a mano: l'API non li ha tutti, e non vanno persi."""
    path = asi_dir / f"{comp_id}.squadre.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8")).get("loghi", {})


def main() -> int:
    parser = argparse.ArgumentParser(description="Campionati ASI -> JSON (via API pubblica)")
    parser.add_argument("--config", default=str(ROOT / "config.json"))
    parser.add_argument("--dry-run", action="store_true", help="non scrive i file")
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    asi_cfg = config.get("asi") or {}
    committee_id = str(asi_cfg.get("committee_id") or "").strip()
    if not committee_id:
        print("Manca asi.committee_id in config.json", file=sys.stderr)
        return 2

    squadre = nostre_squadre()
    pattern = _norm(asi_cfg.get("pattern_squadre") or config.get("match_pattern") or "")
    asi_dir = ROOT / (asi_cfg.get("dir") or "data/asi")
    id_per_torneo = {
        str(k): str(v) for k, v in (asi_cfg.get("id_per_torneo") or {}).items()
    }
    comitato_nome = asi_cfg.get("comitato_nome") or "ASI"
    stagione = config.get("stagione_testo") or ""

    entries = fetch_competitions(committee_id, squadre, pattern)
    if not entries:
        # Non e' un errore: puo' essere semplicemente fuori stagione. Ma non si
        # cancella niente, per non perdere i dati buoni se l'API risponde male.
        print("[asi] Nessun campionato con squadre nostre: non tocco i file.", file=sys.stderr)
        return 0

    for entry in entries:
        tid = entry["campionato"]["id"]
        # L'id finisce nei link `?campionato=`: se cambia, i link gia' diffusi
        # smettono di funzionare. La mappa in config lo tiene stabile.
        comp_id = id_per_torneo.get(tid) or _slug(entry["campionato"]["name"])
        comp = build_competition(entry, comitato_nome, stagione, comp_id)
        # I loghi inseriti a mano vincono su quelli dell'API: alcuni sono file
        # locali (assets/loghi) che il sito serve da solo.
        loghi = _load_existing_loghi(asi_dir, comp["id"])
        for m in comp["matches"]:
            if loghi.get(m["casa"]):
                m["logo_casa"] = loghi[m["casa"]]
            if loghi.get(m["trasferta"]):
                m["logo_trasferta"] = loghi[m["trasferta"]]

        giocate = sum(1 for m in comp["matches"] if m["risultato"])
        annullate = sum(1 for m in comp["matches"] if m["stato"] == STATO_ANNULLATA)
        print(
            f"[asi] {comp['id']}: {len(comp['matches'])} partite "
            f"({giocate} giocate, {annullate} annullate), {len(comp['giornate'])} giornate",
            file=sys.stderr,
        )
        if args.dry_run:
            continue
        dest = asi_dir / f"{comp['id']}.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(comp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[asi]   scritto {dest.relative_to(ROOT)}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
