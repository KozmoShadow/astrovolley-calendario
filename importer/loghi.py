"""Scarica i loghi delle squadre in locale e li ottimizza.

Il sito deve servire i loghi da GitHub Pages, non dai portali: FIPAV blocca
l'hotlink (risponde con un placeholder) e ASI serve file fino a 1,2 MB per
un'immagine che nella scheda si vede a 46px.

Qui i loghi si scaricano una volta, si ridimensionano e si salvano in WebP,
che mantiene la trasparenza a una frazione del peso di un PNG.
"""

from __future__ import annotations

import io
import urllib.request
from pathlib import Path

from PIL import Image

# Lato massimo in pixel. 512 basta per il lightbox (dove il logo si vede
# grande) e tiene la cartella sotto il megabyte anche con molte squadre.
LATO_MAX = 512
QUALITA = 88
UA = "Mozilla/5.0 (compatible; astrovolley-calendario)"

# I loghi che non hanno trasparenza non devono diventare neri nel WebP.
SFONDO = (255, 255, 255)


def scarica(url: str, timeout: int = 40) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def ottimizza(raw: bytes, lato_max: int = LATO_MAX) -> bytes:
    """Ridimensiona e converte in WebP. Solleva se i byte non sono un'immagine."""
    img = Image.open(io.BytesIO(raw))
    img.load()

    # Si riduce solo: un logo piu' piccolo del limite resta com'e', per non
    # inventare pixel che non esistono.
    if max(img.size) > lato_max:
        img = img.copy()
        img.thumbnail((lato_max, lato_max), Image.LANCZOS)

    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
    else:
        img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=QUALITA, method=6)
    return buf.getvalue()


def salva(url: str, dest: Path, lato_max: int = LATO_MAX) -> bool:
    """Scarica e salva un logo. True se il file e' stato scritto.

    Un errore non deve fermare l'import: il chiamante decide se ripiegare
    sull'URL remoto.
    """
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(ottimizza(scarica(url), lato_max))
        return True
    except Exception:  # noqa: BLE001 - logo mancante o portale giu'
        return False
