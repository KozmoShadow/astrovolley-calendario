"""Importa calendari e classifiche della societa'.

Fonte primaria: il sito ufficiale FIPAV Napoli (importer/fipav_napoli.py), piu'
preciso e aggiornato. Se non risponde, si ripiega sul backend pubblico di Spike
Volley. I campionati non gestiti da FIPAV (es. ASI) arrivano da data/manual.json.
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fipav_napoli  # noqa: E402

BASE = "https://tuttoincodice.com/livescore/read"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (AstrovolleySchedule/1.0)",
    "Referer": "https://www.spikevolley.it/",
}
ROOT = Path(__file__).resolve().parent.parent


def _request(path: str, payload: dict | None = None, tries: int = 3):
    url = f"{BASE}/{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    last_error: Exception | None = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=40) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body) if body.strip() else []
        except Exception as exc:  # noqa: BLE001 - retry su qualunque errore di rete
            last_error = exc
    raise RuntimeError(f"Richiesta fallita per {path}: {last_error}")


def fetch_championships(comitato_id: str, anno: int) -> list[dict]:
    payload = {"comitato": comitato_id, "commettee": comitato_id, "anno": anno}
    return _request(f"campionati.php?anno={anno}", payload)


def fetch_matches(comitato_id: str, campionato_id: str, anno: int) -> list[dict]:
    payload = {
        "campionato": campionato_id,
        "commettee": comitato_id,
        "comitato": comitato_id,
        "anno": anno,
    }
    return _request("giornate.php", payload)


def fetch_standings(comitato_id: str, campionato_id: str, anno: int) -> list[dict]:
    payload = {
        "campionato": campionato_id,
        "commettee": comitato_id,
        "comitato": comitato_id,
        "anno": anno,
    }
    try:
        return _request("classifica.php", payload)
    except Exception:  # la classifica puo' non esistere per alcuni campionati
        return []


def normalize_match(gara: dict, campionato: dict, fonte: str) -> dict:
    return {
        "fonte": fonte,
        "campionato_id": str(campionato.get("id")),
        "campionato": campionato.get("title", ""),
        "girone": campionato.get("title", ""),
        "data": gara.get("data"),
        "casa": (gara.get("sqcasa") or "").strip(),
        "trasferta": (gara.get("sqtras") or "").strip(),
        "risultato": (gara.get("risultato") or "").strip(),
        "parziali": (gara.get("parziali") or "").strip(),
        "palestra": (gara.get("palestra") or "").strip(),
        "logo_casa": gara.get("logo1"),
        "logo_trasferta": gara.get("logo2"),
    }


def normalize_standing(row: dict) -> dict:
    return {
        "squadra": (row.get("sq") or "").strip(),
        "punti": row.get("punti", 0),
        "pg": row.get("pg", 0),
        "pv": row.get("pv", 0),
        "pp": row.get("pp", 0),
        "sf": row.get("sf", 0),
        "ss": row.get("ss", 0),
    }


def scan_comitato(comitato: dict, anno: int, pattern: str, workers: int) -> list[dict]:
    cid = str(comitato["id"])
    camps = fetch_championships(cid, anno)

    def check(camp: dict):
        camp_id = str(camp["id"])
        try:
            gare = fetch_matches(cid, camp_id, anno)
        except Exception:  # noqa: BLE001
            return None
        if not any(pattern in (m.get("sqcasa", "") + m.get("sqtras", "")).lower() for m in gare):
            return None
        matches = [normalize_match(g, camp, "fipav") for g in gare]
        standings = [normalize_standing(r) for r in fetch_standings(cid, camp_id, anno)]
        return {
            "id": f"fipav-{camp_id}",
            "titolo": camp.get("title", ""),
            "fonte": "fipav",
            "categoria": "FIPAV",
            "comitato": comitato["nome"],
            "matches": matches,
            "standings": standings,
        }

    results: list[dict] = []
    with futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for res in ex.map(check, camps):
            if res:
                results.append(res)
    return results


def load_manual(path: Path) -> list[dict]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for comp in data.get("competitions", []):
        out.append(
            {
                "id": comp.get("id"),
                "titolo": comp.get("titolo", ""),
                "fonte": comp.get("fonte", "manuale"),
                "categoria": comp.get("categoria", "Manuale"),
                "comitato": comp.get("comitato", ""),
                "matches": [
                    {
                        "fonte": comp.get("fonte", "manuale"),
                        "campionato_id": comp.get("id"),
                        "campionato": comp.get("titolo", ""),
                        "girone": comp.get("titolo", ""),
                        "data": m.get("data", ""),
                        "casa": m.get("casa", ""),
                        "trasferta": m.get("trasferta", ""),
                        "risultato": m.get("risultato", ""),
                        "parziali": m.get("parziali", ""),
                        "palestra": m.get("palestra", ""),
                        "logo_casa": None,
                        "logo_trasferta": None,
                    }
                    for m in comp.get("matches", [])
                ],
                "standings": [
                    {
                        "squadra": s.get("squadra", ""),
                        "punti": s.get("punti", 0),
                        "pg": s.get("pg", 0),
                        "pv": s.get("pv", 0),
                        "pp": s.get("pp", 0),
                        "sf": s.get("sf", 0),
                        "ss": s.get("ss", 0),
                    }
                    for s in comp.get("standings", [])
                ],
            }
        )
    return out


def scan_spike_fallback(config: dict, pattern: str) -> list[dict]:
    """Fonte di riserva: scansiona i comitati su Spike Volley (piu' lento)."""
    anno = config["stagione_anno"]
    workers = config.get("max_workers", 10)
    competitions: list[dict] = []
    for comitato in config.get("comitati", []):
        print(f"[fallback] Scansione Spike {comitato['nome']}...", file=sys.stderr)
        competitions.extend(scan_comitato(comitato, anno, pattern, workers))
    return competitions


def main() -> int:
    parser = argparse.ArgumentParser(description="Importa il calendario Astrovolley")
    parser.add_argument("--config", default=str(ROOT / "config.json"))
    parser.add_argument(
        "--fonte",
        choices=["auto", "fipav_napoli", "spike"],
        default="auto",
        help="auto: FIPAV con fallback su Spike (default)",
    )
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    anno = config["stagione_anno"]
    pattern = config["match_pattern"].lower()

    fonte = args.fonte
    if fonte == "auto":
        fonte = config.get("fonte_primaria", "fipav_napoli")

    competitions: list[dict] = []
    if fonte == "fipav_napoli" and config.get("fipav_napoli"):
        try:
            print("Fonte primaria: FIPAV Napoli...", file=sys.stderr)
            competitions = fipav_napoli.fetch_competitions(config["fipav_napoli"])
            total = sum(len(c["matches"]) for c in competitions)
            print(f"FIPAV Napoli: {len(competitions)} competizioni, {total} partite.", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 - qualunque errore -> fallback
            print(f"FIPAV Napoli non disponibile ({exc}); ripiego su Spike.", file=sys.stderr)
            competitions = []
    if not competitions:
        competitions = scan_spike_fallback(config, pattern)

    manual = load_manual(ROOT / config.get("manual", "data/manual.json"))
    competitions.extend(manual)

    competitions.sort(key=lambda c: (c["fonte"] != "fipav", c["titolo"]))

    output = {
        "societa": config["societa"],
        "stagione": config.get("stagione_testo", str(anno)),
        "generato_il": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fonte_primaria": fonte,
        "live": {
            "base_url": config.get("fipav_napoli", {}).get("base_url", ""),
            "pid": config.get("fipav_napoli", {}).get("pid", ""),
            "stagione_id": config.get("fipav_napoli", {}).get("stagione_id", ""),
            "comitato_id": config.get("fipav_napoli", {}).get("comitato_id", ""),
            "societa_id": config.get("fipav_napoli", {}).get("societa_id", ""),
        },
        "competitions": competitions,
    }

    out_path = ROOT / config["output"]
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Riscrive il file solo se i dati sono cambiati davvero. Cosi' il cron
    # frequente non genera commit inutili e "generato_il" resta l'ora
    # dell'ultimo aggiornamento reale dei risultati.
    previous = None
    if out_path.exists():
        try:
            previous = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - file corrotto: si riscrive
            previous = None
    if previous:
        prev_cmp = {k: v for k, v in previous.items() if k != "generato_il"}
        new_cmp = {k: v for k, v in output.items() if k != "generato_il"}
        if prev_cmp == new_cmp:
            print("Nessun cambiamento nei dati: file invariato.", file=sys.stderr)
            return 0

    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    total = sum(len(c["matches"]) for c in competitions)
    print(
        f"OK: {len(competitions)} competizioni, {total} partite -> {out_path}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
