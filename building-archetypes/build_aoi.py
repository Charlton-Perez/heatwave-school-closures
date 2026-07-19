#!/usr/bin/env python3
"""Size the OS download job and emit an area-of-interest (AOI) polygon.

The 2,087 schools are scattered nationally, so downloading building data for all
of England is wasteful/over the Digimap area limits. This buffers each school
point and dissolves them into a compact AOI you can upload to Digimap's Data
Download tool to bound the order to just our sites. Also reports how many OS 5km
and 10km grid tiles the schools span (for the tile-selection route)."""
import csv
import json
import os

from shapely.geometry import Point, mapping
from shapely.ops import unary_union, transform
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
SPINE = os.path.join(HERE, "data", "spine.csv")
OUT_BNG = os.path.join(HERE, "data", "aoi_bng.geojson")
OUT_WGS = os.path.join(HERE, "data", "aoi_wgs84.geojson")
BUFFER_M = 500  # radius around each GIAS point; generous enough to catch a site's buildings


def main():
    pts, tiles5, tiles10 = [], set(), set()
    with open(SPINE) as f:
        for r in csv.DictReader(f):
            if not r["easting"] or not r["northing"]:
                continue
            e, n = float(r["easting"]), float(r["northing"])
            pts.append(Point(e, n))
            tiles5.add((int(e // 5000), int(n // 5000)))
            tiles10.add((int(e // 10000), int(n // 10000)))

    aoi = unary_union([p.buffer(BUFFER_M) for p in pts])  # dissolved BNG polygon
    polys = len(aoi.geoms) if aoi.geom_type == "MultiPolygon" else 1
    area_km2 = aoi.area / 1e6

    # write BNG (EPSG:27700) geojson — what Digimap works in natively
    with open(OUT_BNG, "w") as f:
        json.dump({"type": "Feature", "properties": {"crs": "EPSG:27700"},
                   "geometry": mapping(aoi)}, f)

    # and a standard WGS84 geojson for portability
    tf = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True).transform
    with open(OUT_WGS, "w") as f:
        json.dump({"type": "Feature", "properties": {},
                   "geometry": mapping(transform(tf, aoi))}, f)

    print(f"schools with coords : {len(pts)}")
    print(f"OS 10km squares span: {len(tiles10)}")
    print(f"OS 5km tiles span   : {len(tiles5)}")
    print(f"AOI ({BUFFER_M} m buffer): {polys} separate polygons, {area_km2:,.0f} km2 total")
    print(f"  (England is ~130,000 km2, so AOI is ~{area_km2/130000*100:.1f}% of that)")
    print(f"wrote {OUT_BNG}")
    print(f"wrote {OUT_WGS}")


if __name__ == "__main__":
    main()
