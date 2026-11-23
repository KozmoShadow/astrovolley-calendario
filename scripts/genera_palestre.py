"""Genera site/prenota/palestre.js dai dati del calendario gia' nel repo.

La pagina di prenotazione mostra la palestra accanto a data e ora. Quella
informazione non e' nel foglio dei turni: sta nel calendario FIPAV/ASI
(site/data/schedule.json) e nelle partite dell'altra societa'. Qui si uniscono
in un modulo JavaScript piccolo, cosi' la pagina non deve scaricare 260 kB di
calendario per leggere un nome.

    python3 scripts/genera_palestre.py
"""
import json
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
SITE = RADICE / "site"
USCITA = SITE / "prenota" / "palestre.js"

TESTA = """// Palestre delle partite, per chiave "data|casa|trasferta" (minuscolo).
//
// Generato da scripts/genera_palestre.py leggendo site/data/schedule.json e
// site/data/partite-altra-societa.json. Non si modifica a mano: se manca una
// palestra, la si aggiunge al calendario e si rigenera.
//
// File separato da config.js perche' cambia a ogni aggiornamento del
// calendario, mentre config.js si tocca solo a mano.

export const PALESTRE = {
"""


def chiave(data, casa, trasferta):
    """Stessa normalizzazione di chiavePartita() in site/prenota/prenota.js."""
    return "|".join(
        " ".join(str(v or "").lower().split()) for v in (data, casa, trasferta)
    )


def leggi():
    palestre = {}

    schedule = json.loads((SITE / "data" / "schedule.json").read_text(encoding="utf-8"))
    for gara in schedule.get("competitions", []):
        for m in gara.get("matches", []):
            if m.get("palestra"):
                palestre[chiave(m.get("data"), m.get("casa"), m.get("trasferta"))] = m["palestra"].strip()

    altra = json.loads((SITE / "data" / "partite-altra-societa.json").read_text(encoding="utf-8"))
    for m in altra.get("partite", []):
        if m.get("palestra"):
            palestre[chiave(m.get("data"), m.get("casa"), m.get("trasferta"))] = m["palestra"].strip()

    return palestre


def main():
    palestre = leggi()
    righe = [TESTA]
    for k, v in sorted(palestre.items()):
        righe.append(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n")
    righe.append("};\n")
    USCITA.write_text("".join(righe), encoding="utf-8")
    print(f"{len(palestre)} partite con palestra -> {USCITA.relative_to(RADICE)}")


if __name__ == "__main__":
    main()
