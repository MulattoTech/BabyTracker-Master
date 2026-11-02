import { OcrError } from './errors';

export interface OcrRedactionOptions {
  redactNotes: boolean;
  purgeSource: boolean;
}

/** A malformed request must never turn into a destructive default operation. */
export function readOcrRedactionOptions(value: unknown): OcrRedactionOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OcrError('Supply a JSON object with the requested redaction options.');
  }
  const options = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(options)) {
    if (!['redactNotes', 'purgeSource'].includes(key) || typeof entry !== 'boolean') {
      throw new OcrError('Redaction options must be boolean redactNotes or purgeSource values.');
    }
  }
  return { redactNotes: options.redactNotes !== false, purgeSource: options.purgeSource !== false };
}

/** Keep event structure and provenance, removing OCR free text from every copy. */
export function redactOcrText<T>(value: T): T {
  const visit = (entry: unknown, key = ''): unknown => {
    if (typeof entry === 'string' && ['notes', 'rawText', 'text', 'originalName', 'sourceCaregiverName', 'formulaName', 'bottleLabel'].includes(key)) {
      return entry ? '[REDACTED]' : '';
    }
    if (Array.isArray(entry)) return entry.map(item => visit(item));
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry).map(([field, item]) => [field, visit(item, field)]));
    }
    return entry;
  };
  return visit(value) as T;
}
