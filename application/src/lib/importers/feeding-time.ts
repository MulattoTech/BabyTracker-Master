import type { ExternalImportFeedRecord } from '@/src/types/external-import';

const timestampPattern = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,3})?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/;

/** Keep source precision and explicit offsets; never let Date normalize an invalid calendar day. */
export function normalizeFeedingTimestamp(value: string): string {
  const match = value.trim().match(timestampPattern);
  if (!match) throw new Error('Invalid feeding timestamp. Use YYYY-MM-DD HH:mm:ss with an optional UTC offset.');
  const [, date, hour, minute, second, fraction = '', offset = ''] = match;
  const wall = `${date}T${hour}:${minute}:${second}${fraction}`;
  const parsed = new Date(`${wall}Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== wall.slice(0, 19)) {
    throw new Error('Invalid feeding calendar date. Correct the source before importing.');
  }
  const normalizedOffset = offset && offset !== 'Z' && !offset.includes(':')
    ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
  return wall + normalizedOffset;
}

/** Resolve naive feeding timestamps only when the selected zone gives exactly one instant.
 * The bounded offset roundtrip mirrors the OCR resolver, retaining seconds/milliseconds. */
export function resolveFeedingTimestamp(value: string, sourceTimezone: string): Date {
  const normalized = normalizeFeedingTimestamp(value);
  if (!sourceTimezone.trim()) throw new Error('Source timezone is required');
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: sourceTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch { throw new Error('Invalid source timezone. Choose a valid timezone before importing.'); }
  // An offset already identifies the source instant, even if the selected zone differs.
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) return new Date(normalized);

  const parts = (stamp: number): string => {
    const date = new Date(stamp);
    const fields = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${fields.year.padStart(4, '0')}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}.${String(date.getUTCMilliseconds()).padStart(3, '0')}`;
  };
  const naive = Date.parse(`${normalized}Z`);
  const expected = new Date(naive).toISOString().slice(0, -1);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const stamp = naive + hours * 3_600_000;
    offsets.add(Date.parse(`${parts(stamp)}Z`) - stamp);
  }
  const candidates = [...offsets].map(offset => naive - offset).filter(stamp => parts(stamp) === expected);
  if (candidates.length === 0) throw new Error('This feeding time does not exist in the source timezone because the clock changed. Correct the source time before importing.');
  if (candidates.length !== 1) throw new Error('This feeding time is ambiguous because the clock repeats. Include the source UTC offset, such as -05:00 or -06:00, before importing.');
  return new Date(candidates[0]);
}

export function resolveExternalImportFeedTiming(record: ExternalImportFeedRecord, sourceTimezone: string) {
  const time = resolveFeedingTimestamp(record.time, sourceTimezone);
  if ((record.startTime !== undefined) !== (record.endTime !== undefined)) {
    throw new Error('Both feeding start and end timestamps are required to import a timed session.');
  }
  const startTime = record.startTime !== undefined ? resolveFeedingTimestamp(record.startTime, sourceTimezone) : undefined;
  const endTime = record.endTime !== undefined ? resolveFeedingTimestamp(record.endTime, sourceTimezone) : undefined;
  const feedDuration = startTime && endTime ? (endTime.getTime() - startTime.getTime()) / 1000 : record.feedDuration;
  if (feedDuration !== undefined && (!Number.isInteger(feedDuration) || feedDuration < 0 || feedDuration > 2_147_483_647)) {
    throw new Error('Feeding duration must be a non-negative whole number of seconds. Check the source start and end timestamps.');
  }
  if (startTime && endTime && record.feedDuration !== undefined && record.feedDuration !== feedDuration) {
    throw new Error('Feeding duration conflicts with the source start and end timestamps.');
  }
  return { time, startTime, endTime, feedDuration };
}
