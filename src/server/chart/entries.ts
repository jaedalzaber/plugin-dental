// Dental chart entries: findings, existing work, planned and completed work per tooth.
// Chart data is health data: reads need health.read and leave a "health.read" audit event (once per request),
// writes need health.manage. Notes are encrypted (field "dental.chart.notes") and never appear in audit rows.
import { z } from "@appointit/plugin-sdk";
import {
  AppError,
  decryptField,
  defineCommand,
  encryptField,
  requirePermission,
  sql,
  withTenantTx,
} from "@appointit/plugin-sdk/server";
import type { CommandContext, Tx } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../db-types";
import {
  CONDITIONS,
  DENTAL_PLUGIN_ID,
  ENTRY_KINDS,
  ENTRY_STATUSES,
  canonicalSurfaces,
  isCondition,
  isValidTooth,
  toothNumberingOf,
} from "./model";
import type { ChartEntryDto, ChartHistoryItem, EntryKind, EntryStatus, ToothNumbering } from "./model";

const NOTES_FIELD = "dental.chart.notes";
const notesContext = (tenantId: string) => ({ tenantId, field: NOTES_FIELD });

const canRead = requirePermission("health.read");
const canWrite = requirePermission("health.manage");

const toothSchema = z.string().refine(isValidTooth, "Not a valid FDI tooth number (11-48 or 51-85)");

function surfacesOf(tooth: string, letters: readonly string[]): string[] {
  try {
    return canonicalSurfaces(tooth, letters);
  } catch {
    throw new AppError("INVALID_INPUT", "Invalid input", {
      issues: [{ path: "surfaces", message: "Use the letters M, O, D, B, L, I, F or P", code: "custom" }],
    });
  }
}

// ---- Reading --------------------------------------------------------------------------------------

type EntryRow = {
  id: string;
  customer_id: string;
  tooth: string;
  surfaces: string[];
  kind: string;
  condition: string | null;
  procedure_id: string | null;
  plan_item_id: string | null;
  notes_enc: string | null;
  status: string;
  recorded_by: string | null;
  recorded_at: Date;
  version: number;
  procedure_name: string | null;
  recorded_by_name: string | null;
};

function toDto(tenantId: string, r: EntryRow): ChartEntryDto {
  return {
    id: r.id,
    customerId: r.customer_id,
    tooth: r.tooth,
    surfaces: r.surfaces,
    kind: r.kind as EntryKind,
    condition: isCondition(r.condition) ? r.condition : null,
    procedureId: r.procedure_id,
    procedureName: r.procedure_name,
    planItemId: r.plan_item_id,
    notes: r.notes_enc === null ? null : decryptField(r.notes_enc, notesContext(tenantId)),
    status: r.status as EntryStatus,
    recordedBy: r.recorded_by,
    recordedByName: r.recorded_by_name,
    recordedAt: r.recorded_at.toISOString(),
    version: r.version,
  };
}

function selectEntries(tx: Tx, tenantId: string) {
  return dentalDb(tx)
    .selectFrom("plg_dental_chart_entry as e")
    .leftJoin("plg_dental_procedure as p", (join) => join.onRef("p.tenant_id", "=", "e.tenant_id").onRef("p.id", "=", "e.procedure_id"))
    .leftJoin("user as u", "u.id", "e.recorded_by")
    .select([
      "e.id",
      "e.customer_id",
      "e.tooth",
      "e.surfaces",
      "e.kind",
      "e.condition",
      "e.procedure_id",
      "e.plan_item_id",
      "e.notes_enc",
      "e.status",
      "e.recorded_by",
      "e.recorded_at",
      "e.version",
      "p.name as procedure_name",
      "u.name as recorded_by_name",
    ])
    .where("e.tenant_id", "=", tenantId);
}

async function loadEntry(tx: Tx, tenantId: string, id: string): Promise<ChartEntryDto> {
  const row = await selectEntries(tx, tenantId).where("e.id", "=", id).executeTakeFirst();
  if (!row) throw new AppError("NOT_FOUND", "Chart entry not found");
  return toDto(tenantId, row);
}

async function requireCustomer(tx: Tx, tenantId: string, customerId: string): Promise<void> {
  const found = await tx.selectFrom("customer").select("id").where("tenant_id", "=", tenantId).where("id", "=", customerId).executeTakeFirst();
  if (!found) throw new AppError("NOT_FOUND", "Patient not found");
}

async function requireProcedure(tx: Tx, tenantId: string, procedureId: string): Promise<void> {
  const found = await dentalDb(tx)
    .selectFrom("plg_dental_procedure")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", procedureId)
    .executeTakeFirst();
  if (!found) throw new AppError("NOT_FOUND", "Procedure not found");
}

/** Writes a "health.read" audit event for reading a patient's health data, once per request and patient. */
async function auditHealthRead(tx: Tx, ctx: CommandContext, customerId: string, resource: string): Promise<void> {
  const requestId = ctx.requestId ?? null;
  if (requestId !== null) {
    const seen = await tx
      .selectFrom("audit_event")
      .select("id")
      .where("tenant_id", "=", ctx.tenantId)
      .where("request_id", "=", requestId)
      .where("action", "=", "health.read")
      .where("target_id", "=", customerId)
      .limit(1)
      .executeTakeFirst();
    if (seen) return;
  }
  await tx
    .insertInto("audit_event")
    .values({
      tenant_id: ctx.tenantId,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id ?? null,
      action: "health.read",
      target_type: "customer",
      target_id: customerId,
      changes: JSON.stringify({ resource }),
      request_id: requestId,
      ip: ctx.ip ?? null,
      user_agent: ctx.userAgent ?? null,
    })
    .execute();
}

const customerIdSchema = z.uuid();

function parseCustomerId(customerId: string): string {
  const parsed = customerIdSchema.safeParse(customerId);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Invalid patient id");
  return parsed.data;
}

/** The patient's active and resolved chart entries, newest first (void entries are left out). Needs health.read; audited. */
export async function listChart(ctx: CommandContext, customerId: string): Promise<ChartEntryDto[]> {
  canRead(ctx);
  const id = parseCustomerId(customerId);
  return withTenantTx(ctx.tenantId, async (tx) => {
    await requireCustomer(tx, ctx.tenantId, id);
    await auditHealthRead(tx, ctx, id, "dental.chart");
    const rows = await selectEntries(tx, ctx.tenantId)
      .where("e.customer_id", "=", id)
      .where("e.status", "in", ["active", "resolved"])
      .orderBy("e.recorded_at", "desc")
      .orderBy("e.id", "desc")
      .execute();
    return rows.map((r) => toDto(ctx.tenantId, r));
  });
}

/** How the clinic wants tooth numbers shown (plugin setting "toothNumbering"; FDI unless set to "universal"). */
export async function chartToothNumbering(tenantId: string): Promise<ToothNumbering> {
  return withTenantTx(tenantId, async (tx) => {
    const row = await tx
      .selectFrom("plugin_setting")
      .select("settings")
      .where("tenant_id", "=", tenantId)
      .where("plugin_id", "=", DENTAL_PLUGIN_ID)
      .executeTakeFirst();
    const settings = row?.settings;
    const value = typeof settings === "object" && settings !== null && !Array.isArray(settings) ? settings.toothNumbering : undefined;
    return toothNumberingOf(value);
  });
}

const CHART_ACTIONS = ["dental.chart.addEntry", "dental.chart.updateEntry"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** What happened to the patient's chart (optionally one tooth), newest first, from the entries and their audit trail. Needs health.read; audited. */
export async function chartHistory(ctx: CommandContext, customerId: string, tooth?: string): Promise<ChartHistoryItem[]> {
  canRead(ctx);
  const id = parseCustomerId(customerId);
  if (tooth !== undefined && !isValidTooth(tooth)) throw new AppError("INVALID_INPUT", "Not a valid FDI tooth number");
  return withTenantTx(ctx.tenantId, async (tx) => {
    await requireCustomer(tx, ctx.tenantId, id);
    await auditHealthRead(tx, ctx, id, "dental.chart.history");
    let entries = dentalDb(tx).selectFrom("plg_dental_chart_entry").select(["id", "tooth"]).where("tenant_id", "=", ctx.tenantId).where("customer_id", "=", id);
    if (tooth !== undefined) entries = entries.where("tooth", "=", tooth);
    const found = await entries.execute();
    if (found.length === 0) return [];
    const toothOf = new Map(found.map((e) => [e.id, e.tooth]));
    const events = await tx
      .selectFrom("audit_event as a")
      .leftJoin("user as u", "u.id", "a.actor_id")
      .select(["a.id", "a.action", "a.target_id", "a.changes", "a.occurred_at", "a.actor_id", "u.name as actor_name"])
      .where("a.tenant_id", "=", ctx.tenantId)
      .where("a.target_type", "=", "dental_chart_entry")
      .where("a.action", "in", CHART_ACTIONS)
      .where("a.target_id", "in", [...toothOf.keys()])
      .orderBy("a.occurred_at", "desc")
      .orderBy("a.id", "desc")
      .limit(500)
      .execute();
    return events.map((e): ChartHistoryItem => {
      const changes = isRecord(e.changes) ? e.changes : {};
      const status = isRecord(changes.status) ? changes.status : null;
      const to = status ? textOrNull(status.to) : null;
      const event: ChartHistoryItem["event"] =
        e.action === "dental.chart.addEntry" ? "added" : to === "resolved" ? "resolved" : to === "void" ? "voided" : to === "active" ? "reopened" : "updated";
      const surfaces = Array.isArray(changes.surfaces)
        ? changes.surfaces.filter((s): s is string => typeof s === "string")
        : isRecord(changes.surfaces) && Array.isArray(changes.surfaces.to)
          ? changes.surfaces.to.filter((s): s is string => typeof s === "string")
          : [];
      return {
        id: e.id,
        at: e.occurred_at.toISOString(),
        event,
        entryId: e.target_id,
        tooth: textOrNull(changes.tooth) ?? (e.target_id ? (toothOf.get(e.target_id) ?? null) : null),
        kind: textOrNull(changes.kind),
        condition: textOrNull(changes.condition),
        surfaces,
        actorId: e.actor_id,
        actorName: e.actor_name,
      };
    });
  });
}

// ---- Writing --------------------------------------------------------------------------------------

const notesSchema = z.string().trim().max(4000);

export const addEntry = defineCommand({
  name: "dental.chart.addEntry",
  input: z
    .object({
      customerId: z.uuid(),
      tooth: toothSchema,
      /** Anatomical letters; empty = the whole tooth. */
      surfaces: z.array(z.string().min(1).max(2)).max(8).default([]),
      kind: z.enum(ENTRY_KINDS),
      condition: z.enum(CONDITIONS).nullish(),
      procedureId: z.uuid().nullish(),
      /** Set by treatment plans to tie the entry to a plan item. */
      planItemId: z.uuid().nullish(),
      notes: notesSchema.nullish(),
    })
    .refine((i) => Boolean(i.condition) || Boolean(i.procedureId), { message: "Choose a condition or a procedure", path: ["condition"] }),
  authorize: canWrite,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    await requireCustomer(tx, tenantId, input.customerId);
    if (input.procedureId) await requireProcedure(tx, tenantId, input.procedureId);
    const surfaces = surfacesOf(input.tooth, input.surfaces);
    const notes = input.notes ? input.notes : null;
    const row = await dentalDb(tx)
      .insertInto("plg_dental_chart_entry")
      .values({
        tenant_id: tenantId,
        customer_id: input.customerId,
        tooth: input.tooth,
        surfaces,
        kind: input.kind,
        condition: input.condition ?? null,
        procedure_id: input.procedureId ?? null,
        plan_item_id: input.planItemId ?? null,
        notes_enc: notes === null ? null : encryptField(notes, notesContext(tenantId)),
        recorded_by: scope.ctx.actor.id ?? null,
      })
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.chart.addEntry",
      targetType: "dental_chart_entry",
      targetId: row.id,
      targetVersion: row.version,
      changes: {
        customerId: input.customerId,
        tooth: input.tooth,
        kind: input.kind,
        surfaces,
        condition: input.condition ?? null,
        procedureId: input.procedureId ?? null,
      },
    });
    return loadEntry(tx, tenantId, row.id);
  },
});

const ALLOWED_STATUS_MOVES: Record<string, readonly string[]> = {
  active: ["resolved", "void"],
  resolved: ["active", "void"],
  void: [],
};

export const updateEntry = defineCommand({
  name: "dental.chart.updateEntry",
  input: z.object({
    id: z.uuid(),
    expectedVersion: z.number().int().min(1),
    /** active -> resolved or void; resolved -> active (reopen) or void. A void entry cannot change any more. */
    status: z.enum(ENTRY_STATUSES).optional(),
    surfaces: z.array(z.string().min(1).max(2)).max(8).optional(),
    condition: z.enum(CONDITIONS).nullable().optional(),
    procedureId: z.uuid().nullable().optional(),
    notes: notesSchema.nullable().optional(),
  }),
  authorize: canWrite,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const before = await dentalDb(tx)
      .selectFrom("plg_dental_chart_entry")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", input.id)
      .forUpdate()
      .executeTakeFirst();
    if (!before) throw new AppError("NOT_FOUND", "Chart entry not found");
    if (before.version !== input.expectedVersion) {
      throw new AppError("VERSION_CONFLICT", "This chart entry was changed by someone else", { currentVersion: before.version });
    }
    if (before.status === "void") throw new AppError("CONFLICT", "A voided chart entry cannot be changed");

    const patch: {
      status?: string;
      surfaces?: string[];
      condition?: string | null;
      procedure_id?: string | null;
      notes_enc?: string | null;
    } = {};
    const changes: Record<string, unknown> = { tooth: before.tooth, kind: before.kind };

    if (input.status !== undefined && input.status !== before.status) {
      if (!ALLOWED_STATUS_MOVES[before.status]?.includes(input.status)) {
        throw new AppError("CONFLICT", `A ${before.status} chart entry cannot become ${input.status}`);
      }
      patch.status = input.status;
      changes.status = { from: before.status, to: input.status };
    }
    if (input.surfaces !== undefined) {
      const next = surfacesOf(before.tooth, input.surfaces);
      if (JSON.stringify(next) !== JSON.stringify(before.surfaces)) {
        patch.surfaces = next;
        changes.surfaces = { from: before.surfaces, to: next };
      }
    }
    if (input.condition !== undefined && input.condition !== before.condition) {
      patch.condition = input.condition;
      changes.condition = { from: before.condition, to: input.condition };
    }
    if (input.procedureId !== undefined && input.procedureId !== before.procedure_id) {
      if (input.procedureId !== null) await requireProcedure(tx, tenantId, input.procedureId);
      patch.procedure_id = input.procedureId;
      changes.procedureId = { from: before.procedure_id, to: input.procedureId };
    }
    if (input.notes !== undefined) {
      patch.notes_enc = input.notes ? encryptField(input.notes, notesContext(tenantId)) : null;
      changes.notesChanged = true;
    }
    if (Object.keys(patch).length === 0) throw new AppError("INVALID_INPUT", "Nothing to change");

    const nextCondition = patch.condition !== undefined ? patch.condition : before.condition;
    const nextProcedure = patch.procedure_id !== undefined ? patch.procedure_id : before.procedure_id;
    if (!nextCondition && !nextProcedure) {
      throw new AppError("INVALID_INPUT", "Invalid input", {
        issues: [{ path: "condition", message: "Choose a condition or a procedure", code: "custom" }],
      });
    }

    const after = await dentalDb(tx)
      .updateTable("plg_dental_chart_entry")
      .set({ ...patch, version: sql<number>`version + 1` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", before.id)
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.chart.updateEntry",
      targetType: "dental_chart_entry",
      targetId: after.id,
      targetVersion: after.version,
      changes,
    });
    return loadEntry(tx, tenantId, after.id);
  },
});
