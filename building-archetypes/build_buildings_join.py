#!/usr/bin/env python3
"""Join every school in the GIAS spine to its Verisk UKBuildings premise.

Reads all `ukbuildings_*.gpkg` files dropped anywhere under `data/` (each is
one Digimap coordinate-box order — see the 8-rectangle plan in session notes)
and, for every school point in data/spine.csv, finds the building it sits in.

Some order files are multi-GB (dense regions like London/SE run 2-3GB on
disk, ballooning far larger once deserialised into memory). Loading a whole
file at once swap-thrashed the machine. Instead: for each source file, we
cluster its candidate schools into 5km cells and issue one GDAL-pushed-down
bounding-box read per occupied cell (via `bbox=` — GeoPackage's spatial index
means this is fast and doesn't scan the whole file), so peak memory per read
stays bounded to roughly one cell's buildings (~tens of thousands of rows,
same order as the original single-tile test), regardless of source file size.

Results are appended to school_buildings.csv incrementally, one source file
at a time, so an interruption never loses more than the file in progress. Re-
running skips schools already present in the output (resume-safe).

Join strategy, per school point:
  1. within  - point falls inside a UKBuildings premise polygon (preferred)
  2. nearest - falls in a gap (yard, path) between polygons; snap to nearest
               premise within NEAREST_MAX_M metres
  3. unmatched - no building found in any order within that radius

Run: python3 build_buildings_join.py [--allow-partial] [--limit-cells N]
"""
import argparse
import glob
import os
import sys

import fiona
import geopandas as gpd
import pandas as pd
from shapely.geometry import box

HERE = os.path.dirname(os.path.abspath(__file__))
SPINE = os.path.join(HERE, "data", "spine.csv")
OUT = os.path.join(HERE, "data", "school_buildings.csv")
EXPECTED_ORDERS = 8
NEAREST_MAX_M = 100      # snap-to-nearest search radius for points that miss every polygon
CELL_SIZE_M = 5000       # bbox-read granularity; ~25km2 per cell, matches the earlier single-tile test scale
CELL_BUFFER_M = 250      # margin beyond each cell so buildings straddling the edge aren't missed
LAYER = "UKBuildings_19"

KEEP_COLS = [
    "toid", "verisk_premise_id", "verisk_building_id", "site_id",
    "premise_use", "premise_type", "premise_type_confidence",
    "premise_age", "premise_year", "premise_age_confidence",
    "wall_type", "wall_type_confidence", "wall_construction_type",
    "roof_type", "substructure_type", "glazing_type", "floor_type",
    "height", "premise_floor_count", "premise_area", "building_area",
    "basement", "listed_grade", "energy_efficiency_rating",
    "site_area", "site_building_count",
]


def find_gpkgs():
    pats = [
        os.path.join(HERE, "data", "Download_*", "ukbuildings_*", "*.gpkg"),
        os.path.join(HERE, "data", "raw_os", "**", "*.gpkg"),
    ]
    hits = []
    for p in pats:
        hits += glob.glob(p, recursive=True)
    return sorted(set(hits))


def load_spine():
    df = pd.read_csv(SPINE)
    df = df[df["easting"].notna() & df["northing"].notna()].copy()
    return gpd.GeoDataFrame(
        df, geometry=gpd.points_from_xy(df["easting"], df["northing"]), crs="EPSG:27700"
    )


def already_done_urns():
    if not os.path.exists(OUT):
        return set()
    return set(pd.read_csv(OUT, usecols=["urn"])["urn"].astype(str))


def cell_key(x, y):
    return (int(x // CELL_SIZE_M), int(y // CELL_SIZE_M))


def process_one(gpkg_path, spine_gdf, matched_urns, limit_cells=None):
    with fiona.open(gpkg_path, layer=LAYER) as src:
        minx, miny, maxx, maxy = src.bounds
    aoi = box(minx, miny, maxx, maxy)

    remaining = spine_gdf[~spine_gdf["urn"].astype(str).isin(matched_urns)]
    candidates = remaining[remaining.intersects(aoi)].copy()
    if candidates.empty:
        print(f"  skip (no unmatched spine points in extent): {os.path.basename(gpkg_path)}")
        return []

    candidates["cell"] = [cell_key(pt.x, pt.y) for pt in candidates.geometry]
    cells = sorted(candidates["cell"].unique())
    if limit_cells:
        cells = cells[:limit_cells]
    print(f"  {os.path.basename(gpkg_path)}: {len(candidates)} candidate schools "
          f"across {len(cells)} cell(s) of {CELL_SIZE_M}m")

    file_results = []
    for i, (cx, cy) in enumerate(cells, 1):
        cell_candidates = candidates[candidates["cell"] == (cx, cy)]
        bx0 = cx * CELL_SIZE_M - CELL_BUFFER_M
        by0 = cy * CELL_SIZE_M - CELL_BUFFER_M
        bx1 = (cx + 1) * CELL_SIZE_M + CELL_BUFFER_M
        by1 = (cy + 1) * CELL_SIZE_M + CELL_BUFFER_M

        buildings = gpd.read_file(gpkg_path, layer=LAYER, bbox=(bx0, by0, bx1, by1))
        if buildings.empty:
            continue
        cols = [c for c in KEEP_COLS if c in buildings.columns] + ["geometry"]
        buildings = buildings[cols]

        within = gpd.sjoin(cell_candidates, buildings, how="left", predicate="within")
        within = within[within["index_right"].notna()].copy()
        within["match_type"] = "within"
        within["match_distance_m"] = 0.0

        still_missing = cell_candidates[~cell_candidates["urn"].isin(within["urn"])]
        nearest = pd.DataFrame()
        if not still_missing.empty:
            nn = gpd.sjoin_nearest(
                still_missing, buildings, how="left",
                max_distance=NEAREST_MAX_M, distance_col="match_distance_m",
            )
            nn = nn[nn["index_right"].notna()].copy()
            nn["match_type"] = "nearest"
            nearest = nn

        got = pd.concat([within, nearest], ignore_index=True) if len(nearest) else within
        if len(got):
            got = got.drop(columns=["index_right", "geometry", "cell"], errors="ignore")
            file_results.append(got)

        if i % 20 == 0 or i == len(cells):
            print(f"    cell {i}/{len(cells)} done "
                  f"({sum(len(r) for r in file_results)} matched so far this file)")

    return file_results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow-partial", action="store_true")
    ap.add_argument("--limit-cells", type=int, default=None,
                     help="cap cells processed per file (smoke-test speed before a full run)")
    args = ap.parse_args()

    gpkgs = find_gpkgs()
    print(f"found {len(gpkgs)} gpkg file(s)")
    if len(gpkgs) < EXPECTED_ORDERS and not args.allow_partial:
        print(f"only {len(gpkgs)}/{EXPECTED_ORDERS} orders present; "
              f"re-run with --allow-partial to test anyway")
        sys.exit(1)

    spine = load_spine()
    done = already_done_urns()
    print(f"spine: {len(spine)} schools | already in {os.path.basename(OUT)}: {len(done)}")

    write_header = not os.path.exists(OUT)
    for gpkg in gpkgs:
        results = process_one(gpkg, spine, done, limit_cells=args.limit_cells)
        if not results:
            continue
        combined = pd.concat(results, ignore_index=True)
        combined = combined.sort_values("match_distance_m").drop_duplicates("urn", keep="first")
        combined.to_csv(OUT, mode="a", header=write_header, index=False)
        write_header = False
        done |= set(combined["urn"].astype(str))
        print(f"  -> appended {len(combined)} rows to {OUT} (running total {len(done)})")

    unmatched = spine[~spine["urn"].astype(str).isin(done)]
    print(f"\n{'='*60}")
    print(f"total matched so far: {len(done)}")
    print(f"unmatched: {len(unmatched)} "
          f"({'expected if --limit-cells or partial orders used' if (args.limit_cells or len(gpkgs) < EXPECTED_ORDERS) else 'no building found within '+str(NEAREST_MAX_M)+'m'})")
    if len(gpkgs) >= EXPECTED_ORDERS and not args.limit_cells and len(unmatched):
        unmatched_path = OUT.replace(".csv", "_unmatched.csv")
        unmatched.drop(columns="geometry").to_csv(unmatched_path, index=False)
        print(f"wrote {unmatched_path} ({len(unmatched)} schools with no building match)")


if __name__ == "__main__":
    main()
