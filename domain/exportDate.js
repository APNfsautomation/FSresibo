// Export filenames use the Philippine calendar date (Asia/Manila, UTC+8, no daylight saving), whatever the device's timezone is.
// The parts are extracted explicitly, so the result never depends on a locale's date ordering. Only the filename is affected:
// receipt dates, database timestamps and archive timestamps are untouched.
const manilaDateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });
export function philippineDateStamp(date = new Date()) {
  const parts = Object.fromEntries(manilaDateParts.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
