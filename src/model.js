// model.js — pure impact calculations + sourced default parameters.
// No React here; everything is unit-testable plain functions.

// Warming-level toggle metadata (keys match localAuthorities.json `amber`).
// The "0.61" baseline is UK-CRI's figure for how much warmer the 1981-2010
// observed-climate period was than the 1850-1900 pre-industrial average — see
// BASELINE_NOTE below for the important caveat that the climate has warmed
// further in the ~15 years since that period ended.
export const LEVELS = [
  { key: '0.61', label: '1980-2010 climate', sub: '0.61°C vs pre-industrial', short: '1980-2010' },
  { key: '1.5',  label: '1.5°C',  sub: 'Paris lower', short: '1.5°C' },
  { key: '2',    label: '2°C',    sub: 'Paris upper',  short: '2°C' },
  { key: '3',    label: '3°C',    sub: 'current-policy', short: '3°C' },
  { key: '4',    label: '4°C',    sub: 'high emissions', short: '4°C' },
]

// Shown as a footnote on the warming-level card.
export const BASELINE_NOTE = '1980-2010 climate = the observed 1981–2010 period, which '
  + 'UK-CRI\'s methodology states was 0.61°C warmer than the 1850–1900 pre-industrial '
  + 'average. The climate has continued to warm in the ~15 years since that period ended, '
  + 'so the true current warming level is higher than this baseline figure.'

// Default parameters. `evidenced` distinguishes sourced figures from scenario
// assumptions; the UI renders these with their citations.
export const PARAM_DEFS = {
  // ---- scenario assumptions (user-adjustable, no external source) ----
  amberToRedFraction: {
    default: 0.30, min: 0, max: 1, step: 0.05, kind: 'percent', evidenced: false,
    label: 'Amber alerts escalating to red',
    note: 'Modelling assumption. Schools are assumed to close only on a red alert; '
      + 'this sets what share of amber heat-health alerts reach red severity.',
    source: null,
  },
  schoolClosureFraction: {
    default: 0.35, min: 0, max: 1, step: 0.05, kind: 'percent', evidenced: false,
    topControl: true,
    label: 'Schools closing on a red alert',
    note: 'The primary control (shown at the top of the page). Share of schools in the '
      + 'alerted regions that close. In the June 2026 red alert an estimated ~2,000 '
      + 'schools closed, concentrated in the south and south-east; against the school '
      + 'stock of that footprint this is roughly 35%, the default here.',
    source: null,
  },
  redAlertDurationDays: {
    default: 2, min: 1, max: 7, step: 1, kind: 'days', evidenced: false,
    label: 'Red alert duration',
    note: 'Modelling assumption for the length of a closure event. Both observed UK red '
      + 'heat-health alerts (July 2022, June 2026) lasted 2 days at full red severity.',
    source: null,
  },
  // ---- evidenced figures ----
  costPerFamilyPerDay: {
    default: 145, min: 0, max: 400, step: 5, kind: 'gbp', evidenced: true,
    label: 'Economic cost per disrupted family per closure day',
    note: 'Valued as the opportunity cost of the caregiver\'s lost day, following HM '
      + 'Treasury Green Book guidance on valuing time (lost output at the market wage). '
      + 'Anchored to ONS ASHE 2024 median full-time gross earnings of £728/week '
      + '(≈ £146/day). Applied only to supervision-adjusted families (see the supervision '
      + 'factor below).',
    source: { name: 'HM Treasury, The Green Book (value of time); ONS ASHE 2024', url: 'https://www.gov.uk/government/publications/the-green-book-appraisal-and-evaluation-in-central-government' },
  },
  childrenPerFamily: {
    default: 1.75, min: 1, max: 3, step: 0.05, kind: 'number', evidenced: true,
    label: 'School-age children per family',
    note: 'Converts affected pupils into affected families — avoids double-counting '
      + 'siblings in the same household. ONS 2024: 44.3% of families with dependent '
      + 'children have one, 40.8% two, 14.8% three or more.',
    source: { name: 'ONS, Families and households, UK: 2024', url: 'https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/families/bulletins/familiesandhouseholds/2024' },
  },
  supervisionDiscountKS3: {
    default: 0.55, min: 0, max: 1, step: 0.05, kind: 'number', evidenced: false,
    label: 'Supervision factor — KS3 (Y7–9, age 11–14)',
    note: 'Fraction of families with a Y7–9 child who face genuine work disruption on a '
      + 'closure day. Primary-age pupils (R–Y6) and all SEND pupils are assumed to require '
      + 'full supervision (factor 1.0). Y7–9 is partial: most can be left briefly but '
      + 'most parents make some adjustment. KS4 (Y10–11) is fixed at 0.20; sixth form '
      + '(Y12–13) at 0.05. These are scenario assumptions — no published UK source '
      + 'directly measures this elasticity.',
    source: null,
  },
  schoolDaysPerYear: {
    default: 190, min: 150, max: 220, step: 1, kind: 'days', evidenced: true,
    label: 'School days per year',
    note: 'Used to express lost learning as a share of a school year and to accumulate '
      + 'career-level learning loss. Statutory minimum in England is 190 school days.',
    source: { name: 'DfE / The Education (School Day and School Year) (England) Regulations', url: 'https://www.gov.uk/school-attendance-absence' },
  },
}

// Reference note about the lost-learning framing (shown in UI).
export const LEARNING_SOURCE = {
  name: 'EEF, Impact of COVID-19 on learning (context); NFER post-COVID analysis',
  url: 'https://educationendowmentfoundation.org.uk/education-evidence/covid-19-resources',
  note: 'Lost learning is reported as pupil-days of instruction lost and as a share of '
    + 'the school year. Heat closures are brief and isolated, so no long-run earnings '
    + 'penalty is applied. Career accumulation (climate tab) sums expected closure days '
    + 'across a 14-year school journey (Reception through Year 13) at a fixed GWL.',
}

export const defaultParams = () =>
  Object.fromEntries(Object.entries(PARAM_DEFS).map(([k, v]) => [k, v.default]))

// ── core calculations ─────────────────────────────────────────────────────────

// Phase-weighted effective family count.
// Secondary roll is split proportionally: 3/7 KS3, 2/7 KS4, 2/7 KS5.
// Supervision factors: Primary/SEND 1.0 | KS3 p.supervisionDiscountKS3 | KS4 0.20 | KS5 0.05
// If phase breakdown is absent (older data), falls back to flat primary treatment.
function effectiveFamilies(prim, sec, p) {
  const primWeighted = prim * 1.00
  const ks3Weighted  = sec * (3 / 7) * p.supervisionDiscountKS3
  const ks4Weighted  = sec * (2 / 7) * 0.20
  const ks5Weighted  = sec * (2 / 7) * 0.05
  return (primWeighted + ks3Weighted + ks4Weighted + ks5Weighted) / p.childrenPerFamily
}

// Impact of a single red-alert closure event for one local authority.
export function perEventImpact(la, p) {
  const schoolsClosed  = Math.round(la.schools * p.schoolClosureFraction)
  const pupilsAffected = la.pupils * p.schoolClosureFraction

  // Phase-split affected pupils (fallback: treat all as primary if no breakdown)
  const primAffected = (la.pupilsPrimary   ?? la.pupils) * p.schoolClosureFraction
  const secAffected  = (la.pupilsSecondary ?? 0)         * p.schoolClosureFraction

  const familiesAffected = effectiveFamilies(primAffected, secAffected, p)
  const economicImpact   = familiesAffected * p.costPerFamilyPerDay * p.redAlertDurationDays

  // Learning: all affected pupils lose instruction regardless of age
  const learningDaysLost = pupilsAffected * p.redAlertDurationDays

  return { schoolsClosed, pupilsAffected, familiesAffected, economicImpact, learningDaysLost }
}

// Annual impact for one LA at a given warming level.
export function annualImpact(la, levelKey, p) {
  const amber            = la.amber?.[levelKey] ?? 0
  const redEventsPerYear = amber * p.amberToRedFraction
  const ev               = perEventImpact(la, p)
  return {
    ...ev,
    amberPerYear: amber,
    redEventsPerYear,
    annualEconomic: redEventsPerYear * ev.economicImpact,
    annualLearning: redEventsPerYear * ev.learningDaysLost,
  }
}

// Sum a per-LA metric fn across a list of LAs.
export function totals(las, fn) {
  return las.reduce((acc, la) => {
    const r = fn(la)
    for (const k in r) acc[k] = (acc[k] || 0) + r[k]
    return acc
  }, {})
}

// Single-event totals across a set of LAs.
export const singleEventTotals = (las, p) => totals(las, (la) => perEventImpact(la, p))

// Annual totals across a set of LAs at a warming level.
export const annualTotals = (las, levelKey, p) =>
  totals(las, (la) => {
    const a = annualImpact(la, levelKey, p)
    return {
      redEventsPerYear: a.redEventsPerYear,
      annualEconomic:   a.annualEconomic,
      annualLearning:   a.annualLearning,
    }
  })

// Lost pupil-days as a fraction of one school year, per affected pupil.
export const learningYearsEquivalent = (pupilDays, pupils, schoolDaysPerYear) =>
  pupils > 0 ? pupilDays / pupils / schoolDaysPerYear : 0

// ── learning loss: career & decade accumulation ───────────────────────────────

// Expected closure days accumulated over a pupil's full school career (14 years,
// Reception through Y13), assuming climate stabilises at the given GWL.
// This is a GWL snapshot applied over career length — not a warming trajectory.
export function careerLearningLoss(la, levelKey, p) {
  const amber            = la.amber?.[levelKey] ?? 0
  const redEventsPerYear = amber * p.amberToRedFraction
  const closureDaysPerYear = redEventsPerYear * p.redAlertDurationDays * p.schoolClosureFraction
  const careerYears      = 14  // R through Y13
  return closureDaysPerYear * careerYears
}

// Expected closure days accumulated per pupil over 10 years at a fixed GWL.
export function decadeLearningLoss(la, levelKey, p) {
  const amber            = la.amber?.[levelKey] ?? 0
  const redEventsPerYear = amber * p.amberToRedFraction
  return redEventsPerYear * p.redAlertDurationDays * p.schoolClosureFraction * 10
}
