import type { StatusTone } from "@appointit/ui";
import type { Translate } from "@appointit/i18n";
import { isSurfaceLetter, slotOfSurface, SURFACE_SLOTS } from "../../server/chart/model";
import type { ChartEntryDto, EntryKind, SurfaceSlot } from "../../server/chart/model";

// Colour by kind: existing = blue, condition = red, planned = amber, completed = green (the app's info, destructive, warning, success tokens).
export const KIND_TONE: Record<EntryKind, StatusTone> = {
  condition: "danger",
  existing: "info",
  planned: "warning",
  completed: "success",
};

export const KIND_FILL: Record<EntryKind, string> = {
  condition: "fill-destructive",
  existing: "fill-info",
  planned: "fill-warning",
  completed: "fill-success",
};

export const KIND_STROKE: Record<EntryKind, string> = {
  condition: "stroke-destructive",
  existing: "stroke-info",
  planned: "stroke-warning",
  completed: "stroke-success",
};

/** Legend order. */
export const KINDS_IN_ORDER: readonly EntryKind[] = ["existing", "condition", "planned", "completed"];

/** When several entries touch the same surface, the first of these wins the colour. */
const PRIORITY: readonly EntryKind[] = ["condition", "planned", "existing", "completed"];

export type SurfaceMark = { kind: EntryKind; whole: boolean };

function best(kinds: Set<EntryKind>): EntryKind | null {
  return PRIORITY.find((kind) => kinds.has(kind)) ?? null;
}

/** The colour of each face of a tooth from its active entries: entries for named surfaces win over whole-tooth entries. */
export function surfaceMarks(entries: readonly ChartEntryDto[]): Map<SurfaceSlot, SurfaceMark> {
  const specific = new Map<SurfaceSlot, Set<EntryKind>>();
  const whole = new Set<EntryKind>();
  for (const entry of entries) {
    if (entry.status !== "active") continue;
    const slots = entry.surfaces.filter(isSurfaceLetter).map(slotOfSurface);
    if (slots.length === 0) whole.add(entry.kind);
    for (const slot of slots) {
      const set = specific.get(slot) ?? new Set<EntryKind>();
      set.add(entry.kind);
      specific.set(slot, set);
    }
  }
  const wholeKind = best(whole);
  const marks = new Map<SurfaceSlot, SurfaceMark>();
  for (const slot of SURFACE_SLOTS) {
    const own = best(specific.get(slot) ?? new Set());
    if (own) marks.set(slot, { kind: own, whole: false });
    else if (wholeKind) marks.set(slot, { kind: wholeKind, whole: true });
  }
  return marks;
}

/** What an entry says: its condition, else its procedure, else its kind. */
export function entryWhat(entry: Pick<ChartEntryDto, "condition" | "procedureName" | "kind">, t: Translate): string {
  if (entry.condition) return t(`dental.condition_${entry.condition}`);
  if (entry.procedureName) return entry.procedureName;
  return t(`dental.kind_${entry.kind}`);
}

export function surfaceText(entry: Pick<ChartEntryDto, "surfaces">): string {
  return entry.surfaces.join(", ");
}

/** "caries on M, O" or "implant, whole tooth". */
export function entrySummary(entry: ChartEntryDto, t: Translate): string {
  const what = entryWhat(entry, t);
  return entry.surfaces.length === 0 ? t("dental.chartEntryWhole", { what }) : t("dental.chartEntryOn", { what, surfaces: surfaceText(entry) });
}

/** The accessible name of a tooth button, for example "Tooth 16, caries on O". */
export function toothLabel(tooth: string, shown: string, entries: readonly ChartEntryDto[], t: Translate): string {
  const active = entries.filter((e) => e.status === "active");
  if (active.length === 0) return t("dental.chartToothEmpty", { tooth: shown });
  return t("dental.chartToothAria", { tooth: shown, summary: active.map((e) => entrySummary(e, t)).join("; ") });
}

export function isMissing(entries: readonly ChartEntryDto[]): boolean {
  return entries.some((e) => e.status === "active" && e.condition === "missing");
}
