// Demo clinic ("Smile Dental Clinic"): a team, rooms and equipment, opening hours, a few bookings and three demo
// patients (one with a medical history alert, one on recall, one with a draft treatment plan). It runs after the generic
// demo seed made the business and the plugin's setup pack was applied (development and demo installs only).
import type { DemoInfo } from "@appointit/plugin-sdk";
import {
  addDaysLocal,
  createBooking,
  createCustomer,
  createResource,
  dayOfWeek,
  epochMsToLocal,
  getTenant,
  listLocations,
  listResourceTypes,
  localToEpochMs,
  publishSchedule,
  sql,
  toIso,
  updateTenant,
  withTenantTx,
} from "@appointit/plugin-sdk/server";
import type { CommandContext } from "@appointit/plugin-sdk/server";
import { listProcedures } from "../server/chart/procedures";
import { dentalDb } from "../server/db-types";
import { saveHistory } from "../server/history";
import { createPlan } from "../server/plans";
import { applyDentalSetup } from "./apply";

export const DEMO_CLINIC_NAME = "Smile Dental Clinic";

/** [resource type key, name]: the dentists, hygienists and assistants, the operatories and the X-ray machine. */
const TEAM: readonly [string, string][] = [
  ["dentist", "Dr. Ava Patel"],
  ["dentist", "Dr. Ben Ortiz"],
  ["hygienist", "Hygienist Cara Lee"],
  ["hygienist", "Hygienist Dan Kim"],
  ["assistant", "Assistant Eva Brown"],
  ["assistant", "Assistant Finn Walker"],
  ["operatory", "Operatory 1"],
  ["operatory", "Operatory 2"],
  ["operatory", "Operatory 3"],
  ["imaging", "Panoramic X-ray"],
];

/** Bookings next week: `day` counts from Monday. */
const BOOKINGS: readonly { day: number; time: string; service: string; name: string; email: string; phone: string }[] = [
  { day: 0, time: "09:00", service: "cleaning-and-check-up", name: "Maria Gomez", email: "maria.gomez@example.com", phone: "+12025550101" },
  { day: 0, time: "10:30", service: "new-patient-exam", name: "James Carter", email: "james.carter@example.com", phone: "+12025550102" },
  { day: 1, time: "09:00", service: "filling", name: "Priya Nair", email: "priya.nair@example.com", phone: "+12025550103" },
  { day: 2, time: "14:00", service: "whitening", name: "Liam Murphy", email: "liam.murphy@example.com", phone: "+12025550104" },
  { day: 3, time: "11:00", service: "cleaning-and-check-up", name: "Sofia Rossi", email: "sofia.rossi@example.com", phone: "+12025550105" },
];

export async function applyDentalDemo(ctx: CommandContext, info: DemoInfo): Promise<void> {
  const tenantId = ctx.tenantId;
  const locationId = info.locationId;

  const tenant = await getTenant(tenantId);
  if (tenant.name !== DEMO_CLINIC_NAME) await updateTenant.run(ctx, { expectedVersion: tenant.version, name: DEMO_CLINIC_NAME });
  const timeZone = (await listLocations(tenantId)).find((location) => location.id === locationId)?.timeZone;
  if (timeZone === undefined) throw new Error("The demo location was not found");

  // Team, rooms and equipment (the resource types come from the setup pack).
  const types = new Map((await listResourceTypes(tenantId)).map((type) => [type.key, type.id]));
  for (const [typeKey, name] of TEAM) {
    const typeId = types.get(typeKey);
    if (!typeId) throw new Error(`The dental setup did not create the resource type "${typeKey}"`);
    await createResource.run(ctx, { locationId, typeId, name });
  }

  // Opening hours: Mon-Fri 09:00-13:00 and 14:00-17:00, Saturday 09:00-13:00.
  const morning = { start: "09:00", end: "13:00" };
  const afternoon = { start: "14:00", end: "17:00" };
  const today = epochMsToLocal(Date.now(), timeZone).date;
  await publishSchedule.run(ctx, {
    locationId,
    effectiveFrom: today,
    rules: [
      ...([1, 2, 3, 4, 5] as const).map((day) => ({ day, ranges: [morning, afternoon] })),
      { day: 6 as const, ranges: [morning] },
    ],
  });

  // The team lets every service be published (the setup before it left them as drafts).
  await applyDentalSetup(ctx);
  const serviceIds = new Map(
    (await withTenantTx(tenantId, (tx) => tx.selectFrom("service").select(["id", "slug"]).where("tenant_id", "=", tenantId).execute())).map((row) => [row.slug, row.id]),
  );

  // A few bookings next week (Monday on or after tomorrow's week), for demo customers.
  let monday = addDaysLocal(today, 1);
  while (dayOfWeek(monday) !== 1) monday = addDaysLocal(monday, 1);
  for (const booking of BOOKINGS) {
    const serviceId = serviceIds.get(booking.service);
    if (!serviceId) throw new Error(`Unknown service ${booking.service}`);
    const date = addDaysLocal(monday, booking.day);
    await createBooking.run(ctx, {
      locationId,
      items: [{ serviceId }],
      start: toIso(localToEpochMs(date, booking.time, timeZone)),
      customer: { displayName: booking.name, email: booking.email, phone: booking.phone },
      source: "admin",
    });
  }

  // Three demo patients: a medical history with an alert, a patient due for recall, a draft treatment plan.
  const patient = async (displayName: string, email: string, phone: string): Promise<string> =>
    (await createCustomer.run(ctx, { displayName, email, phone })).id;

  const alertPatient = await patient("Noah Becker", "noah.becker@example.com", "+12025550106");
  await saveHistory(ctx, {
    customerId: alertPatient,
    expectedVersion: 0,
    document: { allergies: { penicillin: true }, medications: ["Vitamin D"] },
    markReviewed: true,
  });

  const recallPatient = await patient("Aisha Khan", "aisha.khan@example.com", "+12025550107");
  await withTenantTx(tenantId, async (tx) => {
    const rule = await dentalDb(tx)
      .selectFrom("plg_dental_recall_rule")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("name", "=", "Cleaning every 6 months")
      .executeTakeFirstOrThrow();
    // Last cleaned about five and a half months ago: the next visit is due in two weeks.
    await sql`
      insert into plg_dental_recall (tenant_id, customer_id, rule_id, due_on, last_visit_at, status)
      values (${tenantId}, ${recallPatient}, ${rule.id}, current_date + 14, now() - interval '166 days', 'upcoming')`.execute(tx);
  });

  const planPatient = await patient("Tom Fischer", "tom.fischer@example.com", "+12025550108");
  const procedures = new Map((await listProcedures(ctx)).map((procedure) => [procedure.code, procedure.id]));
  const filling2 = procedures.get("FILL-2");
  const filling1 = procedures.get("FILL-1");
  if (!filling2 || !filling1) throw new Error("The dental setup did not create the filling procedures");
  await createPlan.run(ctx, {
    customerId: planPatient,
    title: "Lower left restoration",
    items: [
      { procedureId: filling2, tooth: "36", surfaces: ["O", "D"], minGapDays: 0 },
      { procedureId: filling1, tooth: "37", surfaces: ["O"], minGapDays: 7 },
    ],
  });
}
