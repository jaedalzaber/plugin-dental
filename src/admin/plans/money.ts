// Money fields: text in major units (12.50) <-> minor units (1250), with the currency's own number of digits.

export function minorDigits(currency: string | null | undefined): number {
  if (!currency) return 2;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** 1250 -> "12.50". */
export function minorToText(minor: number, currency: string | null | undefined): string {
  const digits = minorDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

/** "12.5" -> 1250; null when the text is not a non-negative amount. Empty text is 0. */
export function textToMinor(text: string, currency: string | null | undefined): number | null {
  const cleaned = text.trim().replace(/,/g, ".");
  if (cleaned === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const digits = minorDigits(currency);
  const value = Math.round(Number(cleaned) * 10 ** digits);
  return Number.isSafeInteger(value) && value <= 1_000_000_000_000 ? value : null;
}

/** Whole days from one YYYY-MM-DD date to another. */
export function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function dayIn(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
