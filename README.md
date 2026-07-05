# Heatwave School Closures · Impact Benchmark

A static dashboard estimating the **economic** and **learning** impact of
heatwave-driven school closures in England, and how that impact scales with
global warming.

**Model logic:** schools close on a **red** heat-health alert. A user-set share
of **amber** alerts is assumed to escalate to red. Amber-alert frequency per
local authority at each global warming level comes from the
[UK Climate Risk Indicators](https://uk-cri.org) tool; school and pupil counts
come from DfE [Get Information about Schools](https://get-information-schools.service.gov.uk).

- **Tab 1 — Single event:** impact of one red-alert closure across a selectable
  set of local authorities (duration and closure share adjustable).
- **Tab 2 — Climate outlook:** annual impact at a chosen warming level
  (Recent / 1.5 / 2 / 3 / 4 °C), using projected alert frequency.

Every valuation parameter is editable in the **Sources & Assumptions** panel,
which distinguishes evidenced figures (Coram, ONS, DfE) from scenario
assumptions. No long-run learning penalty is applied — closures are treated as
brief, non-cumulative events.

## Stack

Vite + React 19 + Recharts. Deployed to GitHub Pages via Actions.

```bash
npm install
npm run build-data   # regenerate src/data/localAuthorities.json from data/raw/
npm run dev          # local dev server
npm run build        # production build → dist/
```

## Data pipeline

`scripts/build_data.mjs` merges two raw extracts placed in `data/raw/`:

| File | Source |
|---|---|
| `edubasealldata<YYYYMMDD>.csv` | GIAS bulk establishment download (England) |
| `heathealth_null_events_ghadgem_dt_lau1.csv` | CRI amber heat-health alerts/year, LAU1, warming-level scenario |

CRI is at lower-tier district level; GIAS records schools against ~150 education
LAs. The script rolls CRI districts up to the GIAS LA (mean amber rate), using
an ONS district→upper-tier lookup (`scripts/geo/ltla_utla_lookup.json`) plus
manual aliases (`scripts/geo/la_aliases.json`) for pre-reorganisation codes. The
merged, committed artifact is `src/data/localAuthorities.json`. The large GIAS
CSV is git-ignored; re-download it from GIAS to rebuild.

## Deployment

Push to `main` triggers `.github/workflows/deploy.yml` (build → GitHub Pages).
In the repo settings, set **Pages → Source → GitHub Actions**.

## Attribution

Climate data © University of Reading / Institute for Environmental Analytics,
UK Climate Risk Indicators, CC-BY 4.0. School data © Crown copyright, DfE GIAS.
Illustrative planning tool — not a forecast.
