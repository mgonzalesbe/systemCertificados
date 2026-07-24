"""Convierte imágenes a PNG con transparencia quitando fondo casi uniforme (p. ej. blanco)."""

import io

import numpy as np
from PIL import Image


def strip_uniform_background_to_png(image_bytes: bytes, rgb_tolerance: int = 42) -> bytes:
    """
    Devuelve PNG en RGBA. Los píxeles cercanos al color de fondo estimado (mediana de las
    esquinas) pasan a alfa 0. Si el fondo parece claro, también se transparentan píxeles
    casi blancos puros (útil en JPEG con ruido en esquinas).
    """
    if not image_bytes:
        return image_bytes
    buf_in = io.BytesIO(image_bytes)
    im = Image.open(buf_in)
    im = im.convert("RGBA")
    # Asegurar buffer escribible (np.asarray puede devolver vista read-only según backend/Pillow)
    arr = np.array(im, dtype=np.uint8, copy=True)
    h, w = arr.shape[0], arr.shape[1]
    if h < 2 or w < 2:
        out = Image.fromarray(arr, "RGBA")
        b = io.BytesIO()
        out.save(b, format="PNG")
        return b.getvalue()

    corners = np.stack(
        [
            arr[0, 0, :3].astype(np.float32),
            arr[0, w - 1, :3].astype(np.float32),
            arr[h - 1, 0, :3].astype(np.float32),
            arr[h - 1, w - 1, :3].astype(np.float32),
        ],
        axis=0,
    )
    bg = np.median(corners, axis=0)
    rgb = arr[:, :, :3].astype(np.float32)
    dist = np.linalg.norm(rgb - bg.reshape(1, 1, 3), axis=2)
    mask = dist < float(rgb_tolerance)

    if float(np.min(bg)) > 200.0:
        hi = float(255 - min(rgb_tolerance, 55))
        mask = mask | (
            (rgb[:, :, 0] > hi) & (rgb[:, :, 1] > hi) & (rgb[:, :, 2] > hi)
        )

    a = arr[:, :, 3].astype(np.uint16)
    a = np.where(mask, 0, a)
    arr[:, :, 3] = np.clip(a, 0, 255).astype(np.uint8)

    out = Image.fromarray(arr, "RGBA")
    b = io.BytesIO()
    out.save(b, format="PNG", optimize=True)
    return b.getvalue()
