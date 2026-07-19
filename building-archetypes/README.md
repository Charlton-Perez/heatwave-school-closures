# School Building Archetypes

Data pipeline to characterise the **buildings** of every setting in the Heatwave
School Closures dashboard, so settings can later be grouped into building
archetypes (form/era/construction). Kept separate from the dashboard app; it
produces data, not UI.

## Scope

Matches the closure dashboard's setting universe exactly (see
`../scripts/build_data.mjs`): **open**, mainstream-phase (Primary, Secondary,
All-through, Middle deemed primary/secondary, Nursery), **England** schools —
**20,462** settings.

## Pipeline

| Step | Script | Output |
|---|---|---|
| GIAS spine (one row per setting: URN, point, phase, type, capacity…) | `build_spine.py` | `data/spine.csv` |
| Area-of-interest + download sizing | `build_aoi.py` | `data/aoi_*.geojson` |
| _next:_ OS NGD Buildings join (footprint, height, use) | _tbd_ | _tbd_ |

`build_spine.py` reads the GIAS extract from the dashboard's `../data/raw/`
(git-ignored there). Flags: `--all-open` (all phases), `--all` (any status).

## Data sources

- **OS NGD Buildings** — morphology (footprint, height, building use). Via EDINA
  Digimap (national bulk download) or OS Data Hub. See session notes.
- **DfE RAAC list** — public; a construction flag. _to fetch_
- **DfE Condition Data Collection** — the only source with real construction
  materials, but not open data; needs a DfE data-sharing agreement. _phase 2_

## Note on scale

The 20,462 settings span ~1,365 OS 10 km squares — effectively all populated
England — so per-site AOI/tile downloads are impractical here. Use a **national**
NGD Buildings download, then clip to `data/spine.csv` points locally.
