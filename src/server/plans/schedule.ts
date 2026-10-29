// Booking a whole treatment plan: "Find times" proposes a date for every visit (each one after the previous visit plus
// its minimum gap), "Book all" creates them as one booking series, all or nothing.

import { z } from "@appointit/plugin-sdk";
import {
  AppError,
  createSeries,
  defineCommand,
  requirePermission,
  searchAvailability,
  sql,
  withTenantTx,
} from "@appointit/plugin-sdk/server";
import type { Tx } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../db-types";
import { addDays, daysBetween, isPlainDate, localDateOf } from "./dates";

const WINDOW_DAYS = 7;
const SEARCH_DAYS = 90;
const MAX_VISITS = 12;
const BOOKABLE = ["accepted", "in_progress"];

export interface ScheduleVisit {
  itemId: string;
  seq: number;
  title: string;
  serviceId: string | null;
  serviceName: string | null;
  start: string | null;
  end: string | null;
  /** Days after the previous visit (null for the first one). */
  gapDays: number | null;
  minGapDays: number;
  maxGapDays: number | null;
  /** The earliest time found is later than the longest allowed gap. */
  gapExceeded: boolean;
  /** Why there is no time: the item has no service, nothing is free soon enough, or an earlier visit has no time. */
  problem: "no_service" | "no_slot" | "after_unscheduled" | null;
}

export interface PlanSchedule {
  timeZone: string;
  visits: ScheduleVisit[];
  /** Every visit has a time and none breaks its gap limits. */
  complete: boolean;
}

interface ItemRow {
  id: string;
  seq: number;
  service_id: string | null;
  procedure_name: string | null;
  service_name: string | null;
  tooth: string | null;
  min_gap_days: number;
  max_gap_days: number | null;
  status: string;
  booking_start: Date | null;
  booking_end: Date | null;
}

async function loadItems(tx: Tx, tenantId: string, planId: string): Promise<ItemRow[]> {
  return dentalDb(tx)
    .selectFrom("plg_dental_plan_item as i")
    .leftJoin("plg_dental_procedure as p", (join) => join.onRef("p.tenant_id", "=", "i.tenant_id").onRef("p.id", "=", "i.procedure_id"))
    .leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "i.tenant_id").onRef("s.id", "=", "i.service_id"))
    .leftJoin("booking as b", (join) => join.onRef("b.tenant_id", "=", "i.tenant_id").onRef("b.id", "=", "i.booking_id"))
    .select([
      "i.id",
      "i.seq",
      "i.service_id",
      "p.name as procedure_name",
      "s.name as service_name",
      "i.tooth",
      "i.min_gap_days",
      "i.max_gap_days",
      "i.status",
      "b.starts_at as booking_start",
      "b.ends_at as booking_end",
    ])
    .where("i.tenant_id", "=", tenantId)
    .where("i.plan_id", "=", planId)
    .where("i.status", "!=", "cancelled")
    .orderBy("i.seq")
    .execute();
}

function invalid(path: string, message: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError("INVALID_INPUT", message, { issues: [{ path, message, code: "custom" }], ...extra });
}

async function zoneOf(tx: Tx, tenantId: string, locationId: string): Promise<string> {
  const row = await tx.selectFrom("location").select("time_zone").where("tenant_id", "=", tenantId).where("id", "=", locationId).executeTakeFirst();
  if (!row) throw new AppError("NOT_FOUND", "Location not found");
  return row.time_zone;
}

// ---- Find times ------------------------------------------------------------------------------------------------------

const preferencesInput = z.record(z.string().min(1).max(120), z.uuid());

const findInput = z.object({
  planId: z.uuid(),
  locationId: z.uuid(),
  /** First day to look at (YYYY-MM-DD, location time); default today. */
  from: z.string().refine(isPlainDate, "Use YYYY-MM-DD").optional(),
  preferences: preferencesInput.optional(),
});

/** The first free slot for a service that starts at or after `minStartMs`, looking at local days from `fromDate`. */
async function firstSlot(
  tenantId: string,
  a: { locationId: string; serviceId: string; fromDate: string; minStartMs: number; preferences?: Record<string, string> | undefined },
): Promise<{ start: string; end: string } | null> {
  let from = a.fromDate;
  let scanned = 0;
  while (scanned < SEARCH_DAYS) {
    const days = Math.min(WINDOW_DAYS, SEARCH_DAYS - scanned);
    const result = await searchAvailability(tenantId, {
      locationId: a.locationId,
      items: [{ serviceId: a.serviceId }],
      from,
      days,
      ...(a.preferences !== undefined && { preferences: a.preferences }),
    });
    const slot = result.slots.filter((s) => Date.parse(s.start) >= a.minStartMs).sort((x, y) => Date.parse(x.start) - Date.parse(y.start))[0];
    if (slot) return { start: slot.start, end: slot.end };
    let next = addDays(from, days);
    if (result.limited && result.cursor !== undefined) {
      const cursorDate = localDateOf(Date.parse(result.cursor), result.timeZone);
      if (cursorDate > from && cursorDate < next) next = cursorDate;
      else if (cursorDate <= from) next = addDays(from, 1);
    }
    scanned += Math.max(1, daysBetween(from, next));
    from = next;
  }
  return null;
}

/**
 * A proposed schedule for the plan's visits that are not booked yet, in order: each visit is the first free time at or after
 * the previous visit's day plus its minimum gap. A visit later than its maximum gap is still proposed but flagged.
 */
export async function findPlanTimes(tenantId: string, rawInput: unknown): Promise<PlanSchedule> {
  const parsed = findInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError("INVALID_INPUT", "Invalid input", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })) });
  }
  const input = parsed.data;
  const { plan, items, timeZone } = await withTenantTx(tenantId, async (tx) => {
    const plan = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").select(["id", "status"]).where("tenant_id", "=", tenantId).where("id", "=", input.planId).executeTakeFirst();
    if (!plan) throw new AppError("NOT_FOUND", "Treatment plan not found");
    return { plan, items: await loadItems(tx, tenantId, input.planId), timeZone: await zoneOf(tx, tenantId, input.locationId) };
  });
  if (plan.status === "cancelled" || plan.status === "completed") throw new AppError("CONFLICT", `A ${plan.status} plan cannot be scheduled`);

  const today = localDateOf(Date.now(), timeZone);
  const startDate = input.from !== undefined && input.from > today ? input.from : today;
  let prev: { startMs: number; endMs: number } | null = null;
  let broken = false;
  const visits: ScheduleVisit[] = [];

  for (const item of items) {
    if (item.status !== "planned") {
      // Already booked or done: it anchors the visits after it.
      if (item.booking_start && item.booking_end) prev = { startMs: item.booking_start.getTime(), endMs: item.booking_end.getTime() };
      continue;
    }
    const base: ScheduleVisit = {
      itemId: item.id,
      seq: item.seq,
      title: [item.procedure_name ?? item.service_name ?? "", item.tooth ? `#${item.tooth}` : ""].filter(Boolean).join(" "),
      serviceId: item.service_id,
      serviceName: item.service_name,
      start: null,
      end: null,
      gapDays: null,
      minGapDays: item.min_gap_days,
      maxGapDays: item.max_gap_days,
      gapExceeded: false,
      problem: null,
    };
    if (!item.service_id) {
      visits.push({ ...base, problem: "no_service" });
      broken = true;
      continue;
    }
    if (broken) {
      visits.push({ ...base, problem: "after_unscheduled" });
      continue;
    }
    const prevDate: string | null = prev ? localDateOf(prev.startMs, timeZone) : null;
    let fromDate = prevDate ? addDays(prevDate, item.min_gap_days) : startDate;
    if (fromDate < startDate) fromDate = startDate;
    // Same day as the previous visit (gap 0): only after it ends.
    const minStartMs = prev && item.min_gap_days === 0 ? prev.endMs : 0;
    const slot = await firstSlot(tenantId, { locationId: input.locationId, serviceId: item.service_id, fromDate, minStartMs, preferences: input.preferences });
    if (!slot) {
      visits.push({ ...base, problem: "no_slot" });
      broken = true;
      continue;
    }
    const slotDate = localDateOf(Date.parse(slot.start), timeZone);
    visits.push({
      ...base,
      start: slot.start,
      end: slot.end,
      gapDays: prevDate ? daysBetween(prevDate, slotDate) : null,
      gapExceeded: prevDate !== null && item.max_gap_days !== null && daysBetween(prevDate, slotDate) > item.max_gap_days,
    });
    prev = { startMs: Date.parse(slot.start), endMs: Date.parse(slot.end) };
  }
  return { timeZone, visits, complete: visits.every((v) => v.problem === null && !v.gapExceeded) };
}

// ---- Book all ----------------------------------------------------------------------------------------------------------

const bookInput = z.object({
  planId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  locationId: z.uuid(),
  /** One entry for every visit still to be booked, with the chosen start (ISO). */
  visits: z.array(z.object({ itemId: z.uuid(), start: z.string().min(10).max(40) })).min(1).max(MAX_VISITS),
  preferences: preferencesInput.optional(),
  /** Book even when a visit is later than its maximum gap. */
  allowLateGaps: z.boolean().optional(),
});

export const bookPlan = defineCommand({
  name: "dental.plan.book",
  input: bookInput,
  authorize: requirePermission("bookings.create"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await dentalDb(tx)
      .selectFrom("plg_dental_treatment_plan")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", input.planId)
      .forUpdate()
      .executeTakeFirst();
    if (!plan) throw new AppError("NOT_FOUND", "Treatment plan not found");
    if (plan.version !== input.expectedVersion) throw new AppError("VERSION_CONFLICT", "This plan was changed by someone else", { currentVersion: plan.version });
    if (!BOOKABLE.includes(plan.status)) throw new AppError("CONFLICT", plan.status === "completed" || plan.status === "cancelled" ? `A ${plan.status} plan cannot be booked` : "The patient has to accept the plan before its visits are booked");

    const timeZone = await zoneOf(tx, tenantId, input.locationId);
    const items = await loadItems(tx, tenantId, plan.id);
    const planned = items.filter((i) => i.status === "planned");
    const chosen = new Map(input.visits.map((v) => [v.itemId, v.start]));
    if (chosen.size !== input.visits.length) throw invalid("visits", "A visit is listed twice");
    if (planned.length === 0) throw new AppError("CONFLICT", "Every visit of this plan is already booked");
    for (const v of input.visits) {
      if (!planned.some((i) => i.id === v.itemId)) throw invalid("visits", "A listed visit is not part of this plan or is already booked");
    }
    for (const item of planned) {
      if (!chosen.has(item.id)) throw invalid("visits", "Choose a time for every visit of the plan");
      if (!item.service_id) throw invalid("visits", `"${item.procedure_name ?? "A treatment"}" has no service to book`);
    }
    if (planned.length > MAX_VISITS) throw invalid("visits", `At most ${MAX_VISITS} visits can be booked at once`);

    // The gap rules, checked on local calendar days against the previous visit (booked earlier or chosen now).
    let prev: { startMs: number; date: string } | null = null;
    for (const item of items) {
      const startText = item.status === "planned" ? chosen.get(item.id) : (item.booking_start?.toISOString() ?? null);
      const startMs = startText === null || startText === undefined ? Number.NaN : Date.parse(startText);
      if (item.status !== "planned") {
        if (!Number.isNaN(startMs)) prev = { startMs, date: localDateOf(startMs, timeZone) };
        continue;
      }
      const index = input.visits.findIndex((v) => v.itemId === item.id);
      if (Number.isNaN(startMs)) throw invalid(`visits.${index}.start`, "This is not a valid time");
      const date = localDateOf(startMs, timeZone);
      if (prev) {
        if (startMs <= prev.startMs) throw invalid(`visits.${index}.start`, "Visits must follow each other in the planned order", { visit: index });
        const gap = daysBetween(prev.date, date);
        if (gap < item.min_gap_days) throw invalid(`visits.${index}.start`, `This visit needs at least ${item.min_gap_days} day(s) after the previous one`, { visit: index });
        if (item.max_gap_days !== null && gap > item.max_gap_days && input.allowLateGaps !== true) {
          throw invalid(`visits.${index}.start`, `This visit is more than ${item.max_gap_days} day(s) after the previous one`, { visit: index, gapExceeded: true });
        }
      }
      prev = { startMs, date };
    }

    // All visits in one transaction: if any cannot be placed, nothing is created.
    const series = await createSeries.runInTx(tx, scope.ctx, {
      locationId: input.locationId,
      kind: "treatment_plan",
      customer: { id: plan.customer_id },
      visits: planned.map((item) => ({
        items: [{ serviceId: item.service_id as string }],
        start: chosen.get(item.id) as string,
        ...(input.preferences !== undefined && { preferences: input.preferences }),
      })),
      source: "admin",
    });

    // A gap of 0 days still means the next visit starts after the previous one has ended.
    for (let i = 1; i < series.bookings.length; i++) {
      const before = series.bookings[i - 1];
      const now = series.bookings[i];
      if (before && now && Date.parse(now.start) < Date.parse(before.end)) {
        throw invalid(`visits.${i}.start`, "This visit starts before the previous one ends", { visit: i });
      }
    }
    for (const [i, item] of planned.entries()) {
      await dentalDb(tx)
        .updateTable("plg_dental_plan_item")
        .set({ status: "booked", booking_id: series.bookings[i]?.bookingId ?? null })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", item.id)
        .execute();
    }
    const updated = await dentalDb(tx)
      .updateTable("plg_dental_treatment_plan")
      .set({ series_id: series.seriesId, status: "in_progress", version: sql<number>`version + 1` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", plan.id)
      .returning("version")
      .executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.plan.book",
      targetType: "dental_treatment_plan",
      targetId: plan.id,
      targetVersion: updated.version,
      changes: { seriesId: series.seriesId, bookingIds: series.bookings.map((b) => b.bookingId), starts: series.bookings.map((b) => b.start) },
    });
    return { planId: plan.id, version: updated.version, seriesId: series.seriesId, bookings: series.bookings };
  },
});
