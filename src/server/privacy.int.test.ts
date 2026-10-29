import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, encryptField, openExport, processPrivacyRequest, sql, withPlatformTx, withTenantTx } from "@appointit/plugin-sdk/server";
import type { CommandContext } from "@appointit/plugin-sdk/server";
import { dentalDb } from "./db-types";
import { addEntry } from "./chart";
import { createInsurance, saveHistory } from "./history";
import { emptyHistory } from "./history/schema";
import { registerPrivacy } from "./privacy";

process.env.APP_ENCRYPTION_KEYS ??= `k1:${Buffer.alloc(32, 5).toString("base64")}`;

let dir = "";
let tenantId = "";
let customerId = "";
let orderId = "";
let paymentId = "";

const doctor = (): CommandContext => ({
  tenantId,
  actor: { type: "user", id: "privacy-doctor" },
  permissions: new Set(["health.read", "health.manage", "settings.manage"]),
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dental-privacy-"));
  process.env.FILES_DIR = dir;
  // Plugins are installed by the app at startup; this test registers the handler itself.
  registerPrivacy({} as never);
  await withPlatformTx(async (tx) => {
    const tenant = await tx.insertInto("tenant").values({ slug: `dental-privacy-${randomUUID().slice(0, 8)}`, name: "Privacy Dental" }).returning("id").executeTakeFirstOrThrow();
    tenantId = tenant.id;
  });
  await withTenantTx(tenantId, async (tx) => {
    const customer = await tx.insertInto("customer").values({ tenant_id: tenantId, display_name: "Dana Dental", email: "dana@privacy.example.test" }).returning("id").executeTakeFirstOrThrow();
    customerId = customer.id;
    const order = await tx
      .insertInto("sales_order")
      .values({ tenant_id: tenantId, number: 1, customer_id: customerId, status: "paid", currency: "EUR", subtotal_minor: "12000", total_minor: "12000", paid_minor: "12000" })
      .returning("id")
      .executeTakeFirstOrThrow();
    orderId = order.id;
    const payment = await tx
      .insertInto("payment")
      .values({ tenant_id: tenantId, order_id: orderId, provider: "manual", provider_ref: `ref-${randomUUID()}`, method: "card", captured_minor: "12000", currency: "EUR" })
      .returning("id")
      .executeTakeFirstOrThrow();
    paymentId = payment.id;
  });
});

afterAll(async () => {
  await closeDb();
  await rm(dir, { recursive: true, force: true });
});

describe("dental privacy handler", () => {
  it("exports the decrypted dental data, then erasure removes it all and keeps the payment", async () => {
    const history = emptyHistory();
    history.allergies.penicillin = true;
    history.notes = "Afraid of needles";
    await saveHistory(doctor(), { customerId, expectedVersion: 0, document: history });
    await createInsurance(doctor(), { customerId, carrier: "Delta Dental", memberId: "MEMBER-4711" });
    const entry = await addEntry.run(doctor(), { customerId, tooth: "16", kind: "condition", condition: "caries", notes: "Sensitive to cold" });
    await withTenantTx(tenantId, (tx) =>
      dentalDb(tx)
        .insertInto("plg_dental_treatment_plan")
        .values({
          tenant_id: tenantId,
          customer_id: customerId,
          title: "Crown",
          notes_enc: encryptField("Needs sedation", { tenantId, field: "plg_dental_treatment_plan.notes" }),
        })
        .execute(),
    );

    // Export: every dental section is there, decrypted.
    const exportRequest = await withTenantTx(tenantId, (tx) =>
      tx.insertInto("privacy_request").values({ tenant_id: tenantId, customer_id: customerId, kind: "export", source: "admin" }).returning("id").executeTakeFirstOrThrow(),
    );
    await processPrivacyRequest(tenantId, exportRequest.id);
    const exported = JSON.parse((await openExport(doctor(), exportRequest.id, { by: "staff" })).json) as { plugins: { dental: Record<string, unknown[]> } };
    const dental = exported.plugins.dental;
    expect(dental.medicalHistory).toMatchObject([{ customerId, document: { notes: "Afraid of needles", allergies: { penicillin: true } } }]);
    expect(dental.insurance).toMatchObject([{ carrier: "Delta Dental", memberId: "MEMBER-4711" }]);
    expect(dental.chart).toMatchObject([{ tooth: "16", condition: "caries", notes: "Sensitive to cold" }]);
    expect(dental.treatmentPlans).toMatchObject([{ title: "Crown", notes: "Needs sedation" }]);
    const reads = await withTenantTx(tenantId, (tx) =>
      tx
        .selectFrom("audit_event")
        .select(sql<number>`count(*)::int`.as("n"))
        .where("tenant_id", "=", tenantId)
        .where("action", "=", "health.read")
        .where("actor_type", "=", "system")
        .where("target_id", "=", customerId)
        .executeTakeFirstOrThrow(),
    );
    expect(reads.n).toBeGreaterThanOrEqual(3);

    // Erasure (already approved): the dental data is gone, the patient is anonymous, the payment stays.
    const eraseRequest = await withTenantTx(tenantId, (tx) =>
      tx
        .insertInto("privacy_request")
        .values({ tenant_id: tenantId, customer_id: customerId, kind: "erase", status: "in_progress", approved_by: "privacy-doctor", approved_at: new Date() })
        .returning("id")
        .executeTakeFirstOrThrow(),
    );
    await processPrivacyRequest(tenantId, eraseRequest.id);
    const after = await withTenantTx(tenantId, async (tx) => ({
      customer: await tx.selectFrom("customer").select(["display_name", "email"]).where("tenant_id", "=", tenantId).where("id", "=", customerId).executeTakeFirstOrThrow(),
      history: await dentalDb(tx).selectFrom("plg_dental_medical_history").select("customer_id").where("tenant_id", "=", tenantId).execute(),
      insurance: await dentalDb(tx).selectFrom("plg_dental_insurance").select("id").where("tenant_id", "=", tenantId).execute(),
      chart: await dentalDb(tx).selectFrom("plg_dental_chart_entry").select(["id", "notes_enc"]).where("tenant_id", "=", tenantId).execute(),
      plans: await dentalDb(tx).selectFrom("plg_dental_treatment_plan").select(["id", "notes_enc"]).where("tenant_id", "=", tenantId).execute(),
      payment: await tx.selectFrom("payment").select(["captured_minor", "order_id"]).where("tenant_id", "=", tenantId).where("id", "=", paymentId).execute(),
    }));
    expect(after.customer).toEqual({ display_name: "Erased patient", email: null });
    expect(after.history).toHaveLength(0);
    expect(after.insurance).toHaveLength(0);
    expect(after.chart).toEqual([{ id: entry.id, notes_enc: null }]);
    expect(after.plans.every((p) => p.notes_enc === null)).toBe(true);
    expect(after.payment).toEqual([{ captured_minor: "12000", order_id: orderId }]);
    // The earlier export file went with the patient.
    await expect(openExport(doctor(), exportRequest.id, { by: "staff" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
