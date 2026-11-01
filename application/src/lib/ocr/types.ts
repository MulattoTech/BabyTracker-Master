/** Draft values are never care records, even when an OCR engine reports a high score. */
export type OcrEventType = 'feed' | 'diaper' | 'sleep' | 'unknown';
export type OcrFieldOrigin = 'source' | 'context' | 'missing' | 'ambiguous' | 'corrected';
export type OcrEditableField =
  | 'eventType' | 'localDate' | 'localTime' | 'endLocalDate' | 'endLocalTime'
  | 'feedType' | 'bottleType' | 'amount' | 'unit' | 'diaperType' | 'sleepType' | 'notes';

export interface OcrCrop {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly unit?: 'pixel' | 'percent';
}

export interface OcrSource {
  readonly page: number;
  readonly line: number;
  readonly slot: number;
  readonly rawText: string;
  readonly engine: string;
  /** The engine's 0–100 score, not a calibrated probability of field correctness. */
  readonly confidence: number | null;
  readonly contextDate?: string;
  readonly contextDateOrigin?: 'user' | 'page-header';
  readonly rotation?: number;
  readonly crop?: OcrCrop;
}

export interface OcrCandidate {
  readonly id: string;
  readonly eventType: OcrEventType;
  readonly localDate: string | null;
  readonly localTime: string | null;
  readonly endLocalDate: string | null;
  readonly endLocalTime: string | null;
  readonly feedType: 'BREAST' | 'BOTTLE' | null;
  readonly bottleType: 'Formula' | 'Breast Milk' | 'Other' | null;
  readonly amount: number | null;
  readonly unit: 'ML' | 'OZ' | null;
  readonly diaperType: 'WET' | 'DIRTY' | 'BOTH' | 'DRY' | null;
  readonly sleepType: 'NAP' | 'NIGHT_SLEEP' | null;
  readonly notes: string;
  readonly approved: boolean;
  readonly source: OcrSource;
  readonly fieldSources: Partial<Record<OcrEditableField, OcrFieldOrigin>>;
  readonly warnings: readonly string[];
}

export interface OcrPageText {
  readonly page: number;
  readonly text: string;
  readonly confidence?: number | null;
  readonly engine?: string;
  readonly rotation?: number;
  readonly crop?: OcrCrop;
}

export interface OcrParseOptions {
  /** Explicitly supplied by the reviewer. Never filled with today's date. */
  readonly defaultDate?: string;
  /** A bare 01–12 hour is ambiguous unless the reviewer selects a 24-hour sheet. */
  readonly timeFormat?: '24h' | '12h' | 'unknown';
}

export interface OcrValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly candidate?: OcrCandidate;
}

export interface OcrTimeResolution {
  readonly status: 'valid' | 'invalid' | 'ambiguous' | 'nonexistent';
  readonly utc: string | null;
  readonly candidates: readonly string[];
  readonly message?: string;
}

export const OCR_PARSER_VERSION = 'babytracker-conservative-lines-v1';
export const OCR_MAX_CANDIDATES = 500;
export const OCR_MAX_NOTES = 2000;
export const OCR_MAX_SOURCE_LINE = 4096;
