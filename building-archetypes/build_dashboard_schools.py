#!/usr/bin/env python3
"""Consolidate spine.csv + school_buildings.csv + school_thermal_classification.csv
into a single compact JSON for the dashboard's Building Vulnerability tab.

One row per school: identifying/contact details (name, type, phase, pupils,
website), map coordinates, the full Verisk-sourced building record, and the
two-axis classification + final vulnerability cluster (including the
site-level mixed-estate/worst-case fields).

Output: ../../heatwave-school-closures/src/data/schools.json

Run: python3 build_dashboard_schools.py
"""
import json
import os

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SPINE = os.path.join(HERE, "data", "spine.csv")
BUILDINGS = os.path.join(HERE, "data", "school_buildings.csv")
THERMAL = os.path.join(HERE, "data", "school_thermal_classification.csv")
OUT = os.path.join(HERE, "..", "src", "data", "schools.json")


def clean(v, key=None):
    if pd.isna(v):
        return None
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, float):
        return round(v, 6 if key in ("lat", "lon") else 2)
    return v


def main():
    spine = pd.read_csv(SPINE)
    buildings = pd.read_csv(BUILDINGS)
    thermal = pd.read_csv(THERMAL)

    # spine: identifying + location. buildings/thermal duplicate several spine
    # columns (easting, northing, lat, lon, phase, type, capacity, pupils,
    # postcode, ...) from build_buildings_join.py's own output -- drop those so
    # the merge doesn't silently rename them to _x/_y and get filtered out by
    # `keep` below (that bug previously produced a schools.json with no lat/lon,
    # which meant the map couldn't render a single marker).
    spine_only_cols = [c for c in spine.columns if c != "urn"]
    df = spine.merge(
        buildings.drop(columns=[c for c in spine_only_cols if c in buildings.columns], errors="ignore"),
        on="urn", how="inner",  # inner: only schools with a matched building
    ).merge(
        thermal.drop(columns=[c for c in spine_only_cols if c in thermal.columns], errors="ignore"),
        on="urn", how="left",
    )

    keep = [
        "urn", "name", "type", "phase", "website", "pupils", "capacity",
        "la", "region", "postcode", "lat", "lon",
        # Verisk raw building record
        "premise_use", "premise_type", "premise_age", "premise_year",
        "wall_type", "wall_construction_type", "roof_type", "glazing_type",
        "height", "premise_floor_count", "premise_area", "building_area",
        "basement", "listed_grade", "energy_efficiency_rating",
        "site_building_count", "toid",
        # our classification
        "age_band", "insulation_class", "insulation_class_label",
        "thermal_mass_class", "wall_category", "wall_u",
        "roof_category", "roof_u", "glazing_category", "glazing_u",
        "vulnerability_cluster", "vulnerability_label", "flat_roof_modifier",
        "mixed_era", "classification_confidence",
        "site_mixed_estate", "site_worst_case_cluster", "site_worst_case_label",
        "match_type", "match_distance_m",
    ]
    keep = [c for c in keep if c in df.columns]
    df = df[keep]

    records = [{k: clean(row[k], k) for k in keep} for row in df.to_dict("records")]

    classified = sum(1 for r in records if r.get("vulnerability_cluster"))
    meta = {
        "generated": pd.Timestamp.now().strftime("%Y-%m-%d"),
        "schoolCount": len(records),
        "classifiedCount": classified,
        "note": "England only. One row per school matched to a Verisk UKBuildings "
                "premise. vulnerability_cluster reflects the main/largest building "
                "on site; site_worst_case_cluster is the highest-risk cluster found "
                "among ANY building on a multi-building site; site_mixed_estate "
                "flags sites spanning 2+ construction-era bands. See "
                "building-archetypes/docs/thermal_vulnerability_methodology.md.",
    }

    with open(OUT, "w") as f:
        json.dump({"meta": meta, "schools": records}, f, separators=(",", ":"))

    size_mb = os.path.getsize(OUT) / 1e6
    print(f"wrote {OUT}")
    print(f"schools: {len(records)}  classified: {classified}  size: {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
