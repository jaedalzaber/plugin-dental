// Integration tests of the medical-history review reminders. The test builds its clinic with core's own commands,
// which a plugin never imports, so these imports reach into the repo by path.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@appointit/plugin-sdk";
import { closeDb, sql, withTenantTx } from "@appointit/plugin-sdk/server";
import type { CommandContext } from "@appointit/plugin-sdk/server";
import { getOwnerDb } from "../../../../booking-and-cms/packages/db/src";
import { createTenant } from "../../../../booking-and-cms/packages/testing/src";
import { cancelBooking, createBooking } from "../../../../booking-and-cms/packages/core/src/booking";
import { createService, publishServiceVersion } from "../../../../booking-and-cms/packages/core/src/catalog";
import { createCustomer } from "../../../../booking-and-cms/packages/core/src/customers";
import { getTaskList, registerTask } from "../../../../booking-and-cms/packages/core/src/events";
import { createForm, publishForm } from "../../../../booking-and-cms/packages/core/src/forms";
import { createLogger, generateKeyring } from "../../../../booking-and-cms/packages/core/src/kernel";
import { getDefaultTemplate, registerTemplateDefinition, renderMessage } from "../../../../booking-and-cms/packages/core/src/messaging";
import { createResource, createResourceType, publishSchedule } from "../../../../booking-and-cms/packages/core/src/resources";
import { createLocation } from "../../../../booking-and-cms/packages/core/src/tenancy";
import "../../../../booking-and-cms/packages/core/src/messaging"; // registers the message delivery task
import { HISTORY_REVIEW_TASK, HISTORY_REVIEW_TEMPLATE, registerHistory, saveHistory } from "./index";
import { DENTAL_PLUGIN_ID } from "./consent";
import { emptyHistory } from "./schema";

beforeAll(async () => {
  vi.stubEnv("APP_ENCRYPTION_KEYS", generateKeyring("k1"));
  process.env.FILES_DIR = await mkdtemp(join(tmpdir(), "dental-history-reminders-"));
  // The plugin host is not needed: give registerHistory a minimal api that registers with core directly.
  registerHistory({ registerTask, logger: createLogger("dental-test") } as unknown as PluginApi);
  // The plugin registers its message text when it loads; here core gets it directly.
  registerTemplateDefinition(HISTORY_REVIEW_TEMPLATE);
});

afterAll(async () => {
  await closeDb();
});

const system = (tenantId: string): CommandContext => ({ tenantId, actor: { type: "system" } });
const doctor = (tenantId: string): CommandContext => ({
  tenantId,
  actor: { type: "user", id: "user-doctor" },
  permissions: new Set(["health.read", "health.manage", "bookings.read"]),
});

/** n days from today at the given UTC hour (the location is UTC and open all day). */
const daysAhead = (n: number, hour: number): string => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

// Words that only the medical history holds. None of them may travel in a message.
const SECRETS = ["penicillin", "warfarin", "anticoagulant", "diabetes", "anxious", "latex"];

async function makeClinic(opts: { intakeForm?: boolean; switchedOn?: boolean } = {}) {
  const tenantId = await createTenant({ name: "Smile Dental" });
  // Package plugins are off until a business switches them on; the daily task skips the others.
  if (opts.switchedOn !== false) {
    await withTenantTx(tenantId, (tx) => tx.insertInto("plugin_setting").values({ tenant_id: tenantId, plugin_id: DENTAL_PLUGIN_ID, enabled: true }).execute());
  }
  const ctx = system(tenantId);
  const location = await createLocation.run(ctx, { name: "Main", timeZone: "UTC", currency: "EUR", policy: { noticeMin: 0, horizonDays: 365 } });
  await publishSchedule.run(ctx, {
    locationId: location.id,
    effectiveFrom: "2020-01-01",
    rules: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, ranges: [{ start: "00:00", end: "23:59" }] })),
  });
  const type = await createResourceType.run(ctx, { key: "chair", name: "Chair", kind: "space" });
  await createResource.run(ctx, { locationId: location.id, typeId: type.id, name: "Chair 1" });
  const created = await createService.run(ctx, { name: "Exam", locationId: location.id });
  await publishServiceVersion.run(ctx, {
    serviceId: created.id,
    durationMin: 30,
    priceType: "fixed",
    priceMinor: 5000,
    needs: [{ key: "chair", selector: { typeKey: "chair" }, offsetMin: 0, lengthMin: null }],
  });
  let formSlug: string | null = null;
  if (opts.intakeForm !== false) {
    const form = await createForm.run(ctx, {
      name: "New patient intake",
      purpose: "intake",
      slug: "new-patient-intake",
      draft: { name: "New patient intake", steps: [{ id: "s1", t: "Step" }], fields: [{ id: "f1", type: "name" }] },
    });
    await publishForm.run(ctx, { id: form.id, expectedVersion: form.version });
    formSlug = "new-patient-intake";
  }
  return { tenantId, ctx, locationId: location.id, serviceId: created.id, formSlug };
}

type Clinic = Awaited<ReturnType<typeof makeClinic>>;

async function patient(t: Clinic, displayName: string, contact: { email?: string; phone?: string } = {}): Promise<string> {
  return (await createCustomer.run(t.ctx, { displayName, ...contact })).id;
}

function visit(t: Clinic, customerId: string, start: string) {
  return createBooking.run(t.ctx, { locationId: t.locationId, items: [{ serviceId: t.serviceId }], start, customer: { id: customerId } });
}

/** A history with clinical content, saved by a doctor. Reviewed with the patient when markReviewed is true. */
async function writeHistory(t: Clinic, customerId: string, markReviewed: boolean) {
  const document = emptyHistory();
  document.allergies.penicillin = true;
  document.allergies.other = "Latex";
  document.anticoagulants = true;
  document.medications = ["Warfarin 5mg"];
  document.conditions.diabetes = true;
  document.notes = "Anxious patient";
  await saveHistory(doctor(t.tenantId), { customerId, expectedVersion: 0, document, markReviewed });
}

const runTask = async (): Promise<void> => {
  await getTaskList()[HISTORY_REVIEW_TASK]?.({}, {} as never);
};

async function reminders(tenantId: string) {
  return withTenantTx(tenantId, (tx) =>
    tx
      .selectFrom("message")
      .select(["id", "channel", "to_address", "customer_id", "booking_id", "status"])
      .where("tenant_id", "=", tenantId)
      .where("template_key", "=", "dental.history_review")
      .orderBy("created_at")
      .execute(),
  );
}

async function healthReads(tenantId: string): Promise<number> {
  return withTenantTx(tenantId, async (tx) => {
    const row = await tx
      .selectFrom("audit_event")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("tenant_id", "=", tenantId)
      .where("action", "=", "health.read")
      .executeTakeFirstOrThrow();
    return row.n;
  });
}

async function payloadOf(messageId: string): Promise<{ vars: Record<string, unknown> }> {
  const jobs = await sql<{ payload: { vars: Record<string, unknown> } }>`
    select j.payload from graphile_worker._private_jobs j join graphile_worker._private_tasks k on k.id = j.task_id
    where k.identifier = 'messaging.deliver' and j.payload->>'messageId' = ${messageId}`.execute(getOwnerDb());
  const row = jobs.rows[0];
  if (!row) throw new Error("no delivery job for the message");
  return row.payload;
}

describe("medical history review reminders", () => {
  it("a due patient with a visit in 2 days gets exactly one message, none the second time; a reviewed patient gets none; the message holds no history content", async () => {
    const t = await makeClinic();
    const due = await patient(t, "Dana Due", { email: "dana@example.com" });
    const reviewed = await patient(t, "Rob Reviewed", { email: "rob@example.com" });
    await writeHistory(t, due, false); // a first record is due for review until staff confirm it
    await writeHistory(t, reviewed, true); // due in 12 months, long after the visit
    const dueBooking = await visit(t, due, daysAhead(2, 10));
    await visit(t, reviewed, daysAhead(2, 11));
    const readsBefore = await healthReads(t.tenantId);

    await runTask();
    const first = await reminders(t.tenantId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ channel: "email", to_address: "dana@example.com", customer_id: due, booking_id: dueBooking.bookingId, status: "queued" });

    // The payload is everything the message is rendered from: a name, the visit date and a link.
    const { vars } = await payloadOf(first[0]?.id as string);
    expect(Object.keys(vars).sort()).toEqual(["customer", "formUrl", "visit"]);
    expect(vars.formUrl).toMatch(/\/f\/new-patient-intake$/);
    const email = getDefaultTemplate("dental.history_review", "email");
    const sms = getDefaultTemplate("dental.history_review", "sms");
    expect(email).toBeDefined();
    expect(sms).toBeDefined();
    for (const [channel, template] of [["email", email], ["sms", sms]] as const) {
      const rendered = renderMessage({ channel, subject: template?.subject ?? null, body: template?.body ?? "", vars: { ...vars, business: { name: "Smile Dental" } }, businessName: "Smile Dental" });
      const text = `${rendered.subject ?? ""}\n${rendered.text}\n${rendered.html ?? ""}`.toLowerCase();
      expect(rendered.text).toContain("review your medical history before your visit on");
      expect(rendered.text).toContain((vars.visit as { date: string }).date);
      expect(rendered.text).toContain("/f/new-patient-intake");
      for (const secret of SECRETS) expect(text).not.toContain(secret);
    }
    expect(JSON.stringify(vars).toLowerCase()).not.toMatch(new RegExp(SECRETS.join("|")));

    // A second run (and a third) queues nothing new.
    await runTask();
    await runTask();
    expect(await reminders(t.tenantId)).toHaveLength(1);

    // Dates only: the reminder run wrote no health.read audit row (nothing was decrypted).
    expect(await healthReads(t.tenantId)).toBe(readsBefore);
  });

  it("a patient with no history record, a visit in 2 days and a phone number gets an email and a text; nobody else does", async () => {
    const t = await makeClinic();
    const missing = await patient(t, "Mia Missing", { email: "mia@example.com", phone: "+15550123456" });
    const noContact = await patient(t, "Nico NoContact");
    const far = await patient(t, "Fay Far", { email: "fay@example.com" });
    const cancelled = await patient(t, "Cal Cancelled", { email: "cal@example.com" });
    await visit(t, missing, daysAhead(2, 9));
    await visit(t, noContact, daysAhead(2, 10));
    await visit(t, far, daysAhead(6, 10)); // outside the 3-day window
    const dropped = await visit(t, cancelled, daysAhead(2, 11));
    await cancelBooking.run(t.ctx, { bookingId: dropped.bookingId, expectedVersion: 1 });

    await runTask();
    const sent = await reminders(t.tenantId);
    expect(sent.map((m) => [m.customer_id, m.channel]).sort()).toEqual([[missing, "email"], [missing, "sms"]].sort());
    await runTask();
    expect(await reminders(t.tenantId)).toHaveLength(2);
  });

  it("a visit that comes after the review date is reminded; one before it is not; a clinic without an intake form, or one that has not switched the plugin on, sends nothing", async () => {
    const t = await makeClinic();
    const soon = await patient(t, "Sue Soon", { email: "sue@example.com" });
    await writeHistory(t, soon, true);
    // Review due in 1 day: before a visit in 2 days.
    await withTenantTx(t.tenantId, (tx) => sql`update plg_dental_medical_history set review_due_at = now() + interval '1 day' where tenant_id = ${t.tenantId}`.execute(tx));
    await visit(t, soon, daysAhead(2, 10));
    await runTask();
    expect((await reminders(t.tenantId)).map((m) => m.customer_id)).toEqual([soon]);

    // Review due in 5 days: after the visit, so no reminder for a second patient.
    const later = await patient(t, "Lee Later", { email: "lee@example.com" });
    await writeHistory(t, later, true);
    await withTenantTx(t.tenantId, (tx) => sql`update plg_dental_medical_history set review_due_at = now() + interval '5 days' where tenant_id = ${t.tenantId} and customer_id = ${later}`.execute(tx));
    await visit(t, later, daysAhead(2, 11));
    await runTask();
    expect(await reminders(t.tenantId)).toHaveLength(1);

    const bare = await makeClinic({ intakeForm: false });
    const nobody = await patient(bare, "Ned NoForm", { email: "ned@example.com" });
    await visit(bare, nobody, daysAhead(2, 10));
    await runTask();
    expect(await reminders(bare.tenantId)).toHaveLength(0);

    // A clinic that has not switched the plugin on is skipped, even with an intake form and a visit in the window.
    const off = await makeClinic({ switchedOn: false });
    const waiting = await patient(off, "Olga Off", { email: "olga@example.com" });
    await visit(off, waiting, daysAhead(2, 10));
    await runTask();
    expect(await reminders(off.tenantId)).toHaveLength(0);
  });
});
