// model.js — pure impact calculations + sourced default parameters.
// No React here; everything is unit-testable plain functions.

// Warming-level toggle metadata (keys match localAuthorities.json `amber`).
export const LEVELS = [
  { key: '0.61', label: 'Recent', sub: '≈0.6°C', short: 'Recent' },
  { key: '1.5', label: '1.5°C', sub: 'Paris lower', short: '1.5°C' },
  { key: '2', label: '2°C', sub: 'Paris upper', short: '2°C' },
  { key: '3', label: '3°C', sub: 'current-policy', short: '3°C' },
  { key: '4', label: '4°C', sub: 'high emissions', short: '4°C' },
]

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
    default: 0.50, min: 0, max: 1, step: 0.05, kind: 'percent', evidenced: false,
    label: 'Schools closing on a red alert',
    note: 'Modelling assumption. Not all schools close during a red alert (mitigation, '
      + 'estate differences); this sets the proportion that do.',
    source: null,
  },
  redAlertDurationDays: {
    default: 2, min: 1, max: 7, step: 1, kind: 'days', evidenced: false,
    label: 'Red alert duration',
    note: 'Modelling assumption for the length of a closure event.',
    source: null,
  },
  // ---- evidenced figures ----
  costPerFamilyPerDay: {
    default: 70, min: 0, max: 300, step: 5, kind: 'gbp', evidenced: true,
    label: 'Economic cost per family per closure day',
    note: 'Proxy for a caregiver’s lost work / replacement childcare for one day. '
      + 'Coram’s Childcare Survey 2025 puts unfunded full-day care at roughly £47–£95/day; '
      + '£70 is a mid-range default.',
    source: { name: 'Coram Family & Childcare, Childcare Survey 2025', url: 'https://www.coram.org.uk/resource/childcare-survey-2025/' },
  },
  childrenPerFamily: {
    default: 1.75, min: 1, max: 3, step: 0.05, kind: 'number', evidenced: true,
    label: 'School-age children per family',
    note: 'Converts affected pupils into affected families (avoids counting siblings '
      + 'twice). ONS 2024: 44.3% of families with dependent children have one, 40.8% two, '
      + '14.8% three or more.',
    source: { name: 'ONS, Families and households, UK: 2024', url: 'https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/families/bulletins/familiesandhouseholds/2024' },
  },
  schoolDaysPerYear: {
    default: 190, min: 150, max: 220, step: 1, kind: 'days', evidenced: true,
    label: 'School days per year',
    note: 'Used only to express lost learning as a share of a school year. '
      + 'Statutory minimum in England is 190 school days.',
    source: { name: 'DfE / The Education (School Day and School Year) (England) Regulations', url: 'https://www.gov.uk/school-attendance-absence' },
  },
}

// Reference note about the lost-learning framing (context, shown in UI).
export const LEARNING_SOURCE = {
  name: 'EEF, Impact of COVID-19 on learning (context only)',
  url: 'https://educationendowmentfoundation.org.uk/education-evidence/covid-19-resources',
  note: 'Lost learning is reported as pupil-days of instruction lost. Following the '
    + 'brief, non-cumulative nature of heat closures, no long-run earnings penalty is applied.',
}

export const defaultParams = () =>
  Object.fromEntries(Object.entries(PARAM_DEFS).map(([k, v]) => [k, v.default]))

// ---- core calculations ------------------------------------------------------

// Impact of a single red-alert closure event for one local authority.
export function perEventImpact(la, p) {
  const schoolsClosed = Math.round(la.schools * p.schoolClosureFraction)
  const pupilsAffected = la.pupils * p.schoolClosureFraction
  const familiesAffected = pupilsAffected / p.childrenPerFamily
  const economicImpact = familiesAffected * p.costPerFamilyPerDay * p.redAlertDurationDays
  const learningDaysLost = pupilsAffected * p.redAlertDurationDays // pupil-days
  return { schoolsClosed, pupilsAffected, familiesAffected, economicImpact, learningDaysLost }
}

// Annual impact for one LA at a given warming level.
export function annualImpact(la, levelKey, p) {
  const amber = la.amber?.[levelKey] ?? 0
  const redEventsPerYear = amber * p.amberToRedFraction
  const ev = perEventImpact(la, p)
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
      annualEconomic: a.annualEconomic,
      annualLearning: a.annualLearning,
    }
  })

// Lost pupil-days expressed as equivalent share of a school year (per pupil).
export const learningYearsEquivalent = (pupilDays, pupils, schoolDaysPerYear) =>
  pupils > 0 ? pupilDays / pupils / schoolDaysPerYear : 0
