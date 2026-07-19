#!/usr/bin/env python3
"""Classify every joined school building on two thermal-performance axes, then
cluster into a small number of heatwave-vulnerability archetypes.

This is a first-pass, explicitly provisional classification — see
docs/thermal_vulnerability_methodology.md for the full reasoning, every
lookup table used, and the known limitations. Re-run after editing either
file; nothing here is meant to be taken as a precise engineering estimate.

Input:  data/school_buildings.csv   (from build_buildings_join.py)
Output: data/school_thermal_classification.csv  (one row per matched school)

Run: python3 classify_thermal_performance.py
"""
import os
import re

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
IN_PATH = os.path.join(HERE, "data", "school_buildings.csv")
OUT_PATH = os.path.join(HERE, "data", "school_thermal_classification.csv")

# ── 1. RdSAP age bands (England) — Table 1, RdSAP10 Specification, BRE, Feb 2024 ──
# (start_year, band_letter)
RDSAP_BANDS = [
    (1900, "A"), (1930, "B"), (1950, "C"), (1967, "D"), (1976, "E"),
    (1983, "F"), (1991, "G"), (1996, "H"), (2003, "I"), (2007, "J"),
    (2012, "K"), (2023, "L"),
]
# NB: encoded as upper bounds below for clarity of the lookup function;
# A = pre-1900. See RDSAP_BAND_RANGES for the human-readable version.
RDSAP_BAND_RANGES = {
    "A": (None, 1899), "B": (1900, 1929), "C": (1930, 1949), "D": (1950, 1966),
    "E": (1967, 1975), "F": (1976, 1982), "G": (1983, 1990), "H": (1991, 1995),
    "I": (1996, 2002), "J": (2003, 2006), "K": (2007, 2011), "L": (2012, 2022),
    "M": (2023, None),
}

# ── 2. Collapse 13 RdSAP bands into 6 regulation-era insulation classes ──
# Grouped at real Building Regs / Approved Document L step-changes, not
# arbitrary letter cuts. See methodology doc section 2 for the regulation
# history and sources behind each boundary.
INSULATION_CLASS = {
    "A": 1, "B": 1, "C": 1,                 # pre-1950: no national regulation, solid-wall era
    "D": 2, "E": 2,                          # 1950-1975: Building Regs 1965, no thermal minima yet
    "F": 3,                                  # 1976-1982: 1976 amendment, first insulation minima (oil crisis)
    "G": 4, "H": 4,                          # 1983-1995: AD L 1990/1995, steady tightening
    "I": 5, "J": 5, "K": 5,                  # 1996-2011: AD L 2002/2006, elemental -> carbon-target method
    "L": 6, "M": 6,                          # 2012-present: AD L 2013/2021, current standard
}
INSULATION_CLASS_LABEL = {
    1: "Pre-regulation solid wall (pre-1950)",
    2: "Early national regs, unregulated insulation (1950-75)",
    3: "First insulation minima, oil-crisis era (1976-82)",
    4: "1980s-90s tightening (1983-95)",
    5: "2000s elemental-to-carbon transition (1996-2011)",
    6: "Current standard (2012-present)",
}

# ── 3. Wall U-values by RdSAP band & construction category ──
# Table 6 : Wall U-values - England, RdSAP10 Specification. "as built" rows
# (no retrofit assumed) unless wall_construction_type gives explicit evidence
# of added insulation. Bands A-M in order.
_B = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"]
WALL_U_AS_BUILT = {
    "solid_brick":  dict(zip(_B, [1.7, 1.7, 1.0, 0.60, 0.60, 0.45, 0.35, 0.30, 0.28, 0.26, 0.26, 0.26, 0.26])),
    "cavity":       dict(zip(_B, [1.5, 1.5, 1.5, 1.5, 1.5, 1.0, 0.60, 0.60, 0.45, 0.35, 0.30, 0.28, 0.26])),
    "system_build": dict(zip(_B, [2.0, 2.0, 2.0, 2.0, 1.7, 1.0, 0.60, 0.60, 0.45, 0.35, 0.30, 0.28, 0.26])),
    "timber_frame": dict(zip(_B, [2.5, 1.9, 1.9, 1.0, 0.80, 0.45, 0.40, 0.40, 0.40, 0.35, 0.30, 0.28, 0.26])),
}
WALL_U_FILLED_CAVITY = dict(zip(_B, [0.7, 0.7, 0.7, 0.7, 0.7, 0.40, 0.35, 0.35, 0.45, 0.35, 0.30, 0.28, 0.26]))

# ── 4. Roof U-values by RdSAP band ──
# Table 18, "unknown / as built" columns (flat-roof column used as the general
# reference — see methodology doc for why pitched/flat aren't yet split further,
# a known first-pass simplification).
ROOF_U_AS_BUILT = dict(zip(_B, [2.3, 2.3, 2.3, 2.3, 1.5, 0.80, 0.50, 0.35, 0.35, 0.30, 0.25, 0.18, 0.15]))

# ── 5. Glazing U-values ── Table 24 (PVC/wood frame column)
GLAZING_U = {"single": 4.8, "double_pre2002": 3.1, "double_post2002": 2.0, "double_post2022": 1.4}


def parse_age(row):
    """Return (representative_year, age_band, mixed_era, source_note)."""
    if pd.notna(row.get("premise_year")):
        y = int(row["premise_year"])
        return y, year_to_band(y), False, "exact_year"

    raw = str(row.get("premise_age") or "")
    parts = [p.strip() for p in raw.split(",") if p.strip() and p.strip().lower() != "unknown date"]
    if not parts:
        return None, None, False, "unknown"

    mixed = len(parts) > 1
    first = parts[0]  # earliest-listed component treated as core/original fabric
    y = _band_text_to_midyear(first)
    if y is None:
        return None, None, mixed, "unparseable"
    return y, year_to_band(y), mixed, "band_midpoint"


def _band_text_to_midyear(text):
    text = text.strip()
    if text.lower().startswith("pre "):
        try:
            cutoff = int(re.search(r"\d{4}", text).group())
        except AttributeError:
            return None
        # midpoint of a plausible 100-year run-up to the cutoff, capped at a
        # sane floor; these are rough by nature (no lower bound given)
        return max(cutoff - 60, 1750)
    if text.lower().startswith("post "):
        try:
            cutoff = int(re.search(r"\d{4}", text).group())
        except AttributeError:
            return None
        return cutoff + 6  # rough midpoint guess for an open-ended "post-X" band
    m = re.match(r"(\d{4})-(\d{4})", text)
    if m:
        y1, y2 = int(m.group(1)), int(m.group(2))
        return (y1 + y2) // 2
    m = re.match(r"(\d{4})$", text)
    if m:
        return int(m.group(1))
    return None


def year_to_band(year):
    for letter, (lo, hi) in RDSAP_BAND_RANGES.items():
        if (lo is None or year >= lo) and (hi is None or year <= hi):
            return letter
    return None


_TRANSMITTANCE_RE = re.compile(r"AVERAGE THERMAL TRANSMITTANCE\s*([\d.]+)\s*W/M", re.I)


def parse_wall(row, band):
    """Return (wall_category, wall_u, mass_class, confidence_note)."""
    wct = str(row.get("wall_construction_type") or "").upper()

    m = _TRANSMITTANCE_RE.search(wct)
    if m:
        u = float(m.group(1))
        cat = "system_build" if "SYSTEM" in wct else ("timber_frame" if "TIMBER" in wct else "cavity")
        return cat, u, mass_from_category(cat), "explicit_u_value"

    if wct:
        if "FILLED CAVITY" in wct:
            u = WALL_U_FILLED_CAVITY.get(band)
            return "cavity_filled", u, "heavy", "explicit_construction_type"
        if "CAVITY WALL" in wct:
            u = WALL_U_AS_BUILT["cavity"].get(band)
            if "NO INSULATION" not in wct and "INSULATION ASSUMED" in wct:
                u = WALL_U_FILLED_CAVITY.get(band)  # treat "insulation assumed" ~ filled
            return "cavity", u, "heavy", "explicit_construction_type"
        if "SOLID BRICK" in wct or "SANDSTONE" in wct or "LIMESTONE" in wct or "GRANITE" in wct or "WHINSTONE" in wct:
            u = WALL_U_AS_BUILT["solid_brick"].get(band)
            return "solid_masonry", u, "heavy", "explicit_construction_type"
        if "SYSTEM BUILT" in wct:
            u = WALL_U_AS_BUILT["system_build"].get(band)
            return "system_build", u, "medium", "explicit_construction_type"
        if "TIMBER FRAME" in wct:
            u = WALL_U_AS_BUILT["timber_frame"].get(band)
            return "timber_frame", u, "light", "explicit_construction_type"

    # fall back: coarse wall_type + age-based default construction assumption
    wt = str(row.get("wall_type") or "").lower()
    primary = _primary_wall_material(wt)
    if primary == "brick_stone":
        if band in ("A", "B"):
            cat = "solid_masonry"
        else:
            cat = "cavity"
        u = WALL_U_AS_BUILT["solid_brick" if cat == "solid_masonry" else "cavity"].get(band)
        return cat, u, mass_from_category(cat), "wall_type_and_age_default"
    if primary == "concrete":
        u = WALL_U_AS_BUILT["system_build"].get(band)
        return "system_build", u, "medium", "wall_type_and_age_default"
    if primary == "man_made":
        u = WALL_U_AS_BUILT["timber_frame"].get(band)
        return "timber_frame", u, "light", "wall_type_and_age_default"

    # totally unknown: fall back to the age band's modal case (cavity if
    # post-1930, solid masonry if pre-1930)
    cat = "solid_masonry" if band in ("A", "B") else "cavity"
    u = WALL_U_AS_BUILT["solid_brick" if cat == "solid_masonry" else "cavity"].get(band)
    return cat, u, mass_from_category(cat), "unknown_default"


def _primary_wall_material(wt_lower):
    if "predominantly brick" in wt_lower or "predominantly stone" in wt_lower:
        return "brick_stone"
    if "predominantly man made" in wt_lower:
        return "man_made"
    parts = [p.strip() for p in wt_lower.split(",")]
    for p in parts:
        if p == "brick/stone":
            return "brick_stone"
        if p == "concrete":
            return "concrete"
        if p == "man made material":
            return "man_made"
    return "unknown"


def mass_from_category(wall_category):
    return {
        "solid_masonry": "heavy", "cavity": "heavy", "cavity_filled": "heavy",
        "system_build": "medium",
        "timber_frame": "light",
    }.get(wall_category, "medium")


def parse_roof(row, band):
    rt = str(row.get("roof_type") or "").lower()
    parts = [p.strip() for p in rt.split(",")]
    if "flat" in parts:
        category = "flat"
    elif any(p in parts for p in ("pitched tile", "tile", "slate", "pitched metal/other", "pitched asbestos")):
        category = "pitched"
    elif "complex" in parts:
        category = "complex"
    else:
        category = "unknown"
    u = ROOF_U_AS_BUILT.get(band)
    return category, u


def parse_glazing(row, band):
    gt = str(row.get("glazing_type") or "").upper()
    if not gt:
        return None, None, "missing"
    if "TRIPLE" in gt:
        return "triple", GLAZING_U["double_post2022"], "explicit"
    if "SINGLE" in gt:
        return "single", GLAZING_U["single"], "explicit"
    if "DOUBLE" in gt:
        if "AFTER 2002" in gt or "DURING OR AFTER 2002" in gt:
            return "double_post2002", GLAZING_U["double_post2002"], "explicit_dated"
        if "BEFORE 2002" in gt:
            return "double_pre2002", GLAZING_U["double_pre2002"], "explicit_dated"
        return "double_undated", GLAZING_U["double_pre2002"], "explicit"
    if "SECONDARY" in gt:
        return "secondary", GLAZING_U["double_pre2002"], "explicit"
    return None, None, "unrecognised"


def adjust_insulation_class(base_class, wall_source, wall_category, glazing_category, band):
    """+-1 nudge when we have positive evidence the actual fabric differs from
    the age band's typical assumption. See methodology doc section 4."""
    cls = base_class
    # upgrade: explicit evidence of added insulation / filled cavity where the
    # age band alone wouldn't assume it
    if wall_category == "cavity_filled" and band not in ("A", "B", "C", "D", "E"):
        pass  # already the modern default for these bands, no extra credit
    elif wall_category == "cavity_filled":
        cls = min(cls + 1, 6)
    if glazing_category in ("double_post2002", "double_pre2002", "double_undated", "triple") and band in ("A", "B", "C", "D", "E", "F"):
        cls = min(cls + 1, 6)
    # downgrade: solid masonry surviving into an era that regs would assume
    # was cavity (an unmodernised/protected building, e.g. listed)
    if wall_category == "solid_masonry" and band not in ("A", "B"):
        cls = max(cls - 1, 1)
    return cls


VULN_LABELS = {
    "trapped_heat": "Trapped heat - modern, airtight, low buffering",
    "legacy_accumulation": "Legacy accumulation - old, poorly insulated, heavyweight",
    "system_build_risk": "System-build risk - mid-era, medium mass, often flat-roofed",
    "buffered": "Buffered - decent insulation with thermal mass",
    "responsive": "Responsive - lightweight, moderate insulation",
}


def classify_vulnerability(insulation_class, mass_class, roof_category):
    """Cluster the 6x3 grid into named heatwave-vulnerability archetypes.
    Provisional theory-based grouping -- see methodology doc section 5 for
    the reasoning behind each cluster and why this is a testable hypothesis,
    not a validated risk score."""
    if insulation_class >= 5 and mass_class == "light":
        cluster = "trapped_heat"
    elif insulation_class <= 2 and mass_class == "heavy":
        cluster = "legacy_accumulation"
    elif insulation_class <= 3 and mass_class == "medium":
        cluster = "system_build_risk"
    elif mass_class == "heavy" or (mass_class == "medium" and insulation_class >= 4):
        cluster = "buffered"
    else:
        cluster = "responsive"

    flat_roof_modifier = roof_category == "flat"
    return cluster, VULN_LABELS[cluster], flat_roof_modifier


def confidence_rollup(row, age_source, wall_source):
    age_conf = row.get("premise_age_confidence")
    wall_conf = row.get("wall_type_confidence")
    scores = []
    if age_source == "exact_year":
        scores.append(1)
    elif pd.notna(age_conf):
        scores.append(age_conf)
    else:
        scores.append(5)
    if wall_source in ("explicit_u_value", "explicit_construction_type"):
        scores.append(1)
    elif pd.notna(wall_conf):
        scores.append(wall_conf)
    else:
        scores.append(5)
    worst = max(scores)  # RdSAP confidence: 1=best, 5=worst
    return "High" if worst <= 1 else "Medium" if worst <= 3 else "Low"


def main():
    df = pd.read_csv(IN_PATH)
    print(f"loaded {len(df)} matched schools")

    out_rows = []
    for _, row in df.iterrows():
        year, band, mixed_era, age_source = parse_age(row)
        if band is None:
            out_rows.append({
                "urn": row["urn"], "name": row["name"], "la": row["la"], "region": row["region"],
                "age_band": None, "insulation_class": None, "insulation_class_label": "Unclassified (no age data)",
                "thermal_mass_class": None, "wall_category": None, "wall_u": None,
                "roof_category": None, "roof_u": None, "glazing_category": None, "glazing_u": None,
                "vulnerability_cluster": None, "vulnerability_label": "Unclassified (no age data)",
                "flat_roof_modifier": None, "mixed_era": mixed_era,
                "classification_confidence": "Low", "age_source": age_source,
            })
            continue

        base_class = INSULATION_CLASS[band]
        wall_category, wall_u, mass_class, wall_source = parse_wall(row, band)
        roof_category, roof_u = parse_roof(row, band)
        glazing_category, glazing_u, glazing_source = parse_glazing(row, band)

        insulation_class = adjust_insulation_class(base_class, wall_source, wall_category, glazing_category, band)
        cluster, cluster_label, flat_modifier = classify_vulnerability(insulation_class, mass_class, roof_category)
        confidence = confidence_rollup(row, age_source, wall_source)

        out_rows.append({
            "urn": row["urn"], "name": row["name"], "la": row["la"], "region": row["region"],
            "age_band": band, "insulation_class": insulation_class,
            "insulation_class_label": INSULATION_CLASS_LABEL[insulation_class],
            "thermal_mass_class": mass_class,
            "wall_category": wall_category, "wall_u": wall_u,
            "roof_category": roof_category, "roof_u": roof_u,
            "glazing_category": glazing_category, "glazing_u": glazing_u,
            "vulnerability_cluster": cluster, "vulnerability_label": cluster_label,
            "flat_roof_modifier": flat_modifier, "mixed_era": mixed_era,
            "classification_confidence": confidence, "age_source": age_source,
        })

    out = pd.DataFrame(out_rows)
    out.to_csv(OUT_PATH, index=False)
    print(f"wrote {OUT_PATH} ({len(out)} rows)")

    print(f"\n{'='*60}")
    print("age band distribution:")
    print(out["age_band"].value_counts(dropna=False).sort_index())
    print("\ninsulation class distribution:")
    print(out["insulation_class"].value_counts(dropna=False).sort_index())
    print("\nthermal mass distribution:")
    print(out["thermal_mass_class"].value_counts(dropna=False))
    print("\nvulnerability cluster distribution:")
    print(out["vulnerability_cluster"].value_counts(dropna=False))
    print("\nflat roof modifier (of classified rows):")
    print(out["flat_roof_modifier"].value_counts(dropna=False))
    print("\nconfidence distribution:")
    print(out["classification_confidence"].value_counts(dropna=False))
    print("\nmixed era buildings:", out["mixed_era"].sum())


if __name__ == "__main__":
    main()
