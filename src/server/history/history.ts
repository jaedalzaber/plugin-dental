// Medical history of a patient: one encrypted document per customer, with alerts computed from it.
//
// Health data rules (all enforced here):
//  - the document and the alert labels are encrypted with the tenant key (data_enc / alerts_enc), bound to the
//    patient through the encryption context; only has_alerts (a flag) is stored in the clear;
//  - decrypting needs health.read, and EVERY decrypt writes an audit_event (action "health.read", target customer);
//  - edits need health.manage and are audited without values (changes: { fields: [section names] });
//  - nothing here emits events, logs values or puts them in a command result (a stored idempotency result would
//    keep them): results carry versions, flags and section names only.
import {
  AppError,
  decryptField,
  defineCommand,
  encryptField,
  openAnswers,
  requirePermission,
  sql,
  withTenantTx,
} from "@appointit/plugin-sdk/server";
import type { CommandContext, CommandScope, Tx } from "@appointit/plugin-sdk/server";
import { z } from "@appointit/plugin-sdk";
import { dentalDb } from "../db-types";
import { mapIntakeAnswers, mergeImported, type IntakeField } from "./intake-mapping";
import {
  changedSections,
  computeAlerts,
  emptyHistory,
  historyDocumentSchema,
  type HistoryAlert,
  type HistoryDocument,
} from "./schema";

/** Review is due this many months after the last review, unless the plugin setting "historyReviewMonths" says otherwise. */
const DEFAULT_REVIEW_MONTHS = 12;

async function reviewMonths(tx: Tx, tenantId: string): Promise<number> {
  const row = await tx
    .selectFrom("plugin_setting")
    .select("settings")
    .where("tenant_id", "=", tenantId)
    .where("plugin_id", "=", "appointit.vertical-dental")
    .executeTakeFirst();
  const settings = row?.settings;
  const value = typeof settings === "object" && settings !== null && !Array.isArray(settings) ? settings.historyReviewMonths : undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 120 ? value : DEFAULT_REVIEW_MONTHS;
}

const dataContext = (tenantId: string, customerId: string) => ({ tenantId, field: `plg_dental_medical_history.data:${customerId}` });
const alertsContext = (tenantId: string, customerId: string) => ({ tenantId, field: `plg_dental_medical_history.alerts:${customerId}` });

/** The context without its idempotency key: a stored idempotent result would keep the (decrypted) answer. */
function withoutIdempotency(ctx: CommandContext): CommandContext {
  const { idempotencyKey: _dropped, ...rest } = ctx;
  return rest;
}

export interface HistoryDto {
  customerId: string;
  /** False until the first save: the document is then blank and version is 0 (pass it as expectedVersion). */
  exists: boolean;
  version: number;
  document: HistoryDocument;
  alerts: HistoryAlert[];
  hasAlerts: boolean;
  reviewedAt: string | null;
  reviewDueAt: string | null;
  /** True when no review has happened or the review date has passed. */
  reviewDue: boolean;
  sourceSubmissionId: string | null;
  updatedAt: string | null;
}

type HistoryRow = {
  data_enc: string;
  alerts_enc: string | null;
  has_alerts: boolean;
  reviewed_at: Date | null;
  review_due_at: Date | null;
  source_submission_id: string | null;
  version: number;
  updated_at: Date;
};

async function assertCustomer(tx: Tx, tenantId: string, customerId: string): Promise<void> {
  const found = await tx
    .selectFrom("customer")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", customerId)
    .executeTakeFirst();
  if (!found) throw new AppError("NOT_FOUND", "Patient not found");
}

async function loadRow(tx: Tx, tenantId: string, customerId: string, lock = false): Promise<HistoryRow | undefined> {
  const query = dentalDb(tx)
    .selectFrom("plg_dental_medical_history")
    .select(["data_enc", "alerts_enc", "has_alerts", "reviewed_at", "review_due_at", "source_submission_id", "version", "updated_at"])
    .where("tenant_id", "=", tenantId)
    .where("customer_id", "=", customerId);
  return (lock ? query.forUpdate() : query).executeTakeFirst() as Promise<HistoryRow | undefined>;
}

/** Decrypts a stored document. Always goes through here, so the access log never misses a read. */
async function openDocument(scope: CommandScope, customerId: string, row: HistoryRow, why: string): Promise<HistoryDocument> {
  const tenantId = scope.ctx.tenantId;
  await scope.audit({ action: "health.read", targetType: "customer", targetId: customerId, changes: { resource: "dental.medical_history", why } });
  const json = decryptField(row.data_enc, dataContext(tenantId, customerId));
  return historyDocumentSchema.parse(JSON.parse(json));
}

function toDto(customerId: string, row: HistoryRow | undefined, document: HistoryDocument): HistoryDto {
  const alerts = computeAlerts(document);
  const dueAt = row?.review_due_at ?? null;
  return {
    customerId,
    exists: row !== undefined,
    version: row?.version ?? 0,
    document,
    alerts,
    hasAlerts: alerts.length > 0,
    reviewedAt: row?.reviewed_at?.toISOString() ?? null,
    reviewDueAt: dueAt?.toISOString() ?? null,
    reviewDue: row === undefined || dueAt === null || dueAt.getTime() <= Date.now(),
    sourceSubmissionId: row?.source_submission_id ?? null,
    updatedAt: row?.updated_at.toISOString() ?? null,
  };
}

// ---- read ---------------------------------------------------------------------------------------------------------

const getHistoryCommand = defineCommand({
  name: "dental.history.get",
  input: z.object({ customerId: z.uuid() }),
  authorize: requirePermission("health.read"),
  handler: async (tx, input, scope): Promise<HistoryDto> => {
    const tenantId = scope.ctx.tenantId;
    await assertCustomer(tx, tenantId, input.customerId);
    const row = await loadRow(tx, tenantId, input.customerId);
    if (!row) {
      await scope.audit({ action: "health.read", targetType: "customer", targetId: input.customerId, changes: { resource: "dental.medical_history", why: "view" } });
      return toDto(input.customerId, undefined, emptyHistory());
    }
    const document = await openDocument(scope, input.customerId, row, "view");
    return toDto(input.customerId, row, document);
  },
});

/** The decrypted history. Needs health.read and writes a health.read audit row. */
export function getHistory(ctx: CommandContext, customerId: string): Promise<HistoryDto> {
  return getHistoryCommand.run(withoutIdempotency(ctx), { customerId });
}

// ---- write --------------------------------------------------------------------------------------------------------

type Persist = {
  customerId: string;
  row: HistoryRow | undefined;
  document: HistoryDocument;
  markReviewed: boolean;
  sourceSubmissionId?: string;
};

/** Encrypts and stores the document (insert or version+1 update). The caller holds the row lock. */
async function persist(tx: Tx, scope: CommandScope, p: Persist) {
  const tenantId = scope.ctx.tenantId;
  const alerts = computeAlerts(p.document);
  const dataEnc = encryptField(JSON.stringify(p.document), dataContext(tenantId, p.customerId));
  const alertsEnc = alerts.length > 0 ? encryptField(JSON.stringify(alerts), alertsContext(tenantId, p.customerId)) : null;
  const interval = sql<Date>`now() + make_interval(months => ${await reviewMonths(tx, tenantId)}::int)`;
  const now = sql<Date>`now()`;
  const actor = scope.ctx.actor.id ?? null;

  if (!p.row) {
    return dentalDb(tx)
      .insertInto("plg_dental_medical_history")
      .values({
        tenant_id: tenantId,
        customer_id: p.customerId,
        data_enc: dataEnc,
        alerts_enc: alertsEnc,
        has_alerts: alerts.length > 0,
        reviewed_at: p.markReviewed ? now : null,
        // A first record is due for review until someone confirms it with the patient.
        review_due_at: p.markReviewed ? interval : now,
        source_submission_id: p.sourceSubmissionId ?? null,
        updated_by: actor,
      })
      .returning(["version", "has_alerts", "reviewed_at", "review_due_at"])
      .executeTakeFirstOrThrow();
  }
  return dentalDb(tx)
    .updateTable("plg_dental_medical_history")
    .set({
      data_enc: dataEnc,
      alerts_enc: alertsEnc,
      has_alerts: alerts.length > 0,
      ...(p.markReviewed && { reviewed_at: now, review_due_at: interval }),
      ...(p.sourceSubmissionId !== undefined && { source_submission_id: p.sourceSubmissionId }),
      updated_by: actor,
      version: p.row.version + 1,
    })
    .where("tenant_id", "=", tenantId)
    .where("customer_id", "=", p.customerId)
    .returning(["version", "has_alerts", "reviewed_at", "review_due_at"])
    .executeTakeFirstOrThrow();
}

export interface SaveResult {
  customerId: string;
  version: number;
  hasAlerts: boolean;
  reviewedAt: string | null;
  reviewDueAt: string | null;
}

const saveHistoryCommand = defineCommand({
  name: "dental.history.save",
  input: z.object({
    customerId: z.uuid(),
    /** The version you loaded; 0 when the patient has no record yet. */
    expectedVersion: z.number().int().min(0),
    document: historyDocumentSchema,
    /** Also confirm the history with the patient today (the review due date moves on by the review period, 12 months by default). */
    markReviewed: z.boolean().default(false),
  }),
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope): Promise<SaveResult> => {
    const tenantId = scope.ctx.tenantId;
    await assertCustomer(tx, tenantId, input.customerId);
    const row = await loadRow(tx, tenantId, input.customerId, true);
    if ((row?.version ?? 0) !== input.expectedVersion) {
      throw new AppError("VERSION_CONFLICT", "This history was changed by someone else", { currentVersion: row?.version ?? 0 });
    }
    // The previous document is only decrypted to name the sections that changed (and that read is logged).
    const before = row ? await openDocument(scope, input.customerId, row, "diff") : emptyHistory();
    const saved = await persist(tx, scope, {
      customerId: input.customerId,
      row,
      document: input.document,
      markReviewed: input.markReviewed,
    });
    await scope.audit({
      action: "dental.history.save",
      targetType: "customer",
      targetId: input.customerId,
      targetVersion: saved.version,
      changes: { fields: changedSections(before, input.document), reviewed: input.markReviewed },
    });
    return {
      customerId: input.customerId,
      version: saved.version,
      hasAlerts: saved.has_alerts,
      reviewedAt: saved.reviewed_at?.toISOString() ?? null,
      reviewDueAt: saved.review_due_at?.toISOString() ?? null,
    };
  },
});

/** Saves the whole document (health.manage). VERSION_CONFLICT when expectedVersion is stale. */
export function saveHistory(ctx: CommandContext, input: unknown): Promise<SaveResult> {
  return saveHistoryCommand.run(ctx, input);
}

// ---- import from an intake form -------------------------------------------------------------------------------------

export interface ImportResult {
  customerId: string;
  version: number;
  hasAlerts: boolean;
  /** Sections that received answers (names only). */
  importedSections: string[];
  /** Answers that matched nothing and went to notes. */
  unmapped: number;
}

const importCommand = defineCommand({
  name: "dental.history.import",
  input: z.object({ customerId: z.uuid(), submissionId: z.uuid() }),
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope): Promise<ImportResult> => {
    const tenantId = scope.ctx.tenantId;
    await assertCustomer(tx, tenantId, input.customerId);
    const submission = await tx
      .selectFrom("form_submission")
      .innerJoin("form", (j) => j.onRef("form.tenant_id", "=", "form_submission.tenant_id").onRef("form.id", "=", "form_submission.form_id"))
      .select(["form_submission.answers as answers", "form_submission.answers_enc as answersEnc", "form_submission.form_id as formId", "form_submission.form_version as formVersion", "form.purpose as purpose"])
      .where("form_submission.tenant_id", "=", tenantId)
      .where("form_submission.id", "=", input.submissionId)
      .where("form_submission.customer_id", "=", input.customerId)
      .where("form_submission.status", "=", "complete")
      .executeTakeFirst();
    if (!submission || submission.purpose !== "intake") throw new AppError("NOT_FOUND", "Intake submission not found for this patient");

    const version = await tx
      .selectFrom("form_version")
      .select("doc")
      .where("tenant_id", "=", tenantId)
      .where("form_id", "=", submission.formId)
      .where("version", "=", submission.formVersion)
      .executeTakeFirst();
    const doc = (version?.doc ?? {}) as { fields?: unknown };
    const fields: IntakeField[] = Array.isArray(doc.fields)
      ? doc.fields.filter((f): f is IntakeField => typeof f === "object" && f !== null && typeof (f as IntakeField).id === "string")
      : [];
    // Intake answers are stored encrypted; opening them is a health read.
    let answers = (typeof submission.answers === "object" && submission.answers !== null && !Array.isArray(submission.answers)
      ? submission.answers
      : {}) as Record<string, unknown>;
    if (submission.answersEnc !== null) {
      await scope.audit({ action: "health.read", targetType: "form_submission", targetId: input.submissionId, changes: { resource: "form.submission", why: "import" } });
      answers = openAnswers(tenantId, input.submissionId, submission.answersEnc);
    }
    const imported = mapIntakeAnswers(fields, answers);

    const row = await loadRow(tx, tenantId, input.customerId, true);
    const before = row ? await openDocument(scope, input.customerId, row, "import") : emptyHistory();
    const merged = mergeImported(before, imported.document);
    const saved = await persist(tx, scope, {
      customerId: input.customerId,
      row,
      document: merged,
      markReviewed: false,
      sourceSubmissionId: input.submissionId,
    });
    await scope.audit({
      action: "dental.history.import",
      targetType: "customer",
      targetId: input.customerId,
      targetVersion: saved.version,
      changes: { fields: changedSections(before, merged), submissionId: input.submissionId, unmapped: imported.unmapped },
    });
    return {
      customerId: input.customerId,
      version: saved.version,
      hasAlerts: saved.has_alerts,
      importedSections: imported.mappedSections,
      unmapped: imported.unmapped,
    };
  },
});

/** Merges an intake form submission of the patient into their history (health.manage). Adds, never clears. */
export function importFromSubmission(ctx: CommandContext, input: { customerId: string; submissionId: string }): Promise<ImportResult> {
  return importCommand.run(ctx, input);
}

export interface IntakeSubmissionDto {
  id: string;
  formId: string;
  formName: string;
  createdAt: string;
}

/** The patient's completed intake form submissions (newest first), without their answers. Needs health.read. */
export async function listIntakeSubmissions(ctx: CommandContext, customerId: string): Promise<IntakeSubmissionDto[]> {
  requirePermission("health.read")(ctx);
  const z_ = z.uuid().safeParse(customerId);
  if (!z_.success) throw new AppError("INVALID_INPUT", "Invalid patient id");
  const rows = await withTenantTx(ctx.tenantId, (tx) =>
    tx
      .selectFrom("form_submission")
      .innerJoin("form", (j) => j.onRef("form.tenant_id", "=", "form_submission.tenant_id").onRef("form.id", "=", "form_submission.form_id"))
      .select(["form_submission.id as id", "form.id as formId", "form.name as formName", "form_submission.created_at as createdAt"])
      .where("form_submission.tenant_id", "=", ctx.tenantId)
      .where("form_submission.customer_id", "=", customerId)
      .where("form_submission.status", "=", "complete")
      .where("form.purpose", "=", "intake")
      .orderBy("form_submission.created_at", "desc")
      .orderBy("form_submission.id", "desc")
      .limit(50)
      .execute(),
  );
  return rows.map((r) => ({ id: r.id, formId: r.formId, formName: r.formName, createdAt: r.createdAt.toISOString() }));
}

// ---- alerts for lists (calendar, bookings) --------------------------------------------------------------------------

export interface AlertSummary {
  customerId: string;
  hasAlerts: boolean;
  /** Only present when the caller holds health.read (and the patient has alerts). */
  labels?: string[];
  /** The patient has no medical history record yet. */
  historyMissing: boolean;
  /** When the history review is due (ISO). Null when there is no record. Dates only: nothing about the content. */
  reviewDueAt: string | null;
}

const listAlertsCommand = defineCommand({
  name: "dental.alerts.list",
  input: z.object({ customerIds: z.array(z.uuid()).max(200) }),
  authorize: requirePermission("bookings.read"),
  handler: async (tx, input, scope): Promise<AlertSummary[]> => {
    const tenantId = scope.ctx.tenantId;
    const ids = [...new Set(input.customerIds)];
    if (ids.length === 0) return [];
    // Without health.read this reads a boolean and the review date and decrypts nothing.
    const canRead = scope.ctx.permissions?.has("health.read") === true;
    const rows = await dentalDb(tx)
      .selectFrom("plg_dental_medical_history")
      .select(["customer_id", "has_alerts", "alerts_enc", "review_due_at"])
      .where("tenant_id", "=", tenantId)
      .where("customer_id", "in", ids)
      .execute();
    const byId = new Map(rows.map((r) => [r.customer_id, r]));
    const out: AlertSummary[] = [];
    for (const customerId of ids) {
      const row = byId.get(customerId);
      if (!row) {
        out.push({ customerId, hasAlerts: false, historyMissing: true, reviewDueAt: null });
        continue;
      }
      const review = { historyMissing: false, reviewDueAt: row.review_due_at?.toISOString() ?? null };
      if (!row.has_alerts) {
        out.push({ customerId, hasAlerts: false, ...review });
        continue;
      }
      if (!canRead || !row.alerts_enc) {
        out.push({ customerId, hasAlerts: true, ...review });
        continue;
      }
      await scope.audit({ action: "health.read", targetType: "customer", targetId: customerId, changes: { resource: "dental.alerts" } });
      const alerts = JSON.parse(decryptField(row.alerts_enc, alertsContext(tenantId, customerId))) as HistoryAlert[];
      out.push({ customerId, hasAlerts: true, labels: alerts.map((a) => a.label), ...review });
    }
    return out;
  },
});

/**
 * Alert flags for a list of patients. Needs bookings.read. Labels are decrypted (and each decrypt logged)
 * only for callers with health.read; everyone else gets the has_alerts flag only.
 */
export function listAlerts(ctx: CommandContext, customerIds: string[]): Promise<AlertSummary[]> {
  return listAlertsCommand.run(withoutIdempotency(ctx), { customerIds });
}
