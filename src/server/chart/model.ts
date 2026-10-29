// Shared, client-safe model of the dental chart: no I/O and no server imports, so the web UI may import it
// ("@appointit/plugin-vertical-dental/chart-model") next to the server code.

export * from "./teeth";

/** The kinds of chart entry: a finding (condition), work already in the mouth (existing), planned or completed work. */
export const ENTRY_KINDS = ["condition", "existing", "planned", "completed"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const ENTRY_STATUSES = ["active", "resolved", "void"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** Built-in condition keys. Each has a translatable label (`dental.condition_<key>`). */
export const CONDITIONS = [
  "caries",
  "filling",
  "crown",
  "bridge",
  "implant",
  "root_canal",
  "missing",
  "extraction_needed",
  "fracture",
  "sealant",
  "veneer",
  "impacted",
  "mobility",
  "periodontal_pocket",
  "watch",
] as const;
export type ConditionKey = (typeof CONDITIONS)[number];

export function isCondition(value: unknown): value is ConditionKey {
  return typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
}

/** The plugin id, which is also the key of the tenant's plugin settings row. */
export const DENTAL_PLUGIN_ID = "appointit.vertical-dental";

export type ChartEntryDto = {
  id: string;
  customerId: string;
  /** Canonical FDI number. */
  tooth: string;
  /** Anatomical letters (M, O/I, D, B/F, L/P); empty = the whole tooth. */
  surfaces: string[];
  kind: EntryKind;
  condition: ConditionKey | null;
  procedureId: string | null;
  procedureName: string | null;
  planItemId: string | null;
  /** Decrypted notes. */
  notes: string | null;
  status: EntryStatus;
  recordedBy: string | null;
  recordedByName: string | null;
  recordedAt: string;
  version: number;
};

export type ChartHistoryEvent = "added" | "updated" | "resolved" | "reopened" | "voided";

export type ChartHistoryItem = {
  id: string;
  at: string;
  event: ChartHistoryEvent;
  entryId: string | null;
  tooth: string | null;
  kind: string | null;
  condition: string | null;
  surfaces: string[];
  actorId: string | null;
  actorName: string | null;
};

export type ProcedureDto = {
  id: string;
  /** Free-text code the clinic uses (no licensed code list is shipped). */
  code: string | null;
  name: string;
  category: string | null;
  /** Minor units of `currency` (cents); null = no default price. */
  defaultPriceMinor: number | null;
  currency: string | null;
  /** Bookable service that treatment plans book for this procedure. */
  serviceId: string | null;
  serviceName: string | null;
  active: boolean;
  sort: number;
  version: number;
};
