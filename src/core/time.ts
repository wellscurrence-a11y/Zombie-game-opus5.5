// Game clock helpers. Game time is measured in hours since the outbreak began (day 1, 00:00).

export const START_HOUR = 9;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The outbreak begins on September 6th. */
const START_DAY_OF_YEAR = 248;

export function timeScale(dayLengthMin: number): number {
  return 86400 / (dayLengthMin * 60);
}

export function hourOfDay(t: number): number {
  return ((t % 24) + 24) % 24;
}

export function dayNumber(t: number): number {
  return Math.floor(t / 24) + 1;
}

export function clockString(t: number, precise = true): string {
  const h = hourOfDay(t);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  if (!precise) {
    if (h < 5) return 'Night';
    if (h < 8) return 'Dawn';
    if (h < 12) return 'Morning';
    if (h < 14) return 'Midday';
    if (h < 18) return 'Afternoon';
    if (h < 21) return 'Evening';
    return 'Night';
  }
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
}

export function dateString(t: number): string {
  const doy = START_DAY_OF_YEAR + Math.floor(t / 24);
  const d = new Date(Date.UTC(2031, 0, 1) + doy * 86400000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Day of the year (for seasonal temperature). */
export function dayOfYear(t: number): number {
  return (START_DAY_OF_YEAR + Math.floor(t / 24)) % 365;
}

/** 0 at night, 1 at full day, smooth dawn/dusk. Sunrise/sunset shift with the season. */
export function daylight(t: number): number {
  const h = hourOfDay(t);
  const doy = dayOfYear(t);
  // Late summer ~6:30-19:45, winter ~7:30-17:00.
  const season = Math.cos(((doy - 172) / 365) * Math.PI * 2); // 1 at midsummer, -1 midwinter
  const rise = 6.9 - season * 0.9;
  const set = 18.4 + season * 1.5;
  if (h < rise - 0.8 || h > set + 0.8) return 0;
  if (h < rise + 0.8) return (h - (rise - 0.8)) / 1.6;
  if (h > set - 0.8) return 1 - (h - (set - 0.8)) / 1.6;
  return 1;
}

export function formatDuration(hours: number): string {
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  if (d > 0) return `${d} day${d === 1 ? '' : 's'}, ${h} hour${h === 1 ? '' : 's'}`;
  const m = Math.floor((hours % 1) * 60);
  return `${h} hour${h === 1 ? '' : 's'}, ${m} min`;
}
