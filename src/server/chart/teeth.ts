// Tooth numbering and tooth surfaces: pure helpers with no I/O, used by the server and the chart screen.
// Teeth are always stored as FDI two-digit numbers (adult 11-18, 21-28, 31-38, 41-48; child 51-55, 61-65,
// 71-75, 81-85). "Universal" numbering (adult 1-32, child A-T) is only a display choice.

export type ToothNumbering = "fdi" | "universal";
export type Dentition = "adult" | "child";
export type ToothType = "incisor" | "canine" | "premolar" | "molar";

const adultTeeth: string[] = [];
for (const quadrant of [1, 2, 3, 4]) for (let position = 1; position <= 8; position++) adultTeeth.push(`${quadrant}${position}`);
const childTeeth: string[] = [];
for (const quadrant of [5, 6, 7, 8]) for (let position = 1; position <= 5; position++) childTeeth.push(`${quadrant}${position}`);

/** All permanent teeth in FDI order: 11-18, 21-28, 31-38, 41-48. */
export const ADULT_TEETH: readonly string[] = adultTeeth;
/** All primary (baby) teeth in FDI order: 51-55, 61-65, 71-75, 81-85. */
export const CHILD_TEETH: readonly string[] = childTeeth;
export const ALL_TEETH: readonly string[] = [...adultTeeth, ...childTeeth];

const VALID = new Set<string>(ALL_TEETH);

/** True when `value` is a canonical FDI tooth number of an adult or child tooth. */
export function isValidTooth(value: unknown): value is string {
  return typeof value === "string" && VALID.has(value);
}

function assertTooth(fdi: string): void {
  if (!isValidTooth(fdi)) throw new RangeError(`Not an FDI tooth number: ${String(fdi)}`);
}

export function dentitionOf(fdi: string): Dentition {
  assertTooth(fdi);
  return Number(fdi[0]) >= 5 ? "child" : "adult";
}

/** Quadrant digit: 1 upper right, 2 upper left, 3 lower left, 4 lower right (5-8 the same for child teeth). */
export function quadrantOf(fdi: string): number {
  assertTooth(fdi);
  return Number(fdi[0]);
}

/** Position from the midline: 1 = central incisor ... 8 = third molar (5 for child teeth). */
export function positionOf(fdi: string): number {
  assertTooth(fdi);
  return Number(fdi[1]);
}

export function isUpper(fdi: string): boolean {
  const q = quadrantOf(fdi);
  return q === 1 || q === 2 || q === 5 || q === 6;
}

/** True for the patient's right side (quadrants 1, 4, 5, 8). */
export function isPatientRight(fdi: string): boolean {
  const q = quadrantOf(fdi);
  return q === 1 || q === 4 || q === 5 || q === 8;
}

export function toothType(fdi: string): ToothType {
  const position = positionOf(fdi);
  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  if (dentitionOf(fdi) === "child") return "molar";
  return position <= 5 ? "premolar" : "molar";
}

/** Incisors and canines: their chewing edge is "incisal" and their cheek side "facial". */
export function isAnterior(fdi: string): boolean {
  const type = toothType(fdi);
  return type === "incisor" || type === "canine";
}

// ---- Universal numbering ------------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJKLMNOPQRST";

/** FDI -> Universal: "18" -> "1", "48" -> "32", "55" -> "A", "85" -> "T". */
export function fdiToUniversal(fdi: string): string {
  assertTooth(fdi);
  const quadrant = Number(fdi[0]);
  const position = Number(fdi[1]);
  switch (quadrant) {
    case 1:
      return String(9 - position);
    case 2:
      return String(8 + position);
    case 3:
      return String(25 - position);
    case 4:
      return String(24 + position);
    case 5:
      return LETTERS[5 - position]!;
    case 6:
      return LETTERS[4 + position]!;
    case 7:
      return LETTERS[15 - position]!;
    default:
      return LETTERS[14 + position]!;
  }
}

/** Universal -> FDI: "1" -> "18", "32" -> "48", "A" -> "55", "T" -> "85". Letters may be lower case. */
export function universalToFdi(universal: string): string {
  const text = String(universal).trim().toUpperCase();
  if (/^[A-T]$/.test(text)) {
    const index = LETTERS.indexOf(text);
    if (index < 5) return `5${5 - index}`;
    if (index < 10) return `6${index - 4}`;
    if (index < 15) return `7${15 - index}`;
    return `8${index - 14}`;
  }
  if (/^([1-9]|[12][0-9]|3[0-2])$/.test(text)) {
    const n = Number(text);
    if (n <= 8) return `1${9 - n}`;
    if (n <= 16) return `2${n - 8}`;
    if (n <= 24) return `3${25 - n}`;
    return `4${n - 24}`;
  }
  throw new RangeError(`Not a Universal tooth number: ${String(universal)}`);
}

/** The label to show for a stored FDI tooth number under the tenant's numbering setting. */
export function formatTooth(fdi: string, numbering: ToothNumbering): string {
  return numbering === "universal" ? fdiToUniversal(fdi) : fdi;
}

/** Accepts the stored setting value; anything unknown means FDI. */
export function toothNumberingOf(value: unknown): ToothNumbering {
  return value === "universal" ? "universal" : "fdi";
}

// ---- Surfaces -------------------------------------------------------------------------------------

/**
 * Stored surface letters: M mesial, D distal, O occlusal (back teeth) or I incisal (front teeth),
 * B buccal (back teeth) or F facial (front teeth), L lingual (lower teeth) or P palatal (upper teeth).
 */
export const SURFACE_LETTERS = ["M", "O", "D", "B", "L", "I", "F", "P"] as const;
export type SurfaceLetter = (typeof SURFACE_LETTERS)[number];

export type SurfaceSlot = "mesial" | "distal" | "occlusal" | "buccal" | "lingual";

/** The five faces of a tooth in display order. */
export const SURFACE_SLOTS: readonly SurfaceSlot[] = ["mesial", "occlusal", "distal", "buccal", "lingual"];

const SLOT_OF: Record<SurfaceLetter, SurfaceSlot> = {
  M: "mesial",
  D: "distal",
  O: "occlusal",
  I: "occlusal",
  B: "buccal",
  F: "buccal",
  L: "lingual",
  P: "lingual",
};

export function isSurfaceLetter(value: unknown): value is SurfaceLetter {
  return typeof value === "string" && Object.hasOwn(SLOT_OF, value);
}

/** The anatomically correct letter for each face of this tooth. */
export function surfaceLetters(fdi: string): Record<SurfaceSlot, SurfaceLetter> {
  assertTooth(fdi);
  const anterior = isAnterior(fdi);
  return {
    mesial: "M",
    distal: "D",
    occlusal: anterior ? "I" : "O",
    buccal: anterior ? "F" : "B",
    lingual: isUpper(fdi) ? "P" : "L",
  };
}

/** The face a stored letter belongs to. */
export function slotOfSurface(letter: SurfaceLetter): SurfaceSlot {
  return SLOT_OF[letter];
}

/**
 * Validates surface letters for a tooth and rewrites each to that tooth's own letter (O on a canine becomes I,
 * B on a front tooth F, L on an upper tooth P), without duplicates, in display order.
 * Throws RangeError for an unknown letter or a bad tooth.
 */
export function canonicalSurfaces(fdi: string, letters: readonly string[]): SurfaceLetter[] {
  const own = surfaceLetters(fdi);
  const faces = new Set<SurfaceSlot>();
  for (const letter of letters) {
    const upper = String(letter).trim().toUpperCase();
    if (!isSurfaceLetter(upper)) throw new RangeError(`Not a tooth surface: ${String(letter)}`);
    faces.add(SLOT_OF[upper]);
  }
  return SURFACE_SLOTS.filter((slot) => faces.has(slot)).map((slot) => own[slot]);
}
