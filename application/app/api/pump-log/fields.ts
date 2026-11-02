import { convertVolume, normalizeVolumeUnit, SUPPORTED_VOLUME_UNITS } from '@/src/utils/unit-conversion';

type PumpFields = {
  startTime?: Date;
  endTime?: Date;
  duration?: number | null;
  leftAmount?: number | null;
  rightAmount?: number | null;
  totalAmount?: number | null;
};
type ExistingPump = Required<Omit<PumpFields, 'endTime'>> & { endTime: Date | null; unitAbbr: string | null };
type PreparedPump = { data: PumpFields; startTime: Date; totalAmount: number | null | undefined };

// The manual API already treats unzoned input as UTC. Validate calendar fields
// before parsing so impossible dates cannot roll over or fall back to "now".
function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/);
  if (!match) return null;
  const [, date, hour = '00', minute = '00', second = '00', fraction = '', offset = 'Z'] = match;
  const wall = `${date}T${hour}:${minute}:${second}${fraction}`;
  const calendar = new Date(wall + 'Z');
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== wall.slice(0, 19)) return null;
  const normalizedOffset = offset !== 'Z' && !offset.includes(':') ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
  const instant = new Date(wall + normalizedOffset);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

const validAmount = (value: unknown): value is number | null => value === null ||
  (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const validDuration = (value: unknown): value is number | null => value === null ||
  (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647);

/** Validate only submitted/derived fields; unrelated edits never rewrite history. */
export function preparePumpFields(input: unknown, existing?: ExistingPump): PreparedPump | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'A pumping record object is required.' };
  const body = input as Record<string, unknown>;
  if ((!existing || body.babyId !== undefined) && (typeof body.babyId !== 'string' || !body.babyId.trim())) {
    return { error: 'Baby ID is required.' };
  }
  for (const field of ['notes', 'unitAbbr']) {
    if (body[field] != null && typeof body[field] !== 'string') return { error: `${field} must be text.` };
  }
  const unit = normalizeVolumeUnit((body.unitAbbr !== undefined ? body.unitAbbr : existing?.unitAbbr) as string | null | undefined);
  // Inventory converts between OZ/ML and rounds with *100. Keep each amount
  // within JS's safe hundredths precision, not an arbitrary physiological cap.
  // Conversion may produce fractional hundredths; it need not be an integer.
  const representableAmount = (value: unknown): value is number | null => validAmount(value) &&
    (value === null || (unit !== null && SUPPORTED_VOLUME_UNITS.every(target => {
      const hundredths = convertVolume(value, unit, target) * 100;
      return Number.isFinite(hundredths) && hundredths <= Number.MAX_SAFE_INTEGER;
    })));

  const data: PumpFields = {};
  for (const field of ['leftAmount', 'rightAmount', 'totalAmount'] as const) {
    const amount = body[field];
    if (amount === undefined) continue;
    if (!representableAmount(amount)) return { error: `${field} must be a finite, non-negative number within the supported volume range, or null.` };
    data[field] = amount;
  }
  if (body.totalAmount === undefined && (body.leftAmount !== undefined || body.rightAmount !== undefined)) {
    const left = data.leftAmount !== undefined ? data.leftAmount : existing?.leftAmount ?? null;
    const right = data.rightAmount !== undefined ? data.rightAmount : existing?.rightAmount ?? null;
    if (!representableAmount(left) || !representableAmount(right)) return { error: 'Correct the existing pumping amounts before calculating a new total.' };
    data.totalAmount = left === null && right === null ? null : (left ?? 0) + (right ?? 0);
    if (!representableAmount(data.totalAmount)) return { error: 'The combined pumping amount must be finite, non-negative and within the supported volume range.' };
  }

  let startTime = existing?.startTime;
  if (!existing || body.startTime !== undefined) {
    const parsed = parseTimestamp(body.startTime);
    if (!parsed) return { error: 'A valid pumping start timestamp is required.' };
    data.startTime = startTime = parsed;
  }
  if (!startTime) return { error: 'A valid pumping start timestamp is required.' };
  // A null optional end remains absent on POST and unchanged on partial PUT.
  if (body.endTime !== undefined && body.endTime !== null) {
    const parsed = parseTimestamp(body.endTime);
    if (!parsed) return { error: 'A valid pumping end timestamp is required.' };
    data.endTime = parsed;
  }
  const timingChanged = !existing || data.startTime !== undefined || data.endTime !== undefined;
  const endTime = data.endTime ?? existing?.endTime;
  if (timingChanged && endTime && endTime < startTime) return { error: 'Pumping end time must not be before start time.' };
  if (body.duration !== undefined) {
    if (!validDuration(body.duration)) return { error: 'Pumping duration must be a non-negative whole number of minutes within the supported integer range.' };
    data.duration = body.duration;
  } else if (timingChanged && endTime) {
    data.duration = Math.round((endTime.getTime() - startTime.getTime()) / 60_000);
    if (!validDuration(data.duration)) return { error: 'The pumping interval exceeds the supported duration range.' };
  }
  const totalAmount = data.totalAmount !== undefined ? data.totalAmount : existing?.totalAmount;
  if (body.unitAbbr !== undefined && ['leftAmount', 'rightAmount', 'totalAmount'].some(field => {
    const key = field as 'leftAmount' | 'rightAmount' | 'totalAmount';
    const amount = data[key] !== undefined ? data[key] : existing?.[key];
    return amount !== undefined && !representableAmount(amount);
  })) return { error: 'The existing pumping amounts cannot be represented in the requested unit.' };
  if ((body.pumpAction === 'STORED' || body.pumpAction === 'FED') && totalAmount !== undefined && !representableAmount(totalAmount)) {
    return { error: 'Correct the pumping total before adding it to stock or a feeding record.' };
  }
  return { data, startTime, totalAmount };
}
