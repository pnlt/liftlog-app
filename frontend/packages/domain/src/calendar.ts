/** A wall-calendar representation for grouping/labels, never a stored event timestamp. */
export function calendarDate(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value)
  return new Date(value('year'), value('month') - 1, value('day'), 12)
}
