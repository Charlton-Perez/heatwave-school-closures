#!/usr/bin/env node
/**
 * build_data.mjs — merges GIAS school/pupil data with UK Climate Risk Indicators
 * (uk-cri.org) amber heat-health-alert frequencies into a single static JSON
 * consumed by the dashboard.
 *
 *   Inputs  (data/raw/):
 *     - edubasealldata<YYYYMMDD>.csv   GIAS bulk establishment extract (England)
 *     - heathealth_null_events_ghadgem_dt_lau1.csv   CRI amber alerts/yr, LAU1,
 *       warming-level scenario. Columns: year(=warming level °C), location(GSS),
 *       lowest,2nd_low,median,2nd_high,highest,m1..m15.
 *   Lookups (scripts/geo/):
 *     - ltla_utla_lookup.json  ONS district(GSS) -> upper-tier authority name
 *     - la_aliases.json        manual fixes for pre-reorganisation CRI codes
 *   Output:
 *     - src/data/localAuthorities.json
 *
 * Geography: GIAS records schools against ~150 England education LAs (upper-tier
 * / unitary). CRI is at lower-tier district level. We roll CRI districts up to
 * the GIAS LA and take the MEAN amber rate across constituent districts.
 *
 * Run: npm run build-data
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(ROOT, 'data', 'raw')
const GEO = join(ROOT, 'scripts', 'geo')

// Warming levels exposed by the dashboard toggle (°C above pre-industrial).
// 0.61 is the CRI baseline (recent-climate) row.
const LEVELS = ['0.61', '1.5', '2', '3', '4']
// Mainstream, compulsory-age + nursery phases whose closure affects families.
const PHASES = new Set([
  'Primary', 'Secondary', 'All-through',
  'Middle deemed primary', 'Middle deemed secondary', 'Nursery',
])

// --- minimal RFC-4180 CSV parser (handles quoted fields w/ commas & newlines) -
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const norm = (s) => s.toLowerCase().trim()
  .replace(/&/g, 'and').replace(/[.,']/g, '')
  .replace(/\bcity of\b/g, '').replace(/\bcounty of\b/g, '')
  .replace(/\s+/g, ' ').trim()

// --- load lookups ------------------------------------------------------------
const ons = JSON.parse(readFileSync(join(GEO, 'ltla_utla_lookup.json'), 'utf8'))
const gss2utla = {}
for (const f of ons.features) gss2utla[f.attributes.LTLA23CD] = f.attributes.UTLA23NM
const aliases = JSON.parse(readFileSync(join(GEO, 'la_aliases.json'), 'utf8'))

// district GSS -> region (the 9 English regions UKHSA uses for heat-health alerts)
const ladRgn = JSON.parse(readFileSync(join(GEO, 'lad_rgn_lookup.json'), 'utf8'))
const gss2region = {}
for (const f of ladRgn.features) gss2region[f.attributes.LAD23CD] = f.attributes.RGN23NM
// Regions for LAs whose CRI districts predate the 2023 lookup (reorganised unitaries).
const REGION_FALLBACK = {
  'Cumberland': 'North West',
  'Westmorland and Furness': 'North West',
  'North Northamptonshire': 'East Midlands',
  'West Northamptonshire': 'East Midlands',
  'Somerset': 'South West',
  'Dorset': 'South West',
  'Bournemouth, Christchurch and Poole': 'South West',
  'North Yorkshire': 'Yorkshire and The Humber',
  'Buckinghamshire': 'South East',
  'Suffolk': 'East of England',
}

// --- parse GIAS --------------------------------------------------------------
const giasFile = readdirSync(RAW).find((f) => /^edubasealldata.*\.csv$/i.test(f))
if (!giasFile) throw new Error('GIAS extract not found in data/raw/')
const giasDate = (giasFile.match(/(\d{8})/) || [])[1] || 'unknown'
const giasRows = parseCSV(readFileSync(join(RAW, giasFile), 'latin1'))
const gHead = giasRows[0]
const gi = (name) => gHead.indexOf(name)
const [cLaCode, cLaName, cStatus, cPhase, cPupils] =
  ['LA (code)', 'LA (name)', 'EstablishmentStatus (name)',
    'PhaseOfEducation (name)', 'NumberOfPupils'].map(gi)

const OVERSEAS = new Set(['000', '701', '702', '704', '705', '706', '707', '708'])
const isEnglandLA = (code) =>
  !OVERSEAS.has(code) && !(Number(code) >= 660 && Number(code) <= 699) // 66x-69x = Wales

const las = new Map() // dfeCode -> { laName, schools, pupils }
for (let r = 1; r < giasRows.length; r++) {
  const row = giasRows[r]
  if (row.length < gHead.length) continue
  if (row[cStatus] !== 'Open') continue
  if (!PHASES.has(row[cPhase])) continue
  const code = row[cLaCode]
  if (!isEnglandLA(code)) continue
  const pupils = parseInt(row[cPupils], 10)
  if (!las.has(code)) las.set(code, {
    laName: row[cLaName], schools: 0, pupils: 0,
    pupilsPrimary: 0,    // Reception–Y6, Nursery, Middle deemed primary
    pupilsSecondary: 0,  // Y7–Y13, All-through, Middle deemed secondary
  })
  const la = las.get(code)
  la.schools += 1
  la.pupils += Number.isFinite(pupils) ? pupils : 0
  // Phase-bucket accumulation for supervision discount model
  if (['Primary', 'Nursery', 'Middle deemed primary'].includes(row[cPhase])) {
    la.pupilsPrimary += Number.isFinite(pupils) ? pupils : 0
  } else if (['Secondary', 'All-through', 'Middle deemed secondary'].includes(row[cPhase])) {
    la.pupilsSecondary += Number.isFinite(pupils) ? pupils : 0
  }
}
const byNorm = new Map() // normalised LA name -> dfeCode
for (const [code, la] of las) byNorm.set(norm(la.laName), code)

// --- parse CRI ---------------------------------------------------------------
const criFile = readdirSync(RAW).find((f) => /^heathealth.*lau1\.csv$/i.test(f))
if (!criFile) throw new Error('CRI extract not found in data/raw/')
const criRows = parseCSV(readFileSync(join(RAW, criFile), 'utf8'))
const cHead = criRows[0].map((h) => h.trim())
const yIdx = cHead.indexOf('year')
const locIdx = cHead.indexOf('location')
const medIdx = cHead.indexOf('median')

const lvlKey = (yearStr) => {
  const v = parseFloat(yearStr)
  if (Math.abs(v - 0.61) < 0.001) return '0.61'
  for (const L of ['1.5', '2', '3', '4']) if (Math.abs(v - parseFloat(L)) < 0.001) return L
  return null
}
const resolveLA = (gss) => {
  if (aliases[gss] && !gss.startsWith('_')) return norm(aliases[gss])
  const utla = gss2utla[gss]
  return utla ? norm(utla) : null
}

// LA dfeCode -> level -> [district medians]
const amberAcc = new Map()
const regionAcc = new Map() // dfeCode -> region name (from constituent districts)
const unmatchedGss = new Set()
for (let r = 1; r < criRows.length; r++) {
  const row = criRows[r]
  const gss = (row[locIdx] || '').trim()
  if (!gss.startsWith('E')) continue // England only
  const key = lvlKey(row[yIdx])
  if (!key) continue
  const nrm = resolveLA(gss)
  const dfe = nrm && byNorm.get(nrm)
  if (!dfe) { unmatchedGss.add(gss); continue }
  if (!regionAcc.has(dfe) && gss2region[gss]) regionAcc.set(dfe, gss2region[gss])
  if (!amberAcc.has(dfe)) amberAcc.set(dfe, {})
  const bucket = amberAcc.get(dfe)
  ;(bucket[key] ||= []).push(parseFloat(row[medIdx]))
}

// --- assemble output ---------------------------------------------------------
const out = []
const noAmber = []
const noRegion = []
for (const [code, la] of las) {
  const acc = amberAcc.get(code)
  if (!acc) { noAmber.push(`${code} ${la.laName}`); continue }
  const amber = {}
  for (const L of LEVELS) {
    const arr = acc[L] || []
    amber[L] = arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(4) : null
  }
  const region = regionAcc.get(code) || REGION_FALLBACK[la.laName] || null
  if (!region) noRegion.push(`${code} ${la.laName}`)
  out.push({ dfeCode: code, laName: la.laName, region, schools: la.schools, pupils: la.pupils, pupilsPrimary: la.pupilsPrimary, pupilsSecondary: la.pupilsSecondary, amber })
}
out.sort((a, b) => a.laName.localeCompare(b.laName))

const payload = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    giasExtract: giasDate,
    criFile,
    warmingLevels: LEVELS,
    laCount: out.length,
    regions: [...new Set(out.map((l) => l.region).filter(Boolean))].sort(),
    note: 'England only. Amber = median amber heat-health alerts/year (CRI, UKCP18 '
      + 'Global HadGEM, warming-level scenario), districts aggregated to GIAS '
      + 'education LA by simple mean. Schools = open mainstream/nursery establishments. '
      + 'Region = the 9 ONS/UKHSA English regions used for heat-health alerting.',
  },
  localAuthorities: out,
}
writeFileSync(join(ROOT, 'src', 'data', 'localAuthorities.json'),
  JSON.stringify(payload, null, 0) + '\n')

// --- report ------------------------------------------------------------------
console.log(`GIAS extract:        ${giasFile} (${giasDate})`)
console.log(`England education LAs: ${las.size}`)
console.log(`LAs with amber data:   ${out.length}`)
console.log(`Total schools:         ${out.reduce((s, l) => s + l.schools, 0).toLocaleString()}`)
console.log(`Total pupils:          ${out.reduce((s, l) => s + l.pupils, 0).toLocaleString()}`)
if (noRegion.length) {
  console.log(`\n⚠ ${noRegion.length} LA(s) with NO region:`)
  noRegion.forEach((x) => console.log('   ' + x))
}
if (noAmber.length) {
  console.log(`\n⚠ ${noAmber.length} LA(s) with NO amber match:`)
  noAmber.forEach((x) => console.log('   ' + x))
}
if (unmatchedGss.size) {
  console.log(`\n⚠ ${unmatchedGss.size} CRI GSS code(s) unmatched: ${[...unmatchedGss].join(', ')}`)
}
console.log('\n✓ wrote src/data/localAuthorities.json')
