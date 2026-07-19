#!/usr/bin/env python3
"""Add two site-level fields to school_thermal_classification.csv:

  site_mixed_estate      - True if the school's site contains buildings
                            spanning 2+ RdSAP age bands (a genuinely
                            mixed-era estate, not just floor-area variation
                            within one era).
  site_worst_case_cluster - the highest-risk vulnerability_cluster found
                            among ALL buildings on the site (not just the
                            single matched "main" building), per the rank
                            in WORST_CASE_RANK below.

Rationale: 80% of schools have >1 building on site (school_buildings.csv
site_building_count), and our join matches the largest building on site
~80% of the time (validated by spot-check) -- a defensible choice for "the
building most pupils occupy", but it silently discards site diversity. ~53%
of multi-building sites span 2+ age bands. These two fields expose that
without changing the primary (main-building) classification.

Uses the same 5km-cell bbox-batched read pattern as build_buildings_join.py
to stay fast (the naive one-query-per-school approach was tested and is too
slow at ~16,000 multi-building sites).

Input:  data/school_buildings.csv, data/school_thermal_classification.csv
Output: data/school_thermal_classification.csv (rewritten in place, with
        the two new columns added)

Run: python3 compute_site_flags.py
"""
import glob
import os

import geopandas as gpd
import pandas as pd

from classify_thermal_performance import (
    parse_age, parse_wall, parse_roof, parse_glazing,
    adjust_insulation_class, classify_vulnerability, VULN_LABELS,
)

HERE = os.path.dirname(os.path.abspath(__file__))
BUILDINGS = os.path.join(HERE, "data", "school_buildings.csv")
THERMAL = os.path.join(HERE, "data", "school_thermal_classification.csv")
LAYER = "UKBuildings_19"
CELL_SIZE_M = 5000
CELL_BUFFER_M = 250

# Worst-case ranking: lower = higher risk. Ties broken by this order.
WORST_CASE_RANK = {
    "trapped_heat": 1,
    "system_build_risk": 2,
    "legacy_accumulation": 3,
    "responsive": 4,
    "buffered": 5,
}


def find_gpkgs():
    return sorted(set(
        glob.glob(os.path.join(HERE, "data", "Download_*", "ukbuildings_*", "*.gpkg"))
    ))


def cell_key(x, y):
    return (int(x // CELL_SIZE_M), int(y // CELL_SIZE_M))


def classify_one_building(row):
    """Run the same pipeline as classify_thermal_performance.py on a raw
    Verisk building row; returns vulnerability_cluster or None."""
    year, band, _, age_source = parse_age(row)
    if band is None:
        return None, None
    from classify_thermal_performance import INSULATION_CLASS
    base_class = INSULATION_CLASS[band]
    wall_category, _, mass_class, wall_source = parse_wall(row, band)
    roof_category, _ = parse_roof(row, band)
    glazing_category, _, _ = parse_glazing(row, band)
    insulation_class = adjust_insulation_class(base_class, wall_source, wall_category, glazing_category, band)
    cluster, _, _ = classify_vulnerability(insulation_class, mass_class, roof_category)
    return cluster, band


BAND_ORDER = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5, "G": 6, "H": 7, "I": 8, "J": 9, "K": 10, "L": 11, "M": 12}


def process_cell(gpkg_path, bbox, site_lookup):
    """site_lookup: {site_id: [urn, urn, ...]} for sites expected in this cell."""
    try:
        gdf = gpd.read_file(gpkg_path, layer=LAYER, bbox=bbox)
    except Exception:
        return {}
    if gdf.empty:
        return {}
    results = {}
    for sid, group in gdf.groupby("site_id"):
        if sid not in site_lookup:
            continue
        bands_seen = set()
        clusters_seen = []
        # to_dict("records") is far faster than iterrows() here: iterrows()
        # rebuilds a full mixed-dtype Series per row, which dominated the
        # runtime (49 min and climbing on the first attempt, confirmed via
        # `sample` showing time stuck in generator/dict-view machinery under
        # iterrows). Plain dicts keep row.get() working in classify_one_building.
        for brow in group.to_dict("records"):
            cluster, band = classify_one_building(brow)
            if band is not None:
                bands_seen.add(BAND_ORDER.get(band))
            if cluster is not None:
                clusters_seen.append(cluster)
        mixed = len(bands_seen) >= 2
        worst = min(clusters_seen, key=lambda c: WORST_CASE_RANK.get(c, 99)) if clusters_seen else None
        results[sid] = (mixed, worst)
    return results


def main():
    buildings = pd.read_csv(BUILDINGS, usecols=["urn", "site_id", "easting", "northing", "site_building_count"])
    thermal = pd.read_csv(THERMAL)

    single = buildings[buildings["site_building_count"].fillna(1) <= 1]
    multi = buildings[buildings["site_building_count"] > 1].dropna(subset=["site_id", "easting", "northing"])
    print(f"single-building sites (trivial): {len(single)}", flush=True)
    print(f"multi-building sites to fetch: {len(multi)} rows, {multi['site_id'].nunique()} unique sites", flush=True)

    # group candidate sites by 5km cell per gpkg file (bbox pre-check via file bounds)
    gpkgs = find_gpkgs()
    file_bounds = {}
    import fiona
    for g in gpkgs:
        with fiona.open(g, layer=LAYER) as src:
            file_bounds[g] = src.bounds

    def file_for(e, n):
        for g, (x0, y0, x1, y1) in file_bounds.items():
            if x0 <= e <= x1 and y0 <= n <= y1:
                return g
        return None

    multi = multi.copy()
    multi["gpkg"] = [file_for(e, n) for e, n in zip(multi["easting"], multi["northing"])]
    multi = multi.dropna(subset=["gpkg"])
    multi["cell"] = [cell_key(e, n) for e, n in zip(multi["easting"], multi["northing"])]

    site_flags = {}  # site_id -> (mixed, worst)
    for gpkg, gsub in multi.groupby("gpkg"):
        cells = gsub.groupby("cell")
        print(f"  {os.path.basename(gpkg)}: {gsub['site_id'].nunique()} sites across {len(cells)} cells", flush=True)
        for i, ((cx, cy), csub) in enumerate(cells, 1):
            site_lookup = {sid: list(g["urn"]) for sid, g in csub.groupby("site_id")}
            bbox = (cx * CELL_SIZE_M - CELL_BUFFER_M, cy * CELL_SIZE_M - CELL_BUFFER_M,
                    (cx + 1) * CELL_SIZE_M + CELL_BUFFER_M, (cy + 1) * CELL_SIZE_M + CELL_BUFFER_M)
            results = process_cell(gpkg, bbox, site_lookup)
            site_flags.update(results)
            if i % 50 == 0 or i == len(cells):
                print(f"    cell {i}/{len(cells)} ({len(site_flags)} sites resolved so far)", flush=True)

    # map back to every school row
    urn_to_site = dict(zip(buildings["urn"], buildings["site_id"]))
    urn_to_own_cluster = dict(zip(thermal["urn"], thermal["vulnerability_cluster"]))
    mixed_col, worst_col, worst_label_col = [], [], []
    for urn in thermal["urn"]:
        sid = urn_to_site.get(urn)
        own_cluster = urn_to_own_cluster.get(urn)
        if sid in site_flags:
            mixed, worst = site_flags[sid]
            worst = worst or own_cluster
        else:
            mixed, worst = False, own_cluster
        mixed_col.append(mixed)
        worst_col.append(worst)
        worst_label_col.append(VULN_LABELS.get(worst) if pd.notna(worst) else None)

    thermal["site_mixed_estate"] = mixed_col
    thermal["site_worst_case_cluster"] = worst_col
    thermal["site_worst_case_label"] = worst_label_col
    thermal.to_csv(THERMAL, index=False)
    print(f"\nwrote {THERMAL} with site_mixed_estate / site_worst_case_cluster / site_worst_case_label", flush=True)

    print(f"\nsite_mixed_estate = True: {sum(mixed_col)} ({sum(mixed_col)/len(mixed_col)*100:.1f}%)", flush=True)
    changed = sum(1 for w, o in zip(worst_col, thermal["vulnerability_cluster"]) if w != o and pd.notna(w))
    print(f"worst-case cluster differs from main-building cluster: {changed} ({changed/len(worst_col)*100:.1f}%)", flush=True)


if __name__ == "__main__":
    main()
