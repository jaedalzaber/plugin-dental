// Recall: patients who are due for a regular visit (for example a check-up and cleaning every 6 months).
// A completed visit of a rule's service starts the next cycle; a daily task reminds patients whose date is near.
// Status: upcoming -> due -> reminded -> scheduled (booked) -> done; snoozed while staff wait.

import { z } from "@appointit/plugin-sdk";
import {
  AppError,
  defineCommand,
  queueMessage,
  readConfig,
  requirePermission,
  sql,
  uuidv7,
  withPlatformTx,
  withTenantTx,
} from "@appointit/plugin-sdk/server";
import type { DomainEventRow, Tx } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../db-types";
import { isDentalEnabled } from "../enabled";
import { addDays, isPlainDate, localDateOf } from "./dates";

export const RECALL_DAILY_TASK = "dental_recall_daily";
const TEMPLATE = "recall.due";
const BATCH = 100;
const MAX_BATCHES = 50;

// ---- Rules -------------------------------------------------------------------------------------------------------

export interface RecallRuleDto {
  id: string;
  name: string;
  serviceId: string;
  serviceName: string | null;
  intervalMonths: number;
  leadDays: number;
  active: boolean;
  version: number;
}

export async function listRecallRules(tenantId: string): Promise<RecallRuleDto[]> {
  return withTenantTx(tenantId, async (tx) => {
    const rows = await dentalDb(tx)
      .selectFrom("plg_dental_recall_rule as r")
      .leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "r.tenant_id").onRef("s.id", "=", "r.service_id"))
      .select(["r.id", "r.name", "r.service_id", "s.name as service_name", "r.interval_months", "r.lead_days", "r.active", "r.version"])
      .where("r.tenant_id", "=", tenantId)
      .orderBy("r.name")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      serviceId: r.service_id,
      serviceName: r.service_name,
      intervalMonths: r.interval_months,
      leadDays: r.lead_days,
      active: r.active,
      version: r.version,
    }));
  });
}

const ruleInput = z.object({
  /** Omit to create a rule. */
  id: z.uuid().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  serviceId: z.uuid(),
  intervalMonths: z.number().int().min(1).max(60),
  leadDays: z.number().int().min(0).max(365).default(14),
  active: z.boolean().default(true),
});

export const saveRecallRule = defineCommand({
  name: "dental.recall.saveRule",
  input: ruleInput,
  authorize: requirePermission("services.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const service = await tx.selectFrom("service").select("id").where("tenant_id", "=", tenantId).where("id", "=", input.serviceId).executeTakeFirst();
    if (!service) throw new AppError("INVALID_INPUT", "Invalid input", { issues: [{ path: "serviceId", message: "This service does not exist", code: "custom" }] });
    const fields = { name: input.name, service_id: input.serviceId, interval_months: input.intervalMonths, lead_days: input.leadDays, active: input.active };
    if (input.id === undefined) {
      const id = uuidv7();
      await dentalDb(tx).insertInto("plg_dental_recall_rule").values({ tenant_id: tenantId, id, ...fields }).execute();
      await scope.audit({ action: "dental.recall_rule.create", targetType: "dental_recall_rule", targetId: id, targetVersion: 1, changes: fields });
      return { id, version: 1 };
    }
    const row = await dentalDb(tx)
      .updateTable("plg_dental_recall_rule")
      .set({ ...fields, version: sql<number>`version + 1` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", input.id)
      .$if(input.expectedVersion !== undefined, (qb) => qb.where("version", "=", input.expectedVersion as number))
      .returning("version")
      .executeTakeFirst();
    if (!row) {
      const current = await dentalDb(tx).selectFrom("plg_dental_recall_rule").select("version").where("tenant_id", "=", tenantId).where("id", "=", input.id).executeTakeFirst();
      if (!current) throw new AppError("NOT_FOUND", "Recall rule not found");
      throw new AppError("VERSION_CONFLICT", "This rule was changed by someone else", { currentVersion: current.version });
    }
    await scope.audit({ action: "dental.recall_rule.update", targetType: "dental_recall_rule", targetId: input.id, targetVersion: row.version, changes: fields });
    return { id: input.id, version: row.version };
  },
});

// ---- The due list ------------------------------------------------------------------------------------------------------

export const RECALL_STATUSES = ["upcoming", "due", "reminded", "scheduled", "snoozed", "done"] as const;

export interface RecallDto {
  customerId: string;
  customerName: string;
  ruleId: string;
  ruleName: string;
  serviceId: string;
  serviceName: string | null;
  /** YYYY-MM-DD */
  dueOn: string;
  lastVisitAt: string | null;
  status: string;
  bookingId: string | null;
  lastRemindedAt: string | null;
}

export interface ListRecallsInput {
  status?: string[];
  /** YYYY-MM-DD, inclusive. */
  dueFrom?: string;
  dueTo?: string;
  customerId?: string;
  limit?: number;
  offset?: number;
}

const listInput = z.object({
  status: z.array(z.enum(RECALL_STATUSES)).optional(),
  dueFrom: z.string().refine(isPlainDate, "Use YYYY-MM-DD").optional(),
  dueTo: z.string().refine(isPlainDate, "Use YYYY-MM-DD").optional(),
  customerId: z.uuid().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export async function listRecalls(tenantId: string, rawInput: ListRecallsInput = {}): Promise<{ rows: RecallDto[]; hasMore: boolean }> {
  const parsed = listInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError("INVALID_INPUT", "Invalid input", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })) });
  }
  const input = parsed.data;
  return withTenantTx(tenantId, async (tx) => {
    let query = dentalDb(tx)
      .selectFrom("plg_dental_recall as r")
      .innerJoin("plg_dental_recall_rule as u", (join) => join.onRef("u.tenant_id", "=", "r.tenant_id").onRef("u.id", "=", "r.rule_id"))
      .innerJoin("customer as c", (join) => join.onRef("c.tenant_id", "=", "r.tenant_id").onRef("c.id", "=", "r.customer_id"))
      .leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "u.tenant_id").onRef("s.id", "=", "u.service_id"))
      .select([
        "r.customer_id",
        "c.display_name",
        "r.rule_id",
        "u.name as rule_name",
        "u.service_id",
        "s.name as service_name",
        sql<string>`to_char(r.due_on, 'YYYY-MM-DD')`.as("due_on"),
        "r.last_visit_at",
        "r.status",
        "r.booking_id",
        "r.last_reminded_at",
      ])
      .where("r.tenant_id", "=", tenantId);
    if (input.status && input.status.length > 0) query = query.where("r.status", "in", input.status);
    if (input.dueFrom) query = query.where(sql<boolean>`r.due_on >= ${input.dueFrom}::date`);
    if (input.dueTo) query = query.where(sql<boolean>`r.due_on <= ${input.dueTo}::date`);
    if (input.customerId) query = query.where("r.customer_id", "=", input.customerId);
    const rows = await query.orderBy("r.due_on").orderBy("c.display_name").orderBy("r.customer_id").limit(input.limit + 1).offset(input.offset).execute();
    return {
      hasMore: rows.length > input.limit,
      rows: rows.slice(0, input.limit).map((r) => ({
        customerId: r.customer_id,
        customerName: r.display_name,
        ruleId: r.rule_id,
        ruleName: r.rule_name,
        serviceId: r.service_id,
        serviceName: r.service_name,
        dueOn: r.due_on,
        lastVisitAt: r.last_visit_at === null ? null : r.last_visit_at.toISOString(),
        status: r.status,
        bookingId: r.booking_id,
        lastRemindedAt: r.last_reminded_at === null ? null : r.last_reminded_at.toISOString(),
      })),
    };
  });
}

// ---- Reminders -----------------------------------------------------------------------------------------------------------

const appUrlConfig = z.object({ APP_URL: z.url().default("http://localhost:3000") });

/** The link in a reminder: the website's booking form with the service chosen; /book when the site has no booking form. */
async function bookLink(tx: Tx, tenantId: string, serviceId: string): Promise<string> {
  const base = readConfig(appUrlConfig).APP_URL.replace(/\/+$/, "");
  const site = await tx.selectFrom("site").select("settings").where("tenant_id", "=", tenantId).executeTakeFirst();
  const chosen = (site?.settings as { bookingFormSlug?: unknown } | undefined)?.bookingFormSlug;
  const forms = await tx
    .selectFrom("form")
    .select("slug")
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "published")
    .where("purpose", "=", "booking")
    .orderBy("created_at")
    .execute();
  const slug = forms.find((f) => f.slug === chosen)?.slug ?? forms[0]?.slug;
  return slug ? `${base}/f/${encodeURIComponent(slug)}?service=${encodeURIComponent(serviceId)}` : `${base}/book?service=${encodeURIComponent(serviceId)}`;
}

interface Reminder {
  customerId: string;
  ruleId: string;
  serviceId: string;
  dueOn: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/** Queues the recall message by email and, when the patient has a phone number, by SMS. Returns how many were queued. */
async function queueReminders(tx: Tx, tenantId: string, r: Reminder, keySuffix: string): Promise<number> {
  const bookUrl = await bookLink(tx, tenantId, r.serviceId);
  const vars = { customer: { name: r.name, firstName: r.name.split(/\s+/)[0] ?? r.name }, bookUrl };
  const base = `dental.recall:${r.customerId}:${r.ruleId}:${r.dueOn}`;
  let queued = 0;
  for (const [channel, to] of [["email", r.email], ["sms", r.phone]] as const) {
    if (!to || to.trim() === "") continue;
    const result = await queueMessage(tx, { template: TEMPLATE, channel, to: to.trim(), vars, customerId: r.customerId, idempotencyKey: `${base}:${channel}${keySuffix}` });
    if (result.status === "queued") queued += 1;
  }
  return queued;
}

async function tenantToday(tx: Tx, tenantId: string): Promise<string> {
  const loc = await tx.selectFrom("location").select("time_zone").where("tenant_id", "=", tenantId).orderBy("created_at").limit(1).executeTakeFirst();
  return localDateOf(Date.now(), loc?.time_zone ?? "UTC");
}

interface DueRow {
  customer_id: string;
  rule_id: string;
  service_id: string;
  due_on: string;
  display_name: string;
  email: string | null;
  phone: string | null;
}

interface Cursor {
  dueOn: string;
  customerId: string;
  ruleId: string;
}

/** Marks the tenant's recalls whose date is near as due, queues their reminder and marks them reminded. */
export async function processTenantRecalls(tenantId: string): Promise<{ due: number; reminded: number; messages: number }> {
  const totals = { due: 0, reminded: 0, messages: 0 };
  let after: Cursor | null = null;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const cursor: Cursor | null = after;
    const rows: DueRow[] = await withTenantTx(tenantId, async (tx) => {
      const today = await tenantToday(tx, tenantId);
      const found = await sql<DueRow>`
        select r.customer_id, r.rule_id, u.service_id, to_char(r.due_on, 'YYYY-MM-DD') as due_on, c.display_name, c.email, c.phone
        from plg_dental_recall r
        join plg_dental_recall_rule u on u.tenant_id = r.tenant_id and u.id = r.rule_id and u.active
        join customer c on c.tenant_id = r.tenant_id and c.id = r.customer_id
        where r.tenant_id = ${tenantId} and r.status in ('upcoming', 'snoozed')
          and r.due_on - u.lead_days <= ${today}::date
          ${cursor ? sql`and (r.due_on, r.customer_id, r.rule_id) > (${cursor.dueOn}::date, ${cursor.customerId}::uuid, ${cursor.ruleId}::uuid)` : sql``}
        order by r.due_on, r.customer_id, r.rule_id
        limit ${BATCH}
        for update of r skip locked`.execute(tx);
      for (const row of found.rows) {
        const queued = await queueReminders(
          tx,
          tenantId,
          { customerId: row.customer_id, ruleId: row.rule_id, serviceId: row.service_id, dueOn: row.due_on, name: row.display_name, email: row.email, phone: row.phone },
          "",
        );
        // Nobody to write to (no address, or opted out): the patient stays "due" for staff to call.
        await dentalDb(tx)
          .updateTable("plg_dental_recall")
          .set(queued > 0 ? { status: "reminded", last_reminded_at: new Date() } : { status: "due" })
          .where("tenant_id", "=", tenantId)
          .where("customer_id", "=", row.customer_id)
          .where("rule_id", "=", row.rule_id)
          .execute();
        totals.due += 1;
        if (queued > 0) totals.reminded += 1;
        totals.messages += queued;
      }
      return found.rows;
    });
    const last = rows[rows.length - 1];
    if (!last || rows.length < BATCH) break;
    after = { dueOn: last.due_on, customerId: last.customer_id, ruleId: last.rule_id };
  }
  return totals;
}

/** The daily task: every tenant that switched the plugin on and has recalls close to their date gets its reminders. */
export async function runRecallDaily(): Promise<{ tenants: number; reminded: number }> {
  const tenants = await withPlatformTx(async (tx) => {
    const found = await sql<{ tenant_id: string }>`
      select distinct r.tenant_id
      from plg_dental_recall r
      join plg_dental_recall_rule u on u.tenant_id = r.tenant_id and u.id = r.rule_id and u.active
      where r.status in ('upcoming', 'snoozed') and r.due_on - u.lead_days <= current_date + 1`.execute(tx);
    return found.rows.map((row) => row.tenant_id);
  });
  let reminded = 0;
  let checked = 0;
  for (const tenantId of tenants) {
    try {
      if (!(await isDentalEnabled(tenantId))) continue;
      checked += 1;
      reminded += (await processTenantRecalls(tenantId)).reminded;
    } catch (err) {
      console.error(`[dental] recall run failed for tenant ${tenantId}`, err);
    }
  }
  return { tenants: checked, reminded };
}

/** How many patients are due for a visit and how many of those were reminded (the recall tile of the reports dashboard). */
export async function recallCounts(tenantId: string): Promise<{ due: number; reminded: number }> {
  return withTenantTx(tenantId, async (tx) => {
    const row = await dentalDb(tx)
      .selectFrom("plg_dental_recall")
      .select([
        sql<number>`(count(*) filter (where status = 'due'))::int`.as("due"),
        sql<number>`(count(*) filter (where status = 'reminded'))::int`.as("reminded"),
      ])
      .where("tenant_id", "=", tenantId)
      .executeTakeFirstOrThrow();
    return { due: row.due, reminded: row.reminded };
  });
}

// ---- Staff actions ---------------------------------------------------------------------------------------------------------

const recallRef = z.object({ customerId: z.uuid(), ruleId: z.uuid() });

async function lockRecall(tx: Tx, tenantId: string, customerId: string, ruleId: string) {
  const row = await sql<{ status: string; due_on: string; service_id: string; display_name: string; email: string | null; phone: string | null }>`
    select r.status, to_char(r.due_on, 'YYYY-MM-DD') as due_on, u.service_id, c.display_name, c.email, c.phone
    from plg_dental_recall r
    join plg_dental_recall_rule u on u.tenant_id = r.tenant_id and u.id = r.rule_id
    join customer c on c.tenant_id = r.tenant_id and c.id = r.customer_id
    where r.tenant_id = ${tenantId} and r.customer_id = ${customerId} and r.rule_id = ${ruleId}
    for update of r`.execute(tx);
  const recall = row.rows[0];
  if (!recall) throw new AppError("NOT_FOUND", "Recall not found");
  return recall;
}

/** Sends the reminder now (staff pressed the button), whatever the date. */
export const remindRecall = defineCommand({
  name: "dental.recall.remind",
  input: recallRef,
  authorize: requirePermission("bookings.create"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const recall = await lockRecall(tx, tenantId, input.customerId, input.ruleId);
    if (recall.status === "done" || recall.status === "scheduled") throw new AppError("CONFLICT", `A ${recall.status} recall needs no reminder`);
    const queued = await queueReminders(
      tx,
      tenantId,
      { customerId: input.customerId, ruleId: input.ruleId, serviceId: recall.service_id, dueOn: recall.due_on, name: recall.display_name, email: recall.email, phone: recall.phone },
      `:manual:${uuidv7()}`,
    );
    if (queued === 0) throw new AppError("CONFLICT", "No reminder could be sent: the patient has no email or phone number, or opted out");
    await dentalDb(tx)
      .updateTable("plg_dental_recall")
      .set({ status: "reminded", last_reminded_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("customer_id", "=", input.customerId)
      .where("rule_id", "=", input.ruleId)
      .execute();
    await scope.audit({ action: "dental.recall.remind", targetType: "dental_recall", targetId: input.customerId, changes: { ruleId: input.ruleId, messages: queued } });
    return { messages: queued };
  },
});

const snoozeInput = recallRef.extend({ days: z.union([z.literal(30), z.literal(60), z.literal(90)]) });

/** Pushes the recall back by 30, 60 or 90 days (from today, or from its date when that is later). */
export const snoozeRecall = defineCommand({
  name: "dental.recall.snooze",
  input: snoozeInput,
  authorize: requirePermission("bookings.create"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const recall = await lockRecall(tx, tenantId, input.customerId, input.ruleId);
    if (recall.status === "done" || recall.status === "scheduled") throw new AppError("CONFLICT", `A ${recall.status} recall cannot be snoozed`);
    const today = await tenantToday(tx, tenantId);
    const from = recall.due_on > today ? recall.due_on : today;
    const dueOn = addDays(from, input.days);
    await sql`update plg_dental_recall set status = 'snoozed', due_on = ${dueOn}::date
      where tenant_id = ${tenantId} and customer_id = ${input.customerId} and rule_id = ${input.ruleId}`.execute(tx);
    await scope.audit({ action: "dental.recall.snooze", targetType: "dental_recall", targetId: input.customerId, changes: { ruleId: input.ruleId, days: input.days, dueOn } });
    return { dueOn };
  },
});

// ---- Booking events ------------------------------------------------------------------------------------------------------------

/**
 * Follows the patient's bookings: a new booking of a rule's service marks the recall scheduled; a completed one starts
 * the next cycle (due in the rule's interval, counted from the day it was completed); a cancelled or missed one frees the recall.
 */
export async function onRecallBookingEvent(tx: Tx, event: DomainEventRow, ctx: { tenantId: string }): Promise<void> {
  const { tenantId } = ctx;
  const bookingId = event.aggregate_id;

  if (event.type === "booking.cancelled" || event.type === "booking.no_show") {
    await dentalDb(tx)
      .updateTable("plg_dental_recall")
      .set({ status: "upcoming", booking_id: null })
      .where("tenant_id", "=", tenantId)
      .where("booking_id", "=", bookingId)
      .where("status", "=", "scheduled")
      .execute();
    return;
  }

  const booking = await tx
    .selectFrom("booking as b")
    .innerJoin("location as l", (join) => join.onRef("l.tenant_id", "=", "b.tenant_id").onRef("l.id", "=", "b.location_id"))
    .select(["b.customer_id", "b.starts_at", "l.time_zone"])
    .where("b.tenant_id", "=", tenantId)
    .where("b.id", "=", bookingId)
    .executeTakeFirst();
  if (!booking || booking.customer_id === null) return;
  const services = await tx.selectFrom("booking_item").select("service_id").where("tenant_id", "=", tenantId).where("booking_id", "=", bookingId).execute();
  if (services.length === 0) return;
  const rules = await dentalDb(tx)
    .selectFrom("plg_dental_recall_rule")
    .select(["id", "interval_months", "active"])
    .where("tenant_id", "=", tenantId)
    .where("service_id", "in", services.map((s) => s.service_id))
    .execute();

  for (const rule of rules) {
    if (event.type === "booking.created") {
      if (!rule.active) continue;
      await dentalDb(tx)
        .updateTable("plg_dental_recall")
        .set({ status: "scheduled", booking_id: bookingId })
        .where("tenant_id", "=", tenantId)
        .where("customer_id", "=", booking.customer_id)
        .where("rule_id", "=", rule.id)
        .where("status", "in", ["upcoming", "due", "reminded", "snoozed"])
        .execute();
    } else if (event.type === "booking.completed") {
      if (!rule.active) {
        await dentalDb(tx)
          .updateTable("plg_dental_recall")
          .set({ status: "done", booking_id: bookingId })
          .where("tenant_id", "=", tenantId)
          .where("customer_id", "=", booking.customer_id)
          .where("rule_id", "=", rule.id)
          .execute();
        continue;
      }
      const completedOn = localDateOf(event.occurred_at.getTime(), booking.time_zone);
      await sql`
        insert into plg_dental_recall (tenant_id, customer_id, rule_id, due_on, last_visit_at, status)
        values (${tenantId}, ${booking.customer_id}, ${rule.id}, (${completedOn}::date + make_interval(months => ${rule.interval_months}::int))::date, ${booking.starts_at}, 'upcoming')
        on conflict (tenant_id, customer_id, rule_id) do update
          set due_on = excluded.due_on, last_visit_at = excluded.last_visit_at, status = 'upcoming', booking_id = null, last_reminded_at = null`.execute(tx);
    }
  }
}
