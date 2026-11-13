"""Estrae il calendario di un campionato ASI dal PDF inviato dalla federazione.

Il PDF e' testo (non una scansione) con una tabella a colonne fisse:
N. Gara | Data | Ora | Palestra / Impianto | Squadra Casa | Squadra Ospite | Giorno,
con le partite raggruppate per GIORNATA.

L'output e' un file calendario (data/asi/<id>.calendario.json) con le partite e
il "N. Gara", usato come chiave per agganciare i risultati inseriti a mano.

Uso:
    python importer/asi_pdf.py "CALENDARIO ... .pdf" \
        --id asi-open-misto-promozionale \
        --titolo "Open Misto Promozionale ASI" \
        --out data/asi/asi-open-misto-promozionale.calendario.json

Richiede pdfplumber (solo per questo script; l'importer principale non lo usa):
    pip install pdfplumber
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_pdfplumber():
    try:
        import pdfplumber  # noqa: PLC0415
    except ImportError:  # pragma: no cover - dipendenza opzionale
        print(
            "Serve pdfplumber per leggere il PDF: pip install pdfplumber",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return pdfplumber


def _column_anchors(header_words: list[dict]) -> tuple[float, float]:
    """x di inizio delle colonne 'Squadra Casa' e 'Squadra Ospite'.

    Nel titolo la parola 'Squadra' compare due volte: la prima e' l'inizio
    della colonna Casa, la seconda quello della colonna Ospite. Queste x
    combaciano con l'inizio dei nomi squadra nelle righe dei dati.
    """
    xs = sorted(w["x0"] for w in header_words if w["text"] == "Squadra")
    if len(xs) < 2:
        raise ValueError("Intestazione non riconosciuta: mancano le colonne squadra")
    return xs[0], xs[1]


def _split_impianto(value: str) -> tuple[str, str]:
    """'PALESTRA - Via X, Citta' NA' -> (palestra, indirizzo)."""
    pal, sep, ind = value.partition(" - ")
    if sep:
        return pal.strip(), ind.strip()
    return value.strip(), ""


def _iso_datetime(data: str, ora: str) -> str:
    """'03/12/2026' + '19:00' -> '2026-12-03 19:00'."""
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", data.strip())
    if not m:
        return ""
    d, mo, y = m.groups()
    return f"{y}-{mo}-{d} {ora.strip()}"


def parse_pdf(path: Path) -> dict:
    pdfplumber = _load_pdfplumber()
    matches: list[dict] = []
    giornata = ""
    titolo_doc = ""

    with pdfplumber.open(str(path)) as pdf:
        for pg in pdf.pages:
            rows: dict[int, list[dict]] = {}
            for w in pg.extract_words():
                rows.setdefault(round(w["top"]), []).append(w)

            anchors: tuple[float, float] | None = None
            for top in sorted(rows):
                line = sorted(rows[top], key=lambda w: w["x0"])
                text = " ".join(w["text"] for w in line)

                if "N. Gara" in text and "Data" in text:
                    anchors = _column_anchors(line)
                    continue
                if text.startswith("Campionati"):
                    titolo_doc = text
                    continue
                if text.upper().startswith("GIORNATA"):
                    giornata = text.split()[1] if len(text.split()) > 1 else ""
                    continue
                if anchors is None or not re.match(r"^\d{4}\s", text):
                    continue

                # Ogni riga gara: N. Gara, Data, Ora, <palestra + squadre>,
                # Giorno. Le colonne squadra si separano con le x del titolo;
                # il giorno e' l'ultimo token (le squadre non hanno mai 1 sola
                # parola dopo le due colonne, quindi il taglio e' sicuro).
                casa_x, ospite_x = anchors
                tol = 2.0  # i nomi possono cadere qualche decimo a sinistra dell'ancora
                middle = line[3:-1]
                palestra = " ".join(w["text"] for w in middle if w["x0"] < casa_x - tol)
                casa = " ".join(w["text"] for w in middle if casa_x - tol <= w["x0"] < ospite_x - tol)
                ospite = " ".join(w["text"] for w in middle if w["x0"] >= ospite_x - tol)
                pal, indirizzo = _split_impianto(palestra.strip())

                matches.append(
                    {
                        "gara": line[0]["text"],
                        "giornata": giornata,
                        "data": _iso_datetime(line[1]["text"], line[2]["text"]),
                        "casa": casa.strip(),
                        "trasferta": ospite.strip(),
                        "palestra": pal,
                        "indirizzo": indirizzo,
                    }
                )

    squadre = sorted({m["casa"] for m in matches} | {m["trasferta"] for m in matches})
    return {"titolo_documento": titolo_doc, "matches": matches, "squadre": squadre}


def main() -> int:
    parser = argparse.ArgumentParser(description="PDF ASI -> calendario JSON")
    parser.add_argument("pdf", type=Path, help="PDF del calendario inviato dalla federazione")
    parser.add_argument("--id", required=True, help="id competizione, es. asi-open-misto-promozionale")
    parser.add_argument("--titolo", required=True, help="titolo mostrato sul sito")
    parser.add_argument("--categoria", default="Open Misto")
    parser.add_argument("--comitato", default="ASI Napoli Centro")
    parser.add_argument("--stagione", default="2026/27")
    parser.add_argument("--out", type=Path, required=True, help="file calendario JSON di destinazione")
    args = parser.parse_args()

    parsed = parse_pdf(args.pdf)
    if not parsed["matches"]:
        print("Nessuna partita trovata: il formato del PDF e' cambiato?", file=sys.stderr)
        return 1

    out = {
        "id": args.id,
        "titolo": args.titolo,
        "fonte": "asi",
        "categoria": args.categoria,
        "comitato": args.comitato,
        "stagione": args.stagione,
        "giornate": sorted({m["giornata"] for m in parsed["matches"]}, key=lambda g: int(g or 0)),
        "squadre": parsed["squadre"],
        "matches": parsed["matches"],
    }
    dest = args.out if args.out.is_absolute() else ROOT / args.out
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"OK: {len(out['matches'])} partite, {len(out['giornate'])} giornate, "
        f"{len(out['squadre'])} squadre -> {dest}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
