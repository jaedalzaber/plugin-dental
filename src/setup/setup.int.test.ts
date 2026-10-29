// Integration tests of the dental setup pack. The test builds its clinic with core's own commands, which a plugin
// never imports, so these imports reach into the repo by path.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, createForm, createPage, publishForm, publishPage, setHomePage, sql, updateSite, withTenantTx } from "@appointit/plugin-sdk/server";
import type { CommandContext } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../server/db-types";
import { createTenant } from "../../../booking-and-cms/packages/testing/src";
import { createBooking } from "../../../booking-and-cms/packages/core/src/booking";
import { getSite } from "../../../booking-and-cms/packages/core/src/pages";
import { createCustomer } from "../../../booking-and-cms/packages/core/src/customers";
import { createResource, publishSchedule } from "../../../booking-and-cms/packages/core/src/resources";
import { generateKeyring } from "../../../booking-and-cms/packages/core/src/kernel";
import { createLocation } from "../../../booking-and-cms/packages/core/src/tenancy";
import { mapIntakeAnswers, type IntakeField } from "../server/history/intake-mapping";
import { getConsentForms } from "../server/history/consent";
import { listProcedures } from "../server/chart/procedures";
import { saveHistory } from "../server/history";
import { createPlan, listRecallRules, listRecalls } from "../server/plans";
import {
  BOOKING_FORM,
  BOOKING_FORM_SLUG,
  BOOKING_THANKS,
  FORMS_PACK,
  FORM_THANKS,
  INTAKE_FIELD_SECTIONS,
  INTAKE_FORM,
  PAGES_PACK,
  PROCEDURES_PACK,
  RECALL_PACK,
  RESOURCE_TYPES_PACK,
  SERVICES_PACK,
  SETUP_PARTS,
  VOCABULARY_PACK,
  applyDentalSetup,
  getDentalSetupStatus,
} from "./index";

beforeAll(() => {
  vi.stubEnv("APP_ENCRYPTION_KEYS", generateKeyring("k1")); // the medical history is stored encrypted
});

afterAll(async () => {
  await closeDb();
});

const system = (tenantId: string): CommandContext => ({ tenantId, actor: { type: "system" } });

const TOTALS = {
  vocabulary: Object.keys(VOCABULARY_PACK).length,
  resourceTypes: RESOURCE_TYPES_PACK.length,
  services: SERVICES_PACK.length,
  procedures: PROCEDURES_PACK.length,
  recall: RECALL_PACK.length,
  forms: FORMS_PACK.length,
  pages: PAGES_PACK.length,
};
const NONE = { vocabulary: 0, resourceTypes: 0, services: 0, procedures: 0, recall: 0, forms: 0, pages: 0 };

/** A clinic with one location (USD) and the pack's resource types. */
async function makeClinic() {
  const tenantId = await createTenant({ name: "Smile Dental" });
  const ctx = system(tenantId);
  const location = await createLocation.run(ctx, { name: "Main", timeZone: "UTC", currency: "USD", policy: { noticeMin: 0, horizonDays: 365 } });
  return { tenantId, ctx, locationId: location.id };
}

/** One person per kind and one operatory, so every service of the pack can be published. */
async function addTeam(t: Awaited<ReturnType<typeof makeClinic>>) {
  const types = await withTenantTx(t.tenantId, (tx) => tx.selectFrom("resource_type").select(["id", "key"]).where("tenant_id", "=", t.tenantId).execute());
  const typeId = (key: string): string => {
    const found = types.find((x) => x.key === key);
    if (!found) throw new Error(`missing type ${key}`);
    return found.id;
  };
  for (const [key, name] of [
    ["dentist", "Dr. Ava Patel"],
    ["hygienist", "Hygienist Cara Lee"],
    ["assistant", "Assistant Dan Kim"],
    ["operatory", "Operatory 1"],
  ] as const) {
    await createResource.run(t.ctx, { locationId: t.locationId, typeId: typeId(key), name });
  }
}

describe("dental setup pack", () => {
  it("first apply builds and publishes everything, the second changes nothing", async () => {
    const t = await makeClinic();
    await applyDentalSetup(t.ctx, { parts: ["resourceTypes"] });
    await addTeam(t);

    const first = await applyDentalSetup(t.ctx);
    // The resource types came from the first call; every other part is new.
    expect(first.created).toEqual({ ...TOTALS, resourceTypes: 0 });
    expect(first.skipped).toEqual({ ...NONE, resourceTypes: TOTALS.resourceTypes });
    expect(first.warnings).toEqual([]);

    const db = await withTenantTx(t.tenantId, async (tx) => ({
      services: await tx.selectFrom("service").select(["slug", "status", "current_version", "location_id"]).where("tenant_id", "=", t.tenantId).execute(),
      versions: await tx.selectFrom("service_version").select(["service_id", "needs", "price_minor", "currency", "policy"]).where("tenant_id", "=", t.tenantId).execute(),
      forms: await tx.selectFrom("form").select(["slug", "purpose", "status", "current_version"]).where("tenant_id", "=", t.tenantId).execute(),
      pages: await tx.selectFrom("page").select(["id", "slug", "status", "current_version"]).where("tenant_id", "=", t.tenantId).execute(),
      site: await tx.selectFrom("site").select("settings").where("tenant_id", "=", t.tenantId).executeTakeFirst(),
      tenant: await tx.selectFrom("tenant").select("settings").where("id", "=", t.tenantId).executeTakeFirstOrThrow(),
    }));

    // Services: all six published, with the cleaning visit split into segments.
    expect(db.services).toHaveLength(SERVICES_PACK.length);
    expect(db.services.every((s) => s.status === "active" && s.current_version === 1 && s.location_id === t.locationId)).toBe(true);
    expect(db.versions.every((v) => v.currency === "USD" && v.price_minor !== null)).toBe(true);
    const cleaning = await withTenantTx(t.tenantId, (tx) =>
      tx
        .selectFrom("service_version")
        .innerJoin("service", (j) => j.onRef("service.tenant_id", "=", "service_version.tenant_id").onRef("service.id", "=", "service_version.service_id"))
        .select("service_version.needs as needs")
        .where("service.tenant_id", "=", t.tenantId)
        .where("service.slug", "=", "cleaning-and-check-up")
        .executeTakeFirstOrThrow(),
    );
    const needs = cleaning.needs as { key: string; offsetMin: number; lengthMin: number | null }[];
    expect(needs.find((n) => n.key === "hygienist")).toMatchObject({ offsetMin: 0, lengthMin: null });
    expect(needs.find((n) => n.key === "dentist")).toMatchObject({ offsetMin: 45, lengthMin: 15 });
    expect(needs.find((n) => n.key === "operatory")).toMatchObject({ bufferAfterMin: 10 });
    const emergency = db.versions.filter((v) => (v.policy as { noticeMin?: number }).noticeMin === 0);
    expect(emergency).toHaveLength(1);

    // Forms: both published; the intake form has the intake purpose the history import needs.
    expect(db.forms.map((f) => f.slug).sort()).toEqual(FORMS_PACK.map((f) => f.slug).sort());
    expect(db.forms.every((f) => f.status === "published" && f.current_version === 1)).toBe(true);
    expect(db.forms.find((f) => f.slug === INTAKE_FORM.slug)?.purpose).toBe("intake");
    // The online booking form is a booking form and the site's booking form, so /book works right after setup.
    expect(db.forms.find((f) => f.slug === BOOKING_FORM_SLUG)?.purpose).toBe("booking");
    expect((db.site?.settings as { bookingFormSlug?: string }).bookingFormSlug).toBe(BOOKING_FORM_SLUG);

    // Consent per service: the exam asks for the intake form; filling, root canal and whitening for the consent form.
    const consent = await getConsentForms(t.tenantId);
    const bySlug = await withTenantTx(t.tenantId, (tx) => tx.selectFrom("service").select(["id", "slug"]).where("tenant_id", "=", t.tenantId).execute());
    const formFor = (serviceSlug: string): string | undefined => consent[bySlug.find((s) => s.slug === serviceSlug)?.id ?? ""];
    expect(formFor("new-patient-exam")).toBe("new-patient-intake");
    expect(formFor("filling")).toBe("consent-to-treatment");
    expect(formFor("root-canal-visit")).toBe("consent-to-treatment");
    expect(formFor("whitening")).toBe("consent-to-treatment");
    expect(formFor("emergency-visit")).toBeUndefined();

    // Procedures are linked to services and priced in the business currency; the recall rule points at the cleaning.
    const procedures = await listProcedures(t.ctx);
    expect(procedures).toHaveLength(PROCEDURES_PACK.length);
    expect(procedures.every((p) => p.serviceId !== null && p.currency === "USD")).toBe(true);
    expect(new Set(procedures.map((p) => p.category))).toEqual(new Set(["Diagnostic", "Preventive", "Restorative", "Endodontics", "Cosmetic", "Emergency"]));
    const rules = await listRecallRules(t.tenantId);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ name: "Cleaning every 6 months", intervalMonths: 6, leadDays: 14, serviceName: "Cleaning and check-up" });

    // Pages: both published, the Home page is the site's home page; the vocabulary is set.
    expect(db.pages.every((p) => p.status === "published" && p.current_version === 1)).toBe(true);
    const home = db.pages.find((p) => p.slug === "home");
    expect((db.site?.settings as { homePageId?: string }).homePageId).toBe(home?.id);
    expect((db.tenant.settings as { vocabulary?: Record<string, string> }).vocabulary).toEqual(VOCABULARY_PACK);

    // Status: every part complete.
    const status = await getDentalSetupStatus(t.ctx);
    expect(status.parts.map((p) => p.part)).toEqual([...SETUP_PARTS]);
    expect(status.parts.every((p) => p.present === p.total && p.total > 0)).toBe(true);

    // Second apply: nothing created, everything skipped, no warnings.
    const siteBefore = await getSite(t.tenantId);
    const second = await applyDentalSetup(t.ctx);
    expect(second.created).toEqual(NONE);
    expect(second.skipped).toEqual(TOTALS);
    expect(second.warnings).toEqual([]);
    expect(await getSite(t.tenantId)).toEqual(siteBefore);
    const counts = await withTenantTx(t.tenantId, async (tx) => ({
      services: (await tx.selectFrom("service").select(sql<number>`count(*)::int`.as("n")).where("tenant_id", "=", t.tenantId).executeTakeFirstOrThrow()).n,
      versions: (await tx.selectFrom("service_version").select(sql<number>`count(*)::int`.as("n")).where("tenant_id", "=", t.tenantId).executeTakeFirstOrThrow()).n,
    }));
    expect(counts).toEqual({ services: SERVICES_PACK.length, versions: SERVICES_PACK.length });
  });

  it("keeps what the owner edited: a renamed service is not made again, a removed consent link is not put back", async () => {
    const t = await makeClinic();
    await applyDentalSetup(t.ctx, { parts: ["resourceTypes"] });
    await addTeam(t);
    await applyDentalSetup(t.ctx);

    await withTenantTx(t.tenantId, async (tx) => {
      await tx.updateTable("service").set({ name: "Dental filling" }).where("tenant_id", "=", t.tenantId).where("slug", "=", "filling").execute();
      await dentalDb(tx).updateTable("plg_dental_procedure").set({ default_price_minor: 12345 }).where("tenant_id", "=", t.tenantId).where("code", "=", "FILL-1").execute();
      await tx.updateTable("plugin_setting").set({ settings: JSON.stringify({ consentForms: {} }) }).where("tenant_id", "=", t.tenantId).execute();
    });
    const again = await applyDentalSetup(t.ctx);
    expect(again.created).toEqual(NONE);
    expect(await getConsentForms(t.tenantId)).toEqual({});
    const fill = (await listProcedures(t.ctx)).find((p) => p.code === "FILL-1");
    expect(fill?.defaultPriceMinor).toBe(12345);
  });

  it("adds services as drafts while the team is missing and publishes them on the next run", async () => {
    const t = await makeClinic();
    const first = await applyDentalSetup(t.ctx);
    expect(first.created.services).toBe(SERVICES_PACK.length);
    expect(first.created.resourceTypes).toBe(RESOURCE_TYPES_PACK.length);
    expect(first.warnings).toHaveLength(SERVICES_PACK.length);
    const drafts = await withTenantTx(t.tenantId, (tx) => tx.selectFrom("service").select(["status", "current_version"]).where("tenant_id", "=", t.tenantId).execute());
    expect(drafts.every((s) => s.status === "draft" && s.current_version === null)).toBe(true);
    expect((await getDentalSetupStatus(t.ctx)).parts.find((p) => p.part === "services")?.present).toBe(0);

    await addTeam(t);
    const second = await applyDentalSetup(t.ctx);
    expect(second.created.services).toBe(SERVICES_PACK.length);
    expect(second.warnings).toEqual([]);
    const live = await withTenantTx(t.tenantId, (tx) => tx.selectFrom("service").select(["status", "current_version"]).where("tenant_id", "=", t.tenantId).execute());
    expect(live.every((s) => s.status === "active" && s.current_version === 1)).toBe(true);
    expect(Object.keys(await getConsentForms(t.tenantId))).toHaveLength(SERVICES_PACK.filter((s) => s.form).length);
  });

  it("fits the dev seed: every service can be booked, and the demo history, recall entry and draft plan can be made", async () => {
    const t = await makeClinic();
    await publishSchedule.run(t.ctx, {
      locationId: t.locationId,
      effectiveFrom: "2020-01-01",
      rules: ([1, 2, 3, 4, 5, 6, 7] as const).map((day) => ({ day, ranges: [{ start: "09:00", end: "17:00" }] })),
    });
    await applyDentalSetup(t.ctx, { parts: ["resourceTypes"] });
    await addTeam(t);
    await applyDentalSetup(t.ctx);

    const services = await withTenantTx(t.tenantId, (tx) => tx.selectFrom("service").select(["id", "slug"]).where("tenant_id", "=", t.tenantId).execute());
    for (const [index, service] of services.entries()) {
      const day = new Date(Date.now() + (index + 2) * 86_400_000).toISOString().slice(0, 10);
      await createBooking.run(t.ctx, {
        locationId: t.locationId,
        items: [{ serviceId: service.id }],
        start: `${day}T10:00:00.000Z`,
        customer: { displayName: `Patient ${index}`, email: `patient${index}@example.com` },
        source: "admin",
      });
    }

    const alertPatient = (await createCustomer.run(t.ctx, { displayName: "Noah Becker", email: "noah@example.com" })).id;
    const saved = await saveHistory(t.ctx, {
      customerId: alertPatient,
      expectedVersion: 0,
      document: { allergies: { penicillin: true }, medications: ["Vitamin D"] },
      markReviewed: true,
    });
    expect(saved.hasAlerts).toBe(true);

    const recallPatient = (await createCustomer.run(t.ctx, { displayName: "Aisha Khan", email: "aisha@example.com" })).id;
    await withTenantTx(t.tenantId, async (tx) => {
      const rule = await dentalDb(tx).selectFrom("plg_dental_recall_rule").select("id").where("tenant_id", "=", t.tenantId).where("name", "=", "Cleaning every 6 months").executeTakeFirstOrThrow();
      await sql`
        insert into plg_dental_recall (tenant_id, customer_id, rule_id, due_on, last_visit_at, status)
        values (${t.tenantId}, ${recallPatient}, ${rule.id}, current_date + 14, now() - interval '166 days', 'upcoming')`.execute(tx);
    });
    expect((await listRecalls(t.tenantId)).rows).toHaveLength(1);

    const planPatient = (await createCustomer.run(t.ctx, { displayName: "Tom Fischer", email: "tom@example.com" })).id;
    const procedures = new Map((await listProcedures(t.ctx)).map((p) => [p.code, p.id]));
    const plan = await createPlan.run(t.ctx, {
      customerId: planPatient,
      title: "Lower left restoration",
      items: [
        { procedureId: procedures.get("FILL-2"), tooth: "36", surfaces: ["O", "D"], minGapDays: 0 },
        { procedureId: procedures.get("FILL-1"), tooth: "37", surfaces: ["O"], minGapDays: 7 },
      ],
    });
    expect(plan.status).toBe("draft");
  });

  it("does not take over the booking form of a site that chose one, and does not put back one that was cleared", async () => {
    const t = await makeClinic();
    const own = await createForm.run(t.ctx, { name: "Our booking form", purpose: "booking", slug: "our-booking", draft: { name: "Our booking form" } });
    await publishForm.run(t.ctx, { id: own.id, expectedVersion: own.version });
    await updateSite.run(t.ctx, { expectedVersion: (await getSite(t.tenantId)).version, bookingFormSlug: "our-booking" });

    const first = await applyDentalSetup(t.ctx, { parts: ["forms"] });
    expect(first.created.forms).toBe(FORMS_PACK.length);
    expect((await getSite(t.tenantId)).settings.bookingFormSlug).toBe("our-booking");

    // The owner clears the choice ("the first booking form"): a later run does not choose the pack's form again.
    await updateSite.run(t.ctx, { expectedVersion: (await getSite(t.tenantId)).version, bookingFormSlug: "" });
    const again = await applyDentalSetup(t.ctx, { parts: ["forms"] });
    expect(again.created.forms).toBe(0);
    expect((await getSite(t.tenantId)).settings.bookingFormSlug).toBeUndefined();
  });

  it("does not take over the home page of a site that has one", async () => {
    const t = await makeClinic();
    const own = await createPage.run(t.ctx, { title: "Welcome", slug: "welcome" });
    await publishPage.run(t.ctx, { id: own.id, expectedVersion: own.version });
    await setHomePage.run(t.ctx, { id: own.id });
    const result = await applyDentalSetup(t.ctx, { parts: ["pages"] });
    expect(result.created.pages).toBe(PAGES_PACK.length);
    const site = await withTenantTx(t.tenantId, (tx) => tx.selectFrom("site").select("settings").where("tenant_id", "=", t.tenantId).executeTakeFirstOrThrow());
    expect((site.settings as { homePageId?: string }).homePageId).toBe(own.id);
  });
});

describe("intake form and the medical history import", () => {
  const fields = INTAKE_FORM.content.fields as IntakeField[];
  const SAMPLE: Record<string, unknown> = {
    name: "Ann Lee",
    date_of_birth: "1990-05-01",
    email: "ann@example.com",
    phone: "+12025550100",
    address: "1 Main Street",
    visit_reason: "Check-up",
    conditions: ["Diabetes", "Asthma"],
    allergies: ["Penicillin"],
    other_allergies: "Peanuts",
    medications: "Metformin, Vitamin D",
    blood_thinners: "Yes",
    bisphosphonates: "Yes",
    pregnant: "Yes",
    pregnancy_weeks: "12",
    smoker: "Yes",
    dental_history: "A crown on a back tooth",
    health_notes: "Nervous about needles",
    emergency_name: "Bo Lee",
    emergency_phone: "+12025550101",
    confirm_true: true,
  };

  it("every field key is known to the intake mapping and has a sample answer", () => {
    expect(fields.map((f) => f.id).sort()).toEqual(Object.keys(INTAKE_FIELD_SECTIONS).sort());
    expect(Object.keys(SAMPLE).sort()).toEqual(Object.keys(INTAKE_FIELD_SECTIONS).sort());
    expect(new Set(fields.map((f) => f.id)).size).toBe(fields.length);
  });

  it.each(Object.entries(INTAKE_FIELD_SECTIONS))("%s lands in %s", (id, section) => {
    const imported = mapIntakeAnswers(fields, { [id]: SAMPLE[id] });
    if (section === "skip") {
      expect(imported.mappedSections).toEqual([]);
      expect(imported.unmapped).toBe(0);
    } else {
      expect(imported.mappedSections).toContain(section);
    }
  });

  it("the sample answers fill the history document", () => {
    const { document } = mapIntakeAnswers(fields, SAMPLE);
    expect(document.conditions).toMatchObject({ diabetes: true, asthma: true });
    expect(document.allergies).toMatchObject({ penicillin: true, other: "Peanuts" });
    expect(document.medications).toEqual(["Metformin", "Vitamin D"]);
    expect(document).toMatchObject({ anticoagulants: true, bisphosphonates: true, smoker: true, previousDentalIssues: "A crown on a back tooth" });
    expect(document.pregnancy).toEqual({ pregnant: true, weeks: 12 });
  });

  it("contains no clinical text in what a message could carry", () => {
    // The forms send no automatic email and the thank-you text is generic.
    for (const form of FORMS_PACK) {
      const after = form.content.after as { auto: boolean; body: string; thanks: string };
      expect(after.auto).toBe(false);
      expect(after.body).toBe("");
      expect(form.content.autos).toEqual([]);
      expect(after.thanks).toBe(form.slug === BOOKING_FORM.slug ? BOOKING_THANKS : FORM_THANKS);
    }
  });
});
