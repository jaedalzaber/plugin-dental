// Treatment plans: a patient's multi-visit plan with an estimate, written by clinicians (health.manage) and
// accepted by the patient with a signature. Notes are health data and stay encrypted at rest.
// Status: draft -> proposed -> accepted -> in_progress -> completed (or cancelled from any open state).

import { createHash } from "node:crypto";
import { z } from "@appointit/plugin-sdk";
import {
  AppError,
  decryptField,
  defineCommand,
  encryptField,
  fileUrl,
  requirePermission,
  sql,
  storeFile,
  uuidv7,
  withTenantTx,
} from "@appointit/plugin-sdk/server";
import type { DomainEventRow, Tx } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../db-types";
import { buildAcceptancePdf } from "./pdf";

const NOTES_FIELD = "plg_dental_treatment_plan.notes";
const OPEN_STATUSES = ["draft", "proposed", "accepted", "in_progress"];

// ---- DTOs ---------------------------------------------------------------------------------------------------

export interface PlanItemDto {
  id: string;
  seq: number;
  procedureId: string | null;
  procedureName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  tooth: string | null;
  surfaces: string[];
  minGapDays: number;
  maxGapDays: number | null;
  priceMinor: number;
  bookingId: string | null;
  /** Start of the booked visit (ISO), when there is one. */
  bookingStart: string | null;
  status: string;
}

export interface PlanDto {
  id: string;
  customerId: string;
  title: string;
  status: string;
  currency: string | null;
  estimateMinor: number;
  insuranceEstimateMinor: number;
  /** What the patient pays: the estimate minus the insurance estimate (never below 0). */
  patientShareMinor: number;
  notes: string | null;
  acceptedAt: string | null;
  acceptanceFileId: string | null;
  acceptanceUrl: string | null;
  seriesId: string | null;
  version: number;
  createdAt: string;
  items: PlanItemDto[];
}

export interface ProcedureOption {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  defaultPriceMinor: number | null;
  currency: string | null;
  serviceId: string | null;
  serviceName: string | null;
}

export interface PlanOptions {
  /** Currency of the first active location (the default for a new plan). */
  currency: string | null;
  procedures: ProcedureOption[];
}

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

function invalid(path: string, message: string): AppError {
  return new AppError("INVALID_INPUT", "Invalid input", { issues: [{ path, message, code: "custom" }] });
}

// ---- Reads --------------------------------------------------------------------------------------------------

async function loadPlans(tx: Tx, tenantId: string, filter: { customerId?: string; id?: string }): Promise<PlanDto[]> {
  let query = dentalDb(tx).selectFrom("plg_dental_treatment_plan").selectAll().where("tenant_id", "=", tenantId);
  if (filter.customerId !== undefined) query = query.where("customer_id", "=", filter.customerId);
  if (filter.id !== undefined) query = query.where("id", "=", filter.id);
  const plans = await query.orderBy("created_at", "desc").orderBy("id", "desc").execute();
  if (plans.length === 0) return [];

  const items = await dentalDb(tx)
    .selectFrom("plg_dental_plan_item as i")
    .leftJoin("plg_dental_procedure as p", (join) => join.onRef("p.tenant_id", "=", "i.tenant_id").onRef("p.id", "=", "i.procedure_id"))
    .leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "i.tenant_id").onRef("s.id", "=", "i.service_id"))
    .leftJoin("booking as b", (join) => join.onRef("b.tenant_id", "=", "i.tenant_id").onRef("b.id", "=", "i.booking_id"))
    .select([
      "i.id",
      "i.plan_id",
      "i.seq",
      "i.procedure_id",
      "p.name as procedure_name",
      "i.service_id",
      "s.name as service_name",
      "i.tooth",
      "i.surfaces",
      "i.min_gap_days",
      "i.max_gap_days",
      "i.price_minor",
      "i.booking_id",
      "i.status",
      "b.starts_at as booking_start",
    ])
    .where("i.tenant_id", "=", tenantId)
    .where("i.plan_id", "in", plans.map((p) => p.id))
    .orderBy("i.seq")
    .execute();

  const byPlan = new Map<string, PlanItemDto[]>();
  for (const i of items) {
    const list = byPlan.get(i.plan_id) ?? [];
    list.push({
      id: i.id,
      seq: i.seq,
      procedureId: i.procedure_id,
      procedureName: i.procedure_name,
      serviceId: i.service_id,
      serviceName: i.service_name,
      tooth: i.tooth,
      surfaces: i.surfaces,
      minGapDays: i.min_gap_days,
      maxGapDays: i.max_gap_days,
      priceMinor: Number(i.price_minor),
      bookingId: i.booking_id,
      bookingStart: i.booking_start === null ? null : iso(i.booking_start),
      status: i.status,
    });
    byPlan.set(i.plan_id, list);
  }

  return plans.map((p): PlanDto => {
    const estimate = Number(p.estimate_minor);
    const insurance = Number(p.insurance_estimate_minor);
    return {
      id: p.id,
      customerId: p.customer_id,
      title: p.title,
      status: p.status,
      currency: p.currency,
      estimateMinor: estimate,
      insuranceEstimateMinor: insurance,
      patientShareMinor: Math.max(0, estimate - insurance),
      notes: p.notes_enc === null ? null : decryptField(p.notes_enc, { tenantId, field: NOTES_FIELD }),
      acceptedAt: p.accepted_at === null ? null : iso(p.accepted_at),
      acceptanceFileId: p.acceptance_file_id,
      acceptanceUrl: p.acceptance_file_id === null ? null : fileUrl(p.acceptance_file_id, "private"),
      seriesId: p.series_id,
      version: p.version,
      createdAt: iso(p.created_at),
      items: byPlan.get(p.id) ?? [],
    };
  });
}

/** A patient's plans, newest first. */
export function listPlans(tenantId: string, customerId: string): Promise<PlanDto[]> {
  return withTenantTx(tenantId, (tx) => loadPlans(tx, tenantId, { customerId }));
}

export async function getPlan(tenantId: string, id: string): Promise<PlanDto> {
  const plan = (await withTenantTx(tenantId, (tx) => loadPlans(tx, tenantId, { id })))[0];
  if (!plan) throw new AppError("NOT_FOUND", "Treatment plan not found");
  return plan;
}

/** What the plan editor offers: the active procedures with their linked service, and the default currency. */
export async function getPlanOptions(tenantId: string): Promise<PlanOptions> {
  return withTenantTx(tenantId, async (tx) => {
    const rows = await dentalDb(tx)
      .selectFrom("plg_dental_procedure as p")
      .leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "p.tenant_id").onRef("s.id", "=", "p.service_id"))
      .select(["p.id", "p.code", "p.name", "p.category", "p.default_price_minor", "p.currency", "p.service_id", "s.name as service_name"])
      .where("p.tenant_id", "=", tenantId)
      .where("p.active", "=", true)
      .orderBy("p.sort")
      .orderBy("p.name")
      .execute();
    return {
      currency: await defaultCurrency(tx, tenantId),
      procedures: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        category: r.category,
        defaultPriceMinor: r.default_price_minor === null ? null : Number(r.default_price_minor),
        currency: r.currency,
        serviceId: r.service_id,
        serviceName: r.service_name,
      })),
    };
  });
}

async function defaultCurrency(tx: Tx, tenantId: string): Promise<string | null> {
  const row = await tx
    .selectFrom("location")
    .select("currency")
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "active")
    .orderBy("created_at")
    .limit(1)
    .executeTakeFirst();
  return row?.currency ?? null;
}

// ---- Writes: helpers ------------------------------------------------------------------------------------------

const planItemInput = z.object({
  /** The existing item to keep (its booking link and chart references stay); omit for a new one. */
  id: z.uuid().optional(),
  procedureId: z.uuid().nullish(),
  /** Needed only for a procedure without a linked service. */
  serviceId: z.uuid().nullish(),
  tooth: z.string().trim().max(10).nullish(),
  surfaces: z.array(z.string().trim().min(1).max(4)).max(6).default([]),
  /** Minor units; left out = the procedure's default price. */
  priceMinor: z.number().int().min(0).max(1_000_000_000_000).optional(),
  minGapDays: z.number().int().min(0).max(730).default(0),
  maxGapDays: z.number().int().min(0).max(1460).nullish(),
});

const itemsInput = z.array(planItemInput).max(30);
const notesInput = z.string().max(5000);
const money = z.number().int().min(0).max(1_000_000_000_000);

interface PreparedItem {
  id: string | undefined;
  procedureId: string | null;
  serviceId: string | null;
  tooth: string | null;
  surfaces: string[];
  priceMinor: number;
  minGapDays: number;
  maxGapDays: number | null;
}

async function prepareItems(tx: Tx, tenantId: string, items: z.infer<typeof itemsInput>): Promise<PreparedItem[]> {
  const procedureIds = [...new Set(items.flatMap((i) => (i.procedureId ? [i.procedureId] : [])))];
  const procedures = procedureIds.length
    ? await dentalDb(tx).selectFrom("plg_dental_procedure").select(["id", "service_id", "default_price_minor"]).where("tenant_id", "=", tenantId).where("id", "in", procedureIds).execute()
    : [];
  const procedureById = new Map(procedures.map((p) => [p.id, p]));
  const prepared = items.map((item, index): PreparedItem => {
    const procedure = item.procedureId ? procedureById.get(item.procedureId) : undefined;
    if (item.procedureId && !procedure) throw invalid(`items.${index}.procedureId`, "This procedure does not exist");
    if (item.maxGapDays != null && item.maxGapDays < item.minGapDays) {
      throw invalid(`items.${index}.maxGapDays`, "The longest gap cannot be shorter than the shortest gap");
    }
    return {
      id: item.id,
      procedureId: item.procedureId ?? null,
      serviceId: item.serviceId ?? procedure?.service_id ?? null,
      tooth: item.tooth && item.tooth !== "" ? item.tooth : null,
      surfaces: item.surfaces,
      priceMinor: item.priceMinor ?? (procedure?.default_price_minor != null ? Number(procedure.default_price_minor) : 0),
      minGapDays: item.minGapDays,
      maxGapDays: item.maxGapDays ?? null,
    };
  });
  const serviceIds = [...new Set(prepared.flatMap((i) => (i.serviceId ? [i.serviceId] : [])))];
  if (serviceIds.length > 0) {
    const found = await tx.selectFrom("service").select("id").where("tenant_id", "=", tenantId).where("id", "in", serviceIds).execute();
    const known = new Set(found.map((s) => s.id));
    prepared.forEach((item, index) => {
      if (item.serviceId && !known.has(item.serviceId)) throw invalid(`items.${index}.serviceId`, "This service does not exist");
    });
  }
  return prepared;
}

/** Makes the plan's items equal `items` (in order): known ids are updated, new ones inserted, missing ones removed. */
async function writeItems(tx: Tx, tenantId: string, planId: string, items: PreparedItem[]): Promise<number> {
  const existing = await dentalDb(tx).selectFrom("plg_dental_plan_item").select("id").where("tenant_id", "=", tenantId).where("plan_id", "=", planId).execute();
  const known = new Set(existing.map((e) => e.id));
  const keep = new Set(items.flatMap((i) => (i.id && known.has(i.id) ? [i.id] : [])));
  const drop = existing.map((e) => e.id).filter((id) => !keep.has(id));
  if (drop.length > 0) await dentalDb(tx).deleteFrom("plg_dental_plan_item").where("tenant_id", "=", tenantId).where("id", "in", drop).execute();
  for (const [index, item] of items.entries()) {
    const fields = {
      seq: index + 1,
      procedure_id: item.procedureId,
      service_id: item.serviceId,
      tooth: item.tooth,
      surfaces: item.surfaces,
      min_gap_days: item.minGapDays,
      max_gap_days: item.maxGapDays,
      price_minor: item.priceMinor,
    };
    if (item.id && known.has(item.id)) {
      await dentalDb(tx).updateTable("plg_dental_plan_item").set(fields).where("tenant_id", "=", tenantId).where("id", "=", item.id).execute();
    } else {
      await dentalDb(tx).insertInto("plg_dental_plan_item").values({ tenant_id: tenantId, id: uuidv7(), plan_id: planId, ...fields }).execute();
    }
  }
  return items.reduce((sum, i) => sum + i.priceMinor, 0);
}

async function lockPlan(tx: Tx, tenantId: string, planId: string, expectedVersion?: number) {
  const plan = await dentalDb(tx)
    .selectFrom("plg_dental_treatment_plan")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("id", "=", planId)
    .forUpdate()
    .executeTakeFirst();
  if (!plan) throw new AppError("NOT_FOUND", "Treatment plan not found");
  if (expectedVersion !== undefined && plan.version !== expectedVersion) {
    throw new AppError("VERSION_CONFLICT", "This plan was changed by someone else", { currentVersion: plan.version });
  }
  return plan;
}

type LockedPlan = Awaited<ReturnType<typeof lockPlan>>;

async function setStatus(tx: Tx, tenantId: string, plan: LockedPlan, status: string, extra: Record<string, unknown> = {}): Promise<number> {
  const row = await dentalDb(tx)
    .updateTable("plg_dental_treatment_plan")
    .set({ status, version: sql<number>`version + 1`, ...extra })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", plan.id)
    .returning("version")
    .executeTakeFirstOrThrow();
  return row.version;
}

const AGGREGATE = "dental_treatment_plan";

// ---- Commands -----------------------------------------------------------------------------------------------------

const createInput = z.object({
  customerId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  currency: z.string().length(3).optional(),
  insuranceEstimateMinor: money.default(0),
  notes: notesInput.nullish(),
  items: itemsInput.default([]),
});

export const createPlan = defineCommand({
  name: "dental.plan.create",
  input: createInput,
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const customer = await tx.selectFrom("customer").select("id").where("tenant_id", "=", tenantId).where("id", "=", input.customerId).executeTakeFirst();
    if (!customer) throw new AppError("NOT_FOUND", "Patient not found");
    const items = await prepareItems(tx, tenantId, input.items);
    const planId = uuidv7();
    await dentalDb(tx)
      .insertInto("plg_dental_treatment_plan")
      .values({
        tenant_id: tenantId,
        id: planId,
        customer_id: input.customerId,
        title: input.title,
        currency: input.currency?.toUpperCase() ?? (await defaultCurrency(tx, tenantId)),
        insurance_estimate_minor: input.insuranceEstimateMinor,
        notes_enc: input.notes ? encryptField(input.notes, { tenantId, field: NOTES_FIELD }) : null,
        created_by: scope.ctx.actor.id ?? null,
      })
      .execute();
    const estimate = await writeItems(tx, tenantId, planId, items);
    await dentalDb(tx).updateTable("plg_dental_treatment_plan").set({ estimate_minor: estimate }).where("tenant_id", "=", tenantId).where("id", "=", planId).execute();
    await scope.audit({
      action: "dental.plan.create",
      targetType: AGGREGATE,
      targetId: planId,
      targetVersion: 1,
      changes: { customerId: input.customerId, title: input.title, items: items.length, estimateMinor: estimate },
    });
    return { id: planId, version: 1, status: "draft" };
  },
});

const updateInput = z.object({
  planId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  insuranceEstimateMinor: money.optional(),
  notes: notesInput.nullish(),
  /** Replaces the item list; only while the plan is a draft or proposed. */
  items: itemsInput.optional(),
});

export const updatePlan = defineCommand({
  name: "dental.plan.update",
  input: updateInput,
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await lockPlan(tx, tenantId, input.planId, input.expectedVersion);
    if (!OPEN_STATUSES.includes(plan.status)) throw new AppError("CONFLICT", `A ${plan.status} plan cannot be changed`);
    const set: Record<string, unknown> = {};
    if (input.title !== undefined) set.title = input.title;
    if (input.insuranceEstimateMinor !== undefined) set.insurance_estimate_minor = input.insuranceEstimateMinor;
    if (input.notes !== undefined) set.notes_enc = input.notes ? encryptField(input.notes, { tenantId, field: NOTES_FIELD }) : null;
    let status = plan.status;
    if (input.items !== undefined) {
      if (plan.status !== "draft" && plan.status !== "proposed") {
        throw new AppError("CONFLICT", "The treatment items can only be changed before the patient accepts the plan");
      }
      set.estimate_minor = await writeItems(tx, tenantId, plan.id, await prepareItems(tx, tenantId, input.items));
      // The patient saw the old estimate: a changed proposal has to be proposed again.
      if (plan.status === "proposed") status = "draft";
    }
    const version = await setStatus(tx, tenantId, plan, status, set);
    await scope.audit({
      action: "dental.plan.update",
      targetType: AGGREGATE,
      targetId: plan.id,
      targetVersion: version,
      changes: { fields: Object.keys(set).filter((k) => k !== "notes_enc"), notesChanged: "notes_enc" in set, ...(status !== plan.status && { status: { from: plan.status, to: status } }) },
    });
    return { id: plan.id, version, status };
  },
});

const transitionInput = z.object({ planId: z.uuid(), expectedVersion: z.number().int().min(1) });

export const proposePlan = defineCommand({
  name: "dental.plan.propose",
  input: transitionInput,
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await lockPlan(tx, tenantId, input.planId, input.expectedVersion);
    if (plan.status !== "draft") throw new AppError("CONFLICT", `A ${plan.status} plan cannot be proposed`);
    const count = await dentalDb(tx).selectFrom("plg_dental_plan_item").select(sql<number>`count(*)::int`.as("n")).where("tenant_id", "=", tenantId).where("plan_id", "=", plan.id).executeTakeFirstOrThrow();
    if (count.n === 0) throw invalid("items", "Add at least one treatment before proposing the plan");
    const version = await setStatus(tx, tenantId, plan, "proposed");
    await scope.emit({ type: "dental.plan.proposed", aggregateType: AGGREGATE, aggregateId: plan.id, aggregateVersion: version, payload: { planId: plan.id, customerId: plan.customer_id } });
    await scope.audit({ action: "dental.plan.propose", targetType: AGGREGATE, targetId: plan.id, targetVersion: version, changes: { status: { from: "draft", to: "proposed" } } });
    return { id: plan.id, version, status: "proposed" };
  },
});

const cancelInput = transitionInput.extend({ reason: z.string().trim().max(500).optional() });

export const cancelPlan = defineCommand({
  name: "dental.plan.cancel",
  input: cancelInput,
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await lockPlan(tx, tenantId, input.planId, input.expectedVersion);
    if (!OPEN_STATUSES.includes(plan.status)) throw new AppError("CONFLICT", `A ${plan.status} plan cannot be cancelled`);
    // Visits that are not booked yet are dropped; booked and finished ones stay as they are.
    await dentalDb(tx).updateTable("plg_dental_plan_item").set({ status: "cancelled" }).where("tenant_id", "=", tenantId).where("plan_id", "=", plan.id).where("status", "=", "planned").execute();
    const version = await setStatus(tx, tenantId, plan, "cancelled");
    await scope.audit({ action: "dental.plan.cancel", targetType: AGGREGATE, targetId: plan.id, targetVersion: version, changes: { status: { from: plan.status, to: "cancelled" } }, ...(input.reason && { reason: input.reason }) });
    return { id: plan.id, version, status: "cancelled" };
  },
});

// ---- Acceptance -----------------------------------------------------------------------------------------------------

const MAX_SIGNATURE_BYTES = 400_000;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

const acceptInput = transitionInput.extend({
  signerName: z.string().trim().min(1).max(200),
  /** A drawn signature as a PNG data URL; leave out when the patient typed their name instead. */
  signatureDataUrl: z.string().max(600_000).optional(),
  /** The pen strokes of the drawing (each point 0..1), added to the PDF as lines. */
  strokes: z.array(z.array(z.tuple([z.number(), z.number()])).max(1500)).max(100).optional(),
});

function moneyText(minor: number, currency: string | null): string {
  const code = currency ?? "";
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency: code || "USD" }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  return `${(minor / 10 ** digits).toFixed(digits)} ${code}`.trim();
}

export const acceptPlan = defineCommand({
  name: "dental.plan.accept",
  input: acceptInput,
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await lockPlan(tx, tenantId, input.planId, input.expectedVersion);
    if (plan.status !== "proposed") throw new AppError("CONFLICT", plan.status === "draft" ? "Propose the plan to the patient first" : `A ${plan.status} plan cannot be accepted`);
    const dto = (await loadPlans(tx, tenantId, { id: plan.id }))[0] as PlanDto;
    const customer = await tx.selectFrom("customer").select("display_name").where("tenant_id", "=", tenantId).where("id", "=", plan.customer_id).executeTakeFirstOrThrow();
    const tenant = await tx.selectFrom("tenant").select("name").where("id", "=", tenantId).executeTakeFirstOrThrow();

    let signatureFileId: string | null = null;
    if (input.signatureDataUrl !== undefined) {
      const match = PNG_DATA_URL.exec(input.signatureDataUrl);
      if (!match) throw invalid("signatureDataUrl", "The signature must be a PNG image");
      const png = Buffer.from(match[1] as string, "base64");
      if (png.length > MAX_SIGNATURE_BYTES) throw invalid("signatureDataUrl", "The signature image is too large");
      const stored = await storeFile(tenantId, {
        data: png,
        filename: "treatment-plan-signature.png",
        purpose: "dental_plan_signature",
        visibility: "private",
        ...(scope.ctx.actor.id !== undefined && { createdBy: scope.ctx.actor.id }),
      });
      signatureFileId = stored.id;
    }

    const acceptedAt = new Date();
    const active = dto.items.filter((i) => i.status !== "cancelled");
    const planHash = createHash("sha256")
      .update(JSON.stringify({ id: dto.id, title: dto.title, estimate: dto.estimateMinor, insurance: dto.insuranceEstimateMinor, items: active.map((i) => [i.procedureId, i.serviceId, i.tooth, i.surfaces, i.priceMinor, i.minGapDays, i.maxGapDays]) }))
      .digest("hex");
    const pdf = buildAcceptancePdf({
      businessName: tenant.name,
      patientName: customer.display_name,
      planTitle: dto.title,
      planId: dto.id,
      rows: active.map((i) => ({
        text: [i.procedureName ?? i.serviceName ?? "Treatment", i.tooth ? `tooth ${i.tooth}${i.surfaces.length ? ` (${i.surfaces.join("")})` : ""}` : null].filter(Boolean).join(" - "),
        amount: moneyText(i.priceMinor, dto.currency),
      })),
      estimate: moneyText(dto.estimateMinor, dto.currency),
      insurance: moneyText(dto.insuranceEstimateMinor, dto.currency),
      patientShare: moneyText(dto.patientShareMinor, dto.currency),
      signerName: input.signerName,
      acceptedAt: acceptedAt.toISOString(),
      typed: signatureFileId === null,
      signatureFileId,
      strokes: input.strokes ?? [],
      hash: planHash,
    });
    const file = await storeFile(tenantId, {
      data: pdf,
      filename: "treatment-plan-acceptance.pdf",
      purpose: "dental_plan_acceptance",
      visibility: "private",
      ...(scope.ctx.actor.id !== undefined && { createdBy: scope.ctx.actor.id }),
    });

    const version = await setStatus(tx, tenantId, plan, "accepted", { accepted_at: acceptedAt, acceptance_file_id: file.id });
    await scope.emit({ type: "dental.plan.accepted", aggregateType: AGGREGATE, aggregateId: plan.id, aggregateVersion: version, payload: { planId: plan.id, customerId: plan.customer_id } });
    await scope.audit({
      action: "dental.plan.accept",
      targetType: AGGREGATE,
      targetId: plan.id,
      targetVersion: version,
      changes: { status: { from: "proposed", to: "accepted" }, signerName: input.signerName, signature: signatureFileId ? "drawn" : "typed", signatureFileId, acceptanceFileId: file.id, planSha256: planHash },
    });
    return { id: plan.id, version, status: "accepted", acceptanceFileId: file.id, acceptanceUrl: file.url };
  },
});

// ---- Booking events -------------------------------------------------------------------------------------------------

/**
 * Keeps plan items in step with their bookings: a completed visit marks its item done (and the plan completed once
 * every item is done); a cancelled or no-show visit puts its item back to planned so it can be booked again.
 */
export async function onPlanBookingEvent(tx: Tx, event: DomainEventRow, ctx: { tenantId: string }): Promise<void> {
  const { tenantId } = ctx;
  const bookingId = event.aggregate_id;
  if (event.type === "booking.completed") {
    const done = await dentalDb(tx)
      .updateTable("plg_dental_plan_item")
      .set({ status: "done" })
      .where("tenant_id", "=", tenantId)
      .where("booking_id", "=", bookingId)
      .where("status", "in", ["booked", "planned"])
      .returning("plan_id")
      .execute();
    for (const planId of new Set(done.map((d) => d.plan_id))) {
      const plan = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").select(["status", "version"]).where("tenant_id", "=", tenantId).where("id", "=", planId).forUpdate().executeTakeFirst();
      if (!plan || (plan.status !== "accepted" && plan.status !== "in_progress")) continue;
      const left = await dentalDb(tx)
        .selectFrom("plg_dental_plan_item")
        .select(sql<number>`count(*)::int`.as("n"))
        .where("tenant_id", "=", tenantId)
        .where("plan_id", "=", planId)
        .where("status", "not in", ["done", "cancelled"])
        .executeTakeFirstOrThrow();
      const next = left.n === 0 ? "completed" : "in_progress";
      if (next !== plan.status) {
        await dentalDb(tx).updateTable("plg_dental_treatment_plan").set({ status: next, version: sql<number>`version + 1` }).where("tenant_id", "=", tenantId).where("id", "=", planId).execute();
      }
    }
    return;
  }

  const freed = await dentalDb(tx)
    .updateTable("plg_dental_plan_item")
    .set({ status: "planned", booking_id: null })
    .where("tenant_id", "=", tenantId)
    .where("booking_id", "=", bookingId)
    .where("status", "=", "booked")
    .returning("plan_id")
    .execute();
  for (const planId of new Set(freed.map((f) => f.plan_id))) {
    // Nothing booked or done any more: the plan waits for its visits to be booked again.
    const active = await dentalDb(tx)
      .selectFrom("plg_dental_plan_item")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("tenant_id", "=", tenantId)
      .where("plan_id", "=", planId)
      .where("status", "in", ["booked", "done"])
      .executeTakeFirstOrThrow();
    if (active.n === 0) {
      await dentalDb(tx)
        .updateTable("plg_dental_treatment_plan")
        .set({ status: "accepted", version: sql<number>`version + 1` })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", planId)
        .where("status", "=", "in_progress")
        .execute();
    }
  }
}
