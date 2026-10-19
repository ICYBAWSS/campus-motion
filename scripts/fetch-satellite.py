"""Fetch a higher-resolution satellite image for the campus frame.

Esri World Imagery tiles at z16 for the 140x220 unit frame (7000x11000 m
centred on CENTER), stitched and cropped to the exact bbox, then written to
src/data/satellite.jpg.
"""
import math
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

from PIL import Image

CENTER = (40.5028, -74.447)
FRAME_W_M = 7000.0
FRAME_H_M = 11000.0
Z = 16
TILE = 256
OUT_W = 3200
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "satellite.jpg")

KX = 111320.0 * math.cos(math.radians(CENTER[0]))
KY = 110574.0

lon0 = CENTER[1] - (FRAME_W_M / 2) / KX
lon1 = CENTER[1] + (FRAME_W_M / 2) / KX
lat0 = CENTER[0] - (FRAME_H_M / 2) / KY
lat1 = CENTER[0] + (FRAME_H_M / 2) / KY


def lon_to_x(lon, z):
    return (lon + 180.0) / 360.0 * (2 ** z) * TILE


def lat_to_y(lat, z):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * (2 ** z) * TILE


x0 = lon_to_x(lon0, Z)
x1 = lon_to_x(lon1, Z)
y0 = lat_to_y(lat1, Z)  # north
y1 = lat_to_y(lat0, Z)  # south

tx0, tx1 = int(x0 // TILE), int(x1 // TILE)
ty0, ty1 = int(y0 // TILE), int(y1 // TILE)
cols, rows = tx1 - tx0 + 1, ty1 - ty0 + 1
print(f"tiles {cols}x{rows} = {cols * rows}, pixels {cols * TILE}x{rows * TILE}")

sheet = Image.new("RGB", (cols * TILE, rows * TILE))
PROVIDERS = [
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
]


def fetch(args):
    cx, cy = args
    last = None
    for provider in PROVIDERS:
        for attempt in range(3):
            url = provider.format(z=Z, y=ty0 + cy, x=tx0 + cx)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    return cx, cy, Image.open(BytesIO(r.read())).convert("RGB")
            except Exception as e:  # noqa: BLE001 - try the next provider/attempt
                last = e
                time.sleep(1 + attempt)
    raise RuntimeError(f"tile {tx0 + cx},{ty0 + cy}: {last}")


jobs = [(cx, cy) for cx in range(cols) for cy in range(rows)]
with ThreadPoolExecutor(max_workers=12) as ex:
    done = 0
    for cx, cy, img in ex.map(fetch, jobs):
        sheet.paste(img, (cx * TILE, cy * TILE))
        done += 1
        if done % 50 == 0:
            print(f"  {done}/{len(jobs)}")

crop = sheet.crop((int(x0 - tx0 * TILE), int(y0 - ty0 * TILE), int(x1 - tx0 * TILE), int(y1 - ty0 * TILE)))
w, h = crop.size
print(f"cropped {w}x{h}, target {OUT_W}x{round(OUT_W * h / w)}")
crop = crop.resize((OUT_W, round(OUT_W * h / w)), Image.LANCZOS)
crop.save(OUT, "JPEG", quality=84, optimize=True, progressive=True)
print("wrote", os.path.abspath(OUT), os.path.getsize(OUT) // 1024, "KB")
