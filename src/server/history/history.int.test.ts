import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, closeDb, encryptField, isEncrypted, sql, withPlatformTx, withTenantTx } from "@appointit/plugin-sdk/server";
import type { CommandContext } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../db-types";
import {
  createInsurance,
  getConsentStatus,
  getHistory,
  importFromSubmission,
  listAlerts,
  listInsurance,
  saveHistory,
  setConsentForms,
  updateInsurance,
} from "./index";
import { emptyHistory } from "./schema";

process.env.APP_ENCRYPTION_KEYS ??= `k1:${Buffer.alloc(32, 7).toString("base64")}`;

afterAll(async () => {
  await closeDb();
});

const doctor = (tenantId: string): CommandContext => ({
  tenantId,
  actor: { type: "user", id: "user-doctor" },
  permissions: new Set(["health.read", "health.manage", "bookings.read", "plugins.manage"]),
});
const receptionist = (tenantId: string): CommandContext => ({
  tenantId,
  actor: { type: "user", id: "user-reception" },
  permissions: new Set(["bookings.read"]),
});

let tenantId = "";
let customerId = "";

async function newTenant(): Promise<string> {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const row = await withPlatformTx((tx) => tx.insertInto("tenant").values({ slug, name: slug }).returning("id").executeTakeFirstOrThrow());
  return row.id;
}

async function newCustomer(tenant: string, name = "Test Patient"): Promise<string> {
  return withTenantTx(tenant, async (tx) => {
    const row = await tx.insertInto("customer").values({ tenant_id: tenant, display_name: name }).returning("id").executeTakeFirstOrThrow();
    return row.id;
  });
}

const auditCount = (tenant: string, action: string, target: string) =>
  withTenantTx(tenant, async (tx) => {
    const r = await tx
      .selectFrom("audit_event")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("tenant_id", "=", tenant)
      .where("action", "=", action)
      .where("target_id", "=", target)
      .executeTakeFirstOrThrow();
    return r.n;
  });

beforeAll(async () => {
  tenantId = await newTenant();
  customerId = await newCustomer(tenantId);
});

describe("dental medical history", () => {
  it("stores only ciphertext, audits reads, hides labels from callers without health.read", async () => {
    const doc = emptyHistory();
    doc.allergies.penicillin = true;
    doc.allergies.other = "Sulfa drugs";
    doc.anticoagulants = true;
    doc.medications = ["Warfarin 5mg"];
    doc.notes = "Anxious patient";

    const saved = await saveHistory(doctor(tenantId), { customerId, expectedVersion: 0, document: doc });
    expect(saved.version).toBe(1);
    expect(saved.hasAlerts).toBe(true);
    expect(saved.reviewedAt).toBeNull();

    // The stored row has no plaintext anywhere.
    const stored = await withTenantTx(tenantId, (tx) =>
      dentalDb(tx).selectFrom("plg_dental_medical_history").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "=", customerId).executeTakeFirstOrThrow(),
    );
    const raw = JSON.stringify(stored).toLowerCase();
    for (const secret of ["penicillin", "warfarin", "sulfa", "anxious", "anticoagulant"]) expect(raw).not.toContain(secret);
    expect(isEncrypted(stored.data_enc)).toBe(true);
    expect(isEncrypted(stored.alerts_enc)).toBe(true);
    expect(stored.has_alerts).toBe(true);

    // The save audit row names sections, never values.
    const saveAudit = await withTenantTx(tenantId, (tx) =>
      tx.selectFrom("audit_event").select(["changes", "actor_id"]).where("tenant_id", "=", tenantId).where("action", "=", "dental.history.save").executeTakeFirstOrThrow(),
    );
    expect(JSON.stringify(saveAudit.changes).toLowerCase()).not.toContain("penicillin");
    expect((saveAudit.changes as { fields: string[] }).fields).toEqual(["allergies", "anticoagulants", "medications", "notes"]);
    expect(saveAudit.actor_id).toBe("user-doctor");

    // getHistory decrypts and writes a health.read audit row on the patient.
    const before = await auditCount(tenantId, "health.read", customerId);
    const read = await getHistory(doctor(tenantId), customerId);
    expect(read.document.allergies.penicillin).toBe(true);
    expect(read.document.medications).toEqual(["Warfarin 5mg"]);
    expect(read.alerts.map((a) => a.label)).toEqual(["Allergy: penicillin", "Allergy: Sulfa drugs", "Takes anticoagulants"]);
    expect(read.reviewDue).toBe(true);
    expect(await auditCount(tenantId, "health.read", customerId)).toBe(before + 1);

    // A caller without health.read cannot read the history at all.
    await expect(getHistory(receptionist(tenantId), customerId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // listAlerts: without health.read only the boolean; nothing decrypted, nothing audited.
    const other = await newCustomer(tenantId, "No Alerts");
    const readsBefore = await auditCount(tenantId, "health.read", customerId);
    const plain = await listAlerts(receptionist(tenantId), [customerId, other]);
    // Plus the review dates: a first record is due at once, a patient with no record is flagged as missing.
    expect(plain).toEqual([
      { customerId, hasAlerts: true, historyMissing: false, reviewDueAt: expect.any(String) },
      { customerId: other, hasAlerts: false, historyMissing: true, reviewDueAt: null },
    ]);
    expect(JSON.stringify(plain).toLowerCase()).not.toContain("penicillin");
    expect(await auditCount(tenantId, "health.read", customerId)).toBe(readsBefore);

    // With health.read the labels come back and the decrypt is logged.
    const full = await listAlerts(doctor(tenantId), [customerId, other]);
    expect(full[0]).toEqual({
      customerId,
      hasAlerts: true,
      labels: ["Allergy: penicillin", "Allergy: Sulfa drugs", "Takes anticoagulants"],
      historyMissing: false,
      reviewDueAt: expect.any(String),
    });
    expect(full[1]).toEqual({ customerId: other, hasAlerts: false, historyMissing: true, reviewDueAt: null });
    expect(await auditCount(tenantId, "health.read", customerId)).toBe(readsBefore + 1);
  });

  it("checks permission and version on save, and marks a review", async () => {
    const c = await newCustomer(tenantId, "Version Patient");
    await expect(saveHistory(receptionist(tenantId), { customerId: c, expectedVersion: 0, document: emptyHistory() })).rejects.toBeInstanceOf(AppError);
    const first = await saveHistory(doctor(tenantId), { customerId: c, expectedVersion: 0, document: emptyHistory() });
    expect(first.version).toBe(1);
    expect(first.hasAlerts).toBe(false);
    await expect(saveHistory(doctor(tenantId), { customerId: c, expectedVersion: 0, document: emptyHistory() })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      details: { currentVersion: 1 },
    });
    const reviewed = await saveHistory(doctor(tenantId), { customerId: c, expectedVersion: 1, document: emptyHistory(), markReviewed: true });
    expect(reviewed.version).toBe(2);
    expect(reviewed.reviewedAt).not.toBeNull();
    const due = new Date(reviewed.reviewDueAt as string).getTime();
    expect(due).toBeGreaterThan(Date.now() + 360 * 24 * 3600 * 1000);
    expect((await getHistory(doctor(tenantId), c)).reviewDue).toBe(false);
  });

  it("imports an intake form answer into the history", async () => {
    const c = await newCustomer(tenantId, "Intake Patient");
    const formId = randomUUID();
    const submissionId = await withTenantTx(tenantId, async (tx) => {
      await tx
        .insertInto("form")
        .values({ tenant_id: tenantId, id: formId, slug: `intake-${formId.slice(0, 6)}`, name: "New patient intake", purpose: "intake", status: "published", current_version: 1 })
        .execute();
      await tx
        .insertInto("form_version")
        .values({
          tenant_id: tenantId,
          form_id: formId,
          version: 1,
          schema_version: 1,
          doc: JSON.stringify({
            fields: [
              { id: "q1", type: "long", label: "Do you have any allergies?" },
              { id: "q2", type: "yesno", label: "Do you have diabetes?" },
              { id: "q3", type: "long", label: "Medications you take" },
              { id: "q4", type: "short", label: "Favourite colour" },
              { id: "q5", type: "yesno", label: "Are you pregnant?" },
            ],
          }),
        })
        .execute();
      // Intake answers are stored encrypted, bound to the submission id (as submitForm does).
      const subId = randomUUID();
      const sub = await tx
        .insertInto("form_submission")
        .values({
          tenant_id: tenantId,
          id: subId,
          form_id: formId,
          form_version: 1,
          status: "complete",
          customer_id: c,
          answers: "{}",
          answers_enc: encryptField(JSON.stringify({ q1: "Penicillin and latex", q2: "Yes", q3: "Metformin, Ramipril", q4: "Blue", q5: "No" }), {
            tenantId,
            field: `form_submission.answers:${subId}`,
          }),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return sub.id;
    });

    const readsBefore = await auditCount(tenantId, "health.read", submissionId);
    const result = await importFromSubmission(doctor(tenantId), { customerId: c, submissionId });
    // Opening the encrypted answers is a logged health read.
    expect(await auditCount(tenantId, "health.read", submissionId)).toBe(readsBefore + 1);
    expect(result.importedSections).toEqual(expect.arrayContaining(["allergies", "conditions", "medications", "notes"]));
    expect(result.unmapped).toBe(1);
    const doc = (await getHistory(doctor(tenantId), c)).document;
    expect(doc.allergies.penicillin).toBe(true);
    expect(doc.allergies.latex).toBe(true);
    expect(doc.conditions.diabetes).toBe(true);
    expect(doc.pregnancy.pregnant).toBe(false);
    expect(doc.medications).toEqual(["Metformin", "Ramipril"]);
    expect(doc.notes).toContain("Favourite colour: Blue");

    // Another patient's submission is refused.
    const stranger = await newCustomer(tenantId, "Stranger");
    await expect(importFromSubmission(doctor(tenantId), { customerId: stranger, submissionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("dental insurance", () => {
  it("encrypts the member id, logs reads and keeps one primary policy", async () => {
    const c = await newCustomer(tenantId, "Insured Patient");
    const a = await createInsurance(doctor(tenantId), { customerId: c, carrier: "Delta Dental", memberId: "MEMBER-12345", groupNumber: "G-7", validTo: "2030-12-31" });
    const stored = await withTenantTx(tenantId, (tx) =>
      dentalDb(tx).selectFrom("plg_dental_insurance").selectAll().where("tenant_id", "=", tenantId).where("id", "=", a.id).executeTakeFirstOrThrow(),
    );
    expect(JSON.stringify(stored)).not.toContain("MEMBER-12345");
    expect(isEncrypted(stored.member_id_enc)).toBe(true);
    expect(stored.is_primary).toBe(true);

    const b = await createInsurance(doctor(tenantId), { customerId: c, carrier: "Cigna", memberId: "C-999", isPrimary: true });
    const reads = await auditCount(tenantId, "health.read", c);
    const list = await listInsurance(doctor(tenantId), c);
    expect(await auditCount(tenantId, "health.read", c)).toBe(reads + 1);
    expect(list.map((p) => [p.carrier, p.isPrimary, p.memberId])).toEqual([
      ["Cigna", true, "C-999"],
      ["Delta Dental", false, "MEMBER-12345"],
    ]);
    expect(list[1]?.validTo).toBe("2030-12-31");

    await expect(listInsurance(receptionist(tenantId), c)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateInsurance(doctor(tenantId), { id: b.id, expectedVersion: 99, carrier: "X" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const upd = await updateInsurance(doctor(tenantId), { id: b.id, expectedVersion: b.version, memberId: null });
    expect(upd.version).toBe(b.version + 1);
    expect((await listInsurance(doctor(tenantId), c)).find((p) => p.id === b.id)?.memberId).toBeNull();
  });
});

describe("consent per procedure", () => {
  it("needs consent until a complete submission exists since the booking was made", async () => {
    const c = await newCustomer(tenantId, "Consent Patient");
    const ids = await withTenantTx(tenantId, async (tx) => {
      const formId = randomUUID();
      await tx.insertInto("form").values({ tenant_id: tenantId, id: formId, slug: "extraction-consent", name: "Extraction consent", purpose: "consent", status: "published", current_version: 1 }).execute();
      await tx.insertInto("form_version").values({ tenant_id: tenantId, form_id: formId, version: 1, schema_version: 1, doc: JSON.stringify({ fields: [] }) }).execute();
      const location = await tx.insertInto("location").values({ tenant_id: tenantId, name: "Main", time_zone: "UTC", currency: "USD" }).returning("id").executeTakeFirstOrThrow();
      const service = await tx.insertInto("service").values({ tenant_id: tenantId, name: "Extraction", slug: "extraction" }).returning("id").executeTakeFirstOrThrow();
      await tx.insertInto("service_version").values({ tenant_id: tenantId, service_id: service.id, version: 1, duration_min: 30, needs: JSON.stringify([]) }).execute();
      const booking = await tx
        .insertInto("booking")
        .values({
          tenant_id: tenantId,
          location_id: location.id,
          number: 1,
          customer_id: c,
          status: "confirmed",
          starts_at: new Date(Date.now() + 86_400_000),
          ends_at: new Date(Date.now() + 90_000_000),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("booking_item")
        .values({
          tenant_id: tenantId,
          booking_id: booking.id,
          service_id: service.id,
          service_version: 1,
          snapshot: JSON.stringify({}),
          starts_at: new Date(Date.now() + 86_400_000),
          ends_at: new Date(Date.now() + 90_000_000),
        })
        .execute();
      return { formId, serviceId: service.id, bookingId: booking.id };
    });

    // Nothing mapped yet.
    expect((await getConsentStatus(receptionist(tenantId), ids.bookingId)).needed).toBe(false);
    await setConsentForms(doctor(tenantId), { [ids.serviceId]: "extraction-consent" });
    const before = await getConsentStatus(receptionist(tenantId), ids.bookingId);
    expect(before.needed).toBe(true);
    expect(before.forms[0]).toMatchObject({ slug: "extraction-consent", signed: false, link: `/f/extraction-consent?customer=${c}` });

    await withTenantTx(tenantId, (tx) =>
      tx.insertInto("form_submission").values({ tenant_id: tenantId, form_id: ids.formId, form_version: 1, status: "complete", customer_id: c, answers: JSON.stringify({}) }).execute(),
    );
    const after = await getConsentStatus(receptionist(tenantId), ids.bookingId);
    expect(after.needed).toBe(false);
    expect(after.forms[0]?.signed).toBe(true);
    await expect(setConsentForms(doctor(tenantId), { [ids.serviceId]: "no-such-form" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
