#!/usr/bin/env python3
"""Build the GIAS 'spine' for the school-buildings archetype database.

One row per setting, carrying identifiers + point location + the GIAS attributes
useful for building archetyping. This is the table every later spatial join
(OS NGD buildings, DfE CDC, RAAC) hangs off.

Cohort defaults to the exact universe the Heatwave School Closures dashboard
models: OPEN schools, in mainstream phases, in England. That keeps the building
data 1:1 with the settings that dashboard costs. Flags widen the net if needed.
"""
import argparse
import csv
import glob
import json
import os
import re

from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
# GIAS extract lives in the closure dashboard's raw data dir (git-ignored there).
RAW_DIR = os.path.join(HERE, "..", "data", "raw")
OUT = os.path.join(HERE, "data", "spine.csv")

# The closure dashboard's setting universe (scripts/build_data.mjs).
CLOSURE_PHASES = {
    "Primary", "Secondary", "All-through",
    "Middle deemed primary", "Middle deemed secondary", "Nursery",
}
OVERSEAS_LA = {"000", "701", "702", "704", "705", "706", "707", "708"}


def is_england_la(code):
    if code in OVERSEAS_LA:
        return False
    try:
        return not (660 <= int(code) <= 699)  # 66x-69x = Wales
    except ValueError:
        return True


def find_gias():
    hits = sorted(glob.glob(os.path.join(RAW_DIR, "edubasealldata*.csv")))
    if not hits:
        raise SystemExit(f"No edubasealldata*.csv found in {os.path.abspath(RAW_DIR)}")
    return hits[-1]  # newest by name (dated)


def era_band(open_date):
    """Coarse era proxy from GIAS OpenDate. NOTE: this is the establishment's
    open date, not the building's build date (academy conversions mislead it),
    so treat as a weak prior only."""
    if not open_date:
        return None
    m = re.search(r"(\d{4})", open_date)
    if not m:
        return None
    y = int(m.group(1))
    return "pre-1900" if y < 1900 else f"{(y // 10) * 10}s"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all-open", action="store_true",
                    help="every open school (all phases incl. special/PRU/AP), not just the closure universe")
    ap.add_argument("--all", action="store_true",
                    help="every establishment in GIAS regardless of status")
    args = ap.parse_args()

    gias = find_gias()
    tf = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)

    out_rows, skipped_no_coord = [], 0
    with open(gias, encoding="cp1252", newline="") as f:
        for row in csv.DictReader(f):
            status = row["EstablishmentStatus (name)"]
            phase = row["PhaseOfEducation (name)"]
            code = row["LA (code)"].strip()
            if not args.all and status != "Open":
                continue
            if not args.all and not args.all_open and phase not in CLOSURE_PHASES:
                continue
            if not is_england_la(code):
                continue

            e, n = row["Easting"], row["Northing"]
            lat = lon = None
            if e and n:
                lon, lat = tf.transform(float(e), float(n))
                lat, lon = round(lat, 6), round(lon, 6)
            else:
                skipped_no_coord += 1
            out_rows.append({
                "urn": row["URN"].strip(),
                "name": row["EstablishmentName"],
                "easting": e or None,
                "northing": n or None,
                "lat": lat,
                "lon": lon,
                "la": row["LA (name)"],
                "region": row["GOR (name)"],
                "phase": phase,
                "type": row["TypeOfEstablishment (name)"],
                "status": status,
                "open_date": row["OpenDate"] or None,
                "era_proxy": era_band(row["OpenDate"]),
                "capacity": row["SchoolCapacity"] or None,
                "pupils": row["NumberOfPupils"] or None,
                "website": row.get("SchoolWebsite") or None,
                "postcode": row["Postcode"] or None,
            })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)

    scope = "all establishments" if args.all else ("all open schools" if args.all_open else "closure universe")
    print(f"scope: {scope} (source: {os.path.basename(gias)})")
    print(f"spine rows: {len(out_rows)} | missing coords: {skipped_no_coord}")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
