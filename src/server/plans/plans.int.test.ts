// Integration tests of dental treatment plans and recall. The test builds its clinic with core's own commands,
// which a plugin never imports, so these imports reach into the repo by path.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@appointit/plugin-sdk";
import { AppError, closeDb, sql, withTenantTx } from "@appointit/plugin-sdk/server";
import type { CommandContext } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../db-types";
import { DENTAL_PLUGIN_ID } from "../history/consent";
import { getOwnerDb } from "../../../../booking-and-cms/packages/db/src";
import { createTenant } from "../../../../booking-and-cms/packages/testing/src";
import { createBooking, transitionBooking } from "../../../../booking-and-cms/packages/core/src/booking";
import { createService, publishServiceVersion } from "../../../../booking-and-cms/packages/core/src/catalog";
import { createCustomer } from "../../../../booking-and-cms/packages/core/src/customers";
import { getTaskList, registerSubscriber, registerTask, runJobsOnce } from "../../../../booking-and-cms/packages/core/src/events";
import { createForm, publishForm } from "../../../../booking-and-cms/packages/core/src/forms";
import { createLogger, generateKeyring } from "../../../../booking-and-cms/packages/core/src/kernel";
import { createResource, createResourceType, publishSchedule } from "../../../../booking-and-cms/packages/core/src/resources";
import { createLocation } from "../../../../booking-and-cms/packages/core/src/tenancy";
import "../../../../booking-and-cms/packages/core/src/messaging"; // registers the message delivery task
import { localDateOf, daysBetween } from "./dates";
import { acceptPlan, bookPlan, createPlan, findPlanTimes, getPlan, listRecalls, proposePlan, registerPlans, RECALL_DAILY_TASK, saveRecallRule } from "./index";

beforeAll(async () => {
  vi.stubEnv("APP_ENCRYPTION_KEYS", generateKeyring("k1"));
  process.env.FILES_DIR = await mkdtemp(join(tmpdir(), "dental-plans-"));
  // The plugin host is not needed: give registerPlans a minimal api that registers with core directly.
  registerPlans({ registerSubscriber, registerTask, logger: createLogger("dental-test") } as unknown as PluginApi);
});

afterAll(async () => {
  await closeDb();
});

const system = (tenantId: string): CommandContext => ({ tenantId, actor: { type: "system" } });
const SIGNATURE_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function service(ctx: CommandContext, locationId: string, name: string): Promise<string> {
  const created = await createService.run(ctx, { name, locationId });
  await publishServiceVersion.run(ctx, {
    serviceId: created.id,
    durationMin: 30,
    priceType: "fixed",
    priceMinor: 5000,
    needs: [{ key: "chair", selector: { typeKey: "chair" }, offsetMin: 0, lengthMin: null }],
  });
  return created.id;
}

/** One UTC location open all day, one chair, services Cleaning, Filling and Crown, and procedures that point at them. */
async function makeClinic() {
  const tenantId = await createTenant({ name: "Smile Dental" });
  const ctx = system(tenantId);
  const location = await createLocation.run(ctx, { name: "Main", timeZone: "UTC", currency: "EUR", policy: { noticeMin: 0, horizonDays: 365 } });
  await publishSchedule.run(ctx, {
    locationId: location.id,
    effectiveFrom: "2020-01-01",
    rules: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, ranges: [{ start: "00:00", end: "23:59" }] })),
  });
  const type = await createResourceType.run(ctx, { key: "chair", name: "Chair", kind: "space" });
  await createResource.run(ctx, { locationId: location.id, typeId: type.id, name: "Chair 1" });
  const cleaning = await service(ctx, location.id, "Cleaning");
  const filling = await service(ctx, location.id, "Filling");
  const crown = await service(ctx, location.id, "Crown");
  const procedure = async (name: string, serviceId: string, price: number): Promise<string> =>
    withTenantTx(tenantId, async (tx) => {
      const row = await dentalDb(tx).insertInto("plg_dental_procedure").values({ tenant_id: tenantId, name, service_id: serviceId, default_price_minor: price, currency: "EUR" }).returning("id").executeTakeFirstOrThrow();
      return row.id;
    });
  return {
    tenantId,
    ctx,
    locationId: location.id,
    services: { cleaning, filling, crown },
    procedures: { filling: await procedure("Composite filling", filling, 12000), crown: await procedure("Crown", crown, 90000) },
  };
}

type Clinic = Awaited<ReturnType<typeof makeClinic>>;

async function patient(t: Clinic, displayName: string, email = "ann@example.com"): Promise<string> {
  return (await createCustomer.run(t.ctx, { displayName, email })).id;
}

/** A three-visit plan, proposed and accepted: filling, filling 7+ days later, crown 14+ days after that. */
async function acceptedPlan(t: Clinic, customerId: string) {
  const created = await createPlan.run(t.ctx, {
    customerId,
    title: "Upper right restoration",
    insuranceEstimateMinor: 30000,
    notes: "Patient is nervous",
    items: [
      { procedureId: t.procedures.filling, tooth: "16", surfaces: ["M", "O"], minGapDays: 0 },
      { procedureId: t.procedures.filling, tooth: "17", surfaces: ["O"], minGapDays: 7, maxGapDays: 21 },
      { procedureId: t.procedures.crown, tooth: "16", minGapDays: 14, maxGapDays: 30 },
    ],
  });
  const proposed = await proposePlan.run(t.ctx, { planId: created.id, expectedVersion: created.version });
  const accepted = await acceptPlan.run(t.ctx, { planId: created.id, expectedVersion: proposed.version, signerName: "Ann Patient", signatureDataUrl: SIGNATURE_PNG, strokes: [[[0.1, 0.5], [0.5, 0.2], [0.9, 0.6]]] });
  return { id: created.id, version: accepted.version, accepted };
}

const owner = () => getOwnerDb();

async function drainJobs(): Promise<void> {
  for (let i = 0; i < 4; i++) await runJobsOnce();
}

describe("treatment plans", () => {
  it("prices come from the procedures, the estimate is the sum, notes are stored encrypted, acceptance stores a signature and a PDF", async () => {
    const t = await makeClinic();
    const customerId = await patient(t, "Ann Patient");
    const plan = await acceptedPlan(t, customerId);
    const dto = await getPlan(t.tenantId, plan.id);
    expect(dto).toMatchObject({ status: "accepted", currency: "EUR", estimateMinor: 12000 + 12000 + 90000, insuranceEstimateMinor: 30000, patientShareMinor: 84000, notes: "Patient is nervous" });
    expect(dto.items.map((i) => [i.seq, i.procedureName, i.tooth, i.serviceName, i.priceMinor])).toEqual([
      [1, "Composite filling", "16", "Filling", 12000],
      [2, "Composite filling", "17", "Filling", 12000],
      [3, "Crown", "16", "Crown", 90000],
    ]);
    expect(dto.acceptedAt).not.toBeNull();
    expect(dto.acceptanceUrl).toBe(`/api/v1/files/${dto.acceptanceFileId}`);

    const raw = await withTenantTx(t.tenantId, (tx) => dentalDb(tx).selectFrom("plg_dental_treatment_plan").select("notes_enc").where("id", "=", plan.id).executeTakeFirstOrThrow());
    expect(raw.notes_enc).not.toContain("nervous");
    const files = await withTenantTx(t.tenantId, (tx) => tx.selectFrom("file_object").select(["purpose", "content_type", "visibility"]).where("tenant_id", "=", t.tenantId).execute());
    expect(files.map((f) => `${f.purpose}:${f.content_type}:${f.visibility}`).sort()).toEqual(["dental_plan_acceptance:application/pdf:private", "dental_plan_signature:image/png:private"]);
  });

  it("booking a 3-visit plan creates one series with the gaps respected", async () => {
    const t = await makeClinic();
    const customerId = await patient(t, "Ann Patient");
    const plan = await acceptedPlan(t, customerId);

    const schedule = await findPlanTimes(t.tenantId, { planId: plan.id, locationId: t.locationId });
    expect(schedule.complete).toBe(true);
    expect(schedule.visits).toHaveLength(3);
    const starts = schedule.visits.map((v) => v.start as string);
    const days = starts.map((s) => localDateOf(Date.parse(s), "UTC"));
    expect(daysBetween(days[0] as string, days[1] as string)).toBeGreaterThanOrEqual(7);
    expect(daysBetween(days[1] as string, days[2] as string)).toBeGreaterThanOrEqual(14);

    const booked = await bookPlan.run(t.ctx, { planId: plan.id, expectedVersion: plan.version, locationId: t.locationId, visits: schedule.visits.map((v) => ({ itemId: v.itemId, start: v.start as string })) });
    expect(booked.bookings).toHaveLength(3);

    const rows = await withTenantTx(t.tenantId, (tx) =>
      tx.selectFrom("booking").select(["id", "series_id", "customer_id", "status", sql<string>`to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD')`.as("day")]).where("tenant_id", "=", t.tenantId).orderBy("starts_at").execute(),
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.series_id))).toEqual(new Set([booked.seriesId]));
    expect(rows.every((r) => r.customer_id === customerId && r.status === "confirmed")).toBe(true);
    expect(rows.map((r) => r.day)).toEqual(days);
    const after = await getPlan(t.tenantId, plan.id);
    expect(after.status).toBe("in_progress");
    expect(after.seriesId).toBe(booked.seriesId);
    expect(after.items.map((i) => i.status)).toEqual(["booked", "booked", "booked"]);
    expect(after.items.map((i) => i.bookingId)).toEqual(booked.bookings.map((b) => b.bookingId));

    // Booking again is refused: nothing is left to book.
    await expect(bookPlan.run(t.ctx, { planId: plan.id, expectedVersion: after.version, locationId: t.locationId, visits: [{ itemId: after.items[0]?.id as string, start: starts[0] as string }] })).rejects.toMatchObject({ code: "CONFLICT" });

    // Completing every visit finishes the plan.
    for (const [index, b] of booked.bookings.entries()) {
      await transitionBooking.run(t.ctx, { bookingId: b.bookingId, expectedVersion: 1, to: "completed" });
      await drainJobs();
      const mid = await getPlan(t.tenantId, plan.id);
      expect(mid.items.filter((i) => i.status === "done")).toHaveLength(index + 1);
      expect(mid.status).toBe(index === 2 ? "completed" : "in_progress");
    }
  });

  it("a visit that breaks its minimum gap is refused, and a 3rd visit that cannot be booked creates nothing", async () => {
    const t = await makeClinic();
    const customerId = await patient(t, "Ann Patient");
    const other = await patient(t, "Bob Other", "bob@example.com");
    const plan = await acceptedPlan(t, customerId);
    const schedule = await findPlanTimes(t.tenantId, { planId: plan.id, locationId: t.locationId });
    const visits = schedule.visits.map((v) => ({ itemId: v.itemId, start: v.start as string }));

    // Visit 2 only 2 days after visit 1 while it needs 7.
    const tooSoon = [visits[0] as (typeof visits)[number], { itemId: visits[1]?.itemId as string, start: new Date(Date.parse(visits[0]?.start as string) + 2 * 86_400_000).toISOString() }, visits[2] as (typeof visits)[number]];
    await expect(bookPlan.run(t.ctx, { planId: plan.id, expectedVersion: plan.version, locationId: t.locationId, visits: tooSoon })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    // Somebody else takes the chair at visit 3's time first.
    await createBooking.run(t.ctx, { locationId: t.locationId, items: [{ serviceId: t.services.crown }], start: visits[2]?.start as string, customer: { id: other } });

    const err = await bookPlan.run(t.ctx, { planId: plan.id, expectedVersion: plan.version, locationId: t.locationId, visits }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "SLOT_TAKEN", details: { visit: 2 } });

    const mine = await withTenantTx(t.tenantId, (tx) => tx.selectFrom("booking").select("id").where("tenant_id", "=", t.tenantId).where("customer_id", "=", customerId).execute());
    expect(mine).toHaveLength(0);
    const series = await withTenantTx(t.tenantId, (tx) => tx.selectFrom("booking_series").select("id").where("tenant_id", "=", t.tenantId).execute());
    expect(series).toHaveLength(0);
    const after = await getPlan(t.tenantId, plan.id);
    expect(after.status).toBe("accepted");
    expect(after.items.map((i) => [i.status, i.bookingId])).toEqual([["planned", null], ["planned", null], ["planned", null]]);
  });
});

describe("recall", () => {
  /** 10:00 UTC, n days from today (a fixed time of day, so the visit never runs past the 23:59 closing time). */
  const daysAhead = (n: number) => {
    const d = new Date(Date.now() + n * 86_400_000);
    d.setUTCHours(10, 0, 0, 0);
    return d.toISOString();
  };

  async function recallClinic() {
    const t = await makeClinic();
    const customerId = await patient(t, "Ann Patient");
    const rule = await saveRecallRule.run(t.ctx, { name: "Check-up and cleaning every 6 months", serviceId: t.services.cleaning, intervalMonths: 6, leadDays: 14 });
    return { ...t, customerId, ruleId: rule.id };
  }

  async function completeCleaning(t: Awaited<ReturnType<typeof recallClinic>>, start: string) {
    const booking = await createBooking.run(t.ctx, { locationId: t.locationId, items: [{ serviceId: t.services.cleaning }], start, customer: { id: t.customerId } });
    await drainJobs();
    return booking;
  }

  it("a new booking of the service marks the recall booked, a cancelled one frees it, and a completed cleaning sets the next recall 6 months out", async () => {
    const t = await recallClinic();
    const start = daysAhead(2);
    const booking = await completeCleaning(t, start);
    await transitionBooking.run(t.ctx, { bookingId: booking.bookingId, expectedVersion: 1, to: "completed" });
    await drainJobs();

    const today = (await sql<{ d: string }>`select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as d`.execute(owner())).rows[0]?.d as string;
    const expected = (await sql<{ d: string }>`select to_char(${today}::date + interval '6 months', 'YYYY-MM-DD') as d`.execute(owner())).rows[0]?.d;
    const { rows } = await listRecalls(t.tenantId, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customerId: t.customerId, ruleId: t.ruleId, ruleName: "Check-up and cleaning every 6 months", status: "upcoming", dueOn: expected, bookingId: null });
    expect(rows[0]?.lastVisitAt).toBe(start);

    // Booking the same service again marks the recall as booked; cancelling that booking frees it.
    const next = await createBooking.run(t.ctx, { locationId: t.locationId, items: [{ serviceId: t.services.cleaning }], start: daysAhead(4), customer: { id: t.customerId } });
    await drainJobs();
    expect((await listRecalls(t.tenantId, {})).rows[0]).toMatchObject({ status: "scheduled", bookingId: next.bookingId });
    const { cancelBooking } = await import("../../../../booking-and-cms/packages/core/src/booking");
    await cancelBooking.run(t.ctx, { bookingId: next.bookingId, expectedVersion: 1 });
    await drainJobs();
    expect((await listRecalls(t.tenantId, {})).rows[0]).toMatchObject({ status: "upcoming", bookingId: null });
  });

  it("the daily task marks a recall that is near as due, queues exactly one message with a booking link, and does nothing the second time", async () => {
    const t = await recallClinic();
    const form = await createForm.run(t.ctx, { name: "Book", purpose: "booking", draft: { name: "Book", steps: [{ id: "s1", t: "Step" }], fields: [{ id: "f1", type: "name" }] } });
    await publishForm.run(t.ctx, { id: form.id, expectedVersion: form.version });
    const booking = await completeCleaning(t, daysAhead(2));
    await transitionBooking.run(t.ctx, { bookingId: booking.bookingId, expectedVersion: 1, to: "completed" });
    await drainJobs();

    // Not due yet: 6 months away, 14 days of lead.
    await getTaskList()[RECALL_DAILY_TASK]?.({}, {} as never);
    expect((await listRecalls(t.tenantId, {})).rows[0]?.status).toBe("upcoming");
    expect(await recallMessages(t.tenantId)).toHaveLength(0);

    // Ten days left: inside the lead time.
    await withTenantTx(t.tenantId, (tx) => sql`update plg_dental_recall set due_on = current_date + 10 where tenant_id = ${t.tenantId}`.execute(tx));
    // Package plugins are off until a business switches them on: the task skips this one.
    await getTaskList()[RECALL_DAILY_TASK]?.({}, {} as never);
    expect((await listRecalls(t.tenantId, {})).rows[0]?.status).toBe("upcoming");
    expect(await recallMessages(t.tenantId)).toHaveLength(0);
    await withTenantTx(t.tenantId, (tx) => tx.insertInto("plugin_setting").values({ tenant_id: t.tenantId, plugin_id: DENTAL_PLUGIN_ID, enabled: true }).execute());
    await getTaskList()[RECALL_DAILY_TASK]?.({}, {} as never);
    const row = (await listRecalls(t.tenantId, {})).rows[0];
    expect(row).toMatchObject({ status: "reminded" });
    expect(row?.lastRemindedAt).not.toBeNull();
    const messages = await recallMessages(t.tenantId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ channel: "email", to_address: "ann@example.com", customer_id: t.customerId });
    const jobs = await sql<{ payload: { vars?: { bookUrl?: string } } }>`
      select j.payload from graphile_worker._private_jobs j join graphile_worker._private_tasks k on k.id = j.task_id
      where k.identifier = 'messaging.deliver' and j.payload->>'messageId' = ${messages[0]?.id as string}`.execute(owner());
    expect(jobs.rows[0]?.payload.vars?.bookUrl).toMatch(new RegExp(`/f/${form.slug}\\?service=${t.services.cleaning}$`));

    await getTaskList()[RECALL_DAILY_TASK]?.({}, {} as never);
    expect(await recallMessages(t.tenantId)).toHaveLength(1);
  });
});

async function recallMessages(tenantId: string) {
  return withTenantTx(tenantId, (tx) =>
    tx.selectFrom("message").select(["id", "channel", "to_address", "customer_id"]).where("tenant_id", "=", tenantId).where("template_key", "=", "recall.due").execute(),
  );
}
