// Integration test of the demo clinic. The test builds its business with core's own commands, which a plugin never
// imports, so these imports reach into the repo by path.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getTenant, withTenantTx } from "@appointit/plugin-sdk/server";
import type { CommandContext } from "@appointit/plugin-sdk/server";
import { createTenant } from "../../../booking-and-cms/packages/testing/src";
import { generateKeyring } from "../../../booking-and-cms/packages/core/src/kernel";
import { createLocation } from "../../../booking-and-cms/packages/core/src/tenancy";
import { dentalDb } from "../server/db-types";
import { listRecalls } from "../server/plans";
import { applyDentalSetup, SERVICES_PACK } from "./index";
import { applyDentalDemo, DEMO_CLINIC_NAME } from "./demo";

beforeAll(() => {
  vi.stubEnv("APP_ENCRYPTION_KEYS", generateKeyring("k1")); // the medical history is stored encrypted
});

afterAll(async () => {
  await closeDb();
});

describe("the dental demo clinic", () => {
  it("builds on the setup pack: renamed business, team, published services, bookings, and the three demo patients", async () => {
    const tenantId = await createTenant({ name: "Demo business" });
    const ctx: CommandContext = { tenantId, actor: { type: "system" } };
    const location = await createLocation.run(ctx, { name: "Main", timeZone: "America/New_York", currency: "USD", policy: { noticeMin: 0, horizonDays: 365 } });
    // What choosing the business type does first: no team exists yet, so the services start as drafts.
    await applyDentalSetup(ctx);

    await applyDentalDemo(ctx, { locationId: location.id, resources: {} });

    expect((await getTenant(tenantId)).name).toBe(DEMO_CLINIC_NAME);
    const counts = await withTenantTx(tenantId, async (tx) => {
      const count = async (table: "resource" | "booking" | "customer") =>
        Number((await tx.selectFrom(table).select((eb) => eb.fn.countAll<string>().as("n")).where("tenant_id", "=", tenantId).executeTakeFirstOrThrow()).n);
      const services = await tx.selectFrom("service").select("current_version").where("tenant_id", "=", tenantId).execute();
      const alerts = await dentalDb(tx).selectFrom("plg_dental_medical_history").select("has_alerts").where("tenant_id", "=", tenantId).execute();
      const plans = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").select(["title", "status"]).where("tenant_id", "=", tenantId).execute();
      return { resources: await count("resource"), bookings: await count("booking"), customers: await count("customer"), services, alerts, plans };
    });
    expect(counts.resources).toBe(10);
    expect(counts.bookings).toBe(5);
    expect(counts.customers).toBe(8);
    expect(counts.services).toHaveLength(SERVICES_PACK.length);
    expect(counts.services.every((service) => service.current_version !== null)).toBe(true);
    expect(counts.alerts).toEqual([{ has_alerts: true }]);
    expect(counts.plans).toEqual([{ title: "Lower left restoration", status: "draft" }]);
    expect((await listRecalls(tenantId)).rows).toHaveLength(1);
  });
});
