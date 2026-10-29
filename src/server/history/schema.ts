// The medical history document (schemaVersion 1) and the alerts computed from it.
// This is health data: it only ever leaves this folder encrypted (data_enc / alerts_enc) or inside
// an API response for a member who holds health.read. Never put it in events, logs or audit rows.
import { z } from "@appointit/plugin-sdk";

const text = (max: number) => z.string().trim().max(max).default("");
const flag = z.boolean().default(false);
const list = (maxItems: number, maxLen: number) => z.array(z.string().trim().min(1).max(maxLen)).max(maxItems).default([]);

export const conditionsSchema = z.object({
  heartDisease: flag,
  highBloodPressure: flag,
  lowBloodPressure: flag,
  diabetes: flag,
  asthma: flag,
  epilepsy: flag,
  bleedingDisorder: flag,
  hepatitis: flag,
  hiv: flag,
  kidneyDisease: flag,
  liverDisease: flag,
  cancerRadiotherapy: flag,
  other: text(2000),
});

export const allergiesSchema = z.object({
  penicillin: flag,
  latex: flag,
  localAnaesthetic: flag,
  nsaids: flag,
  other: text(2000),
});

export const pregnancySchema = z.object({
  pregnant: flag,
  weeks: z.number().int().min(0).max(45).nullable().default(null),
});

export const historyDocumentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  conditions: conditionsSchema.default(() => conditionsSchema.parse({})),
  medications: list(100, 200),
  allergies: allergiesSchema.default(() => allergiesSchema.parse({})),
  pregnancy: pregnancySchema.default(() => pregnancySchema.parse({})),
  smoker: flag,
  anticoagulants: flag,
  bisphosphonates: flag,
  previousDentalIssues: text(4000),
  notes: text(8000),
  /** Alerts staff add by hand; shown next to the computed ones. */
  manualAlerts: list(20, 200),
});

export type HistoryDocument = z.infer<typeof historyDocumentSchema>;

export const CONDITION_KEYS = [
  "heartDisease",
  "highBloodPressure",
  "lowBloodPressure",
  "diabetes",
  "asthma",
  "epilepsy",
  "bleedingDisorder",
  "hepatitis",
  "hiv",
  "kidneyDisease",
  "liverDisease",
  "cancerRadiotherapy",
] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

export const ALLERGY_KEYS = ["penicillin", "latex", "localAnaesthetic", "nsaids"] as const;
export type AllergyKey = (typeof ALLERGY_KEYS)[number];

/** A blank history (what a patient without a record starts from). */
export function emptyHistory(): HistoryDocument {
  return historyDocumentSchema.parse({});
}

export type HistoryAlert = { code: string; label: string };

const ALLERGY_LABELS: Record<AllergyKey, string> = {
  penicillin: "Allergy: penicillin",
  latex: "Allergy: latex",
  localAnaesthetic: "Allergy: local anaesthetic",
  nsaids: "Allergy: NSAIDs",
};

/**
 * Alerts shown on bookings and the calendar: allergies, anticoagulants, bisphosphonates, bleeding
 * disorder, heart condition, pregnancy, plus the manual ones. Stable order.
 */
export function computeAlerts(doc: HistoryDocument): HistoryAlert[] {
  const out: HistoryAlert[] = [];
  for (const key of ALLERGY_KEYS) if (doc.allergies[key]) out.push({ code: `allergy_${key}`, label: ALLERGY_LABELS[key] });
  if (doc.allergies.other) out.push({ code: "allergy_other", label: `Allergy: ${doc.allergies.other}` });
  if (doc.anticoagulants) out.push({ code: "anticoagulants", label: "Takes anticoagulants" });
  if (doc.bisphosphonates) out.push({ code: "bisphosphonates", label: "Takes bisphosphonates" });
  if (doc.conditions.bleedingDisorder) out.push({ code: "bleeding_disorder", label: "Bleeding disorder" });
  if (doc.conditions.heartDisease) out.push({ code: "heart_condition", label: "Heart condition" });
  if (doc.pregnancy.pregnant) {
    out.push({ code: "pregnancy", label: doc.pregnancy.weeks ? `Pregnant (${doc.pregnancy.weeks} weeks)` : "Pregnant" });
  }
  for (const manual of doc.manualAlerts) out.push({ code: "manual", label: manual });
  return out;
}

/** Top-level sections whose content differs: what an audit row records instead of the values. */
export function changedSections(before: HistoryDocument, after: HistoryDocument): string[] {
  const keys = Object.keys(after) as (keyof HistoryDocument)[];
  return keys.filter((k) => k !== "schemaVersion" && JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}
