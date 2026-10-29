import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, closeDb, isEncrypted, withPlatformTx } from "@appointit/plugin-sdk/server";
import type { CommandContext } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../db-types";
import {
  addEntry,
  archiveProcedure,
  chartHistory,
  chartToothNumbering,
  createProcedure,
  listChart,
  listProcedures,
  reorderProcedures,
  updateEntry,
  updateProcedure,
} from "./index";

process.env.APP_ENCRYPTION_KEYS ??= `chart:${randomBytes(32).toString("base64")}`;

// Everything here belongs to this file's own tenant (audit rows cannot be deleted, so it stays in the test database).
const SLUG = `dental-chart-${randomUUID().slice(0, 8)}`;
const SECRET_NOTE = "Anxious about the drill, ask for the numbing gel first";

let tenantId = "";
let customerId = "";

const ctxOf = (permissions: string[], requestId: string = randomUUID()): CommandContext => ({
  tenantId,
  actor: { type: "user", id: "chart-test-user" },
  permissions: new Set(permissions),
  requestId,
});
const doctor = (requestId?: string) => ctxOf(["health.read", "health.manage"], requestId);
const receptionist = () => ctxOf(["customers.read"]);
const viewer = () => ctxOf(["health.read"]);
const catalogManager = () => ctxOf(["services.manage"]);

async function healthReadCount(requestId?: string): Promise<number> {
  return withPlatformTx(async (tx) => {
    let query = tx
      .selectFrom("audit_event")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("action", "=", "health.read")
      .where("target_id", "=", customerId);
    if (requestId !== undefined) query = query.where("request_id", "=", requestId);
    return (await query.execute()).length;
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

beforeAll(async () => {
  await withPlatformTx(async (tx) => {
    const tenant = await tx.insertInto("tenant").values({ slug: SLUG, name: "Chart Test Dental" }).returning("id").executeTakeFirstOrThrow();
    tenantId = tenant.id;
    const customer = await tx
      .insertInto("customer")
      .values({ tenant_id: tenantId, display_name: "Chart Patient" })
      .returning("id")
      .executeTakeFirstOrThrow();
    customerId = customer.id;
  });
});

afterAll(async () => {
  await closeDb();
});

describe("dental chart", () => {
  let entryId = "";
  let entryVersion = 0;

  it("adds an entry and lists it with the notes decrypted; the notes are ciphertext in the database", async () => {
    const created = await addEntry.run(doctor(), {
      customerId,
      tooth: "16",
      surfaces: ["D", "o", "M"],
      kind: "condition",
      condition: "caries",
      notes: SECRET_NOTE,
    });
    expect(created).toMatchObject({ tooth: "16", surfaces: ["M", "O", "D"], kind: "condition", condition: "caries", status: "active", notes: SECRET_NOTE });
    entryId = created.id;
    entryVersion = created.version;

    const raw = await withPlatformTx((tx) =>
      dentalDb(tx).selectFrom("plg_dental_chart_entry").select(["notes_enc"]).where("tenant_id", "=", tenantId).where("id", "=", entryId).executeTakeFirstOrThrow(),
    );
    expect(isEncrypted(raw.notes_enc)).toBe(true);
    expect(raw.notes_enc).not.toContain("drill");

    const listed = await listChart(doctor(), customerId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: entryId, tooth: "16", notes: SECRET_NOTE, recordedBy: "chart-test-user" });
  });

  it("rewrites surface letters to the tooth's own and rejects bad input", async () => {
    const front = await addEntry.run(doctor(), { customerId, tooth: "11", surfaces: ["O", "B", "L"], kind: "existing", condition: "veneer" });
    expect(front.surfaces).toEqual(["I", "F", "P"]);
    await expectCode(addEntry.run(doctor(), { customerId, tooth: "19", kind: "condition", condition: "caries" }), "INVALID_INPUT");
    await expectCode(addEntry.run(doctor(), { customerId, tooth: "16", surfaces: ["X"], kind: "condition", condition: "caries" }), "INVALID_INPUT");
    await expectCode(addEntry.run(doctor(), { customerId, tooth: "16", kind: "condition" }), "INVALID_INPUT");
    await expectCode(addEntry.run(doctor(), { customerId, tooth: "16", kind: "condition", condition: "toothache" }), "INVALID_INPUT");
    await expectCode(addEntry.run(doctor(), { customerId: randomUUID(), tooth: "16", kind: "condition", condition: "caries" }), "NOT_FOUND");
  });

  it("writes a health.read audit event on read, once per request", async () => {
    const before = await healthReadCount();
    const requestId = randomUUID();
    await listChart(doctor(requestId), customerId);
    await chartHistory(doctor(requestId), customerId);
    expect(await healthReadCount(requestId)).toBe(1);
    expect(await healthReadCount()).toBe(before + 1);
    await listChart(doctor(), customerId);
    expect(await healthReadCount()).toBe(before + 2);
  });

  it("keeps notes out of the audit trail", async () => {
    const rows = await withPlatformTx((tx) =>
      tx.selectFrom("audit_event").select(["action", "changes"]).where("tenant_id", "=", tenantId).where("target_type", "=", "dental_chart_entry").execute(),
    );
    expect(rows.length).toBeGreaterThan(0);
    const all = JSON.stringify(rows);
    expect(all).not.toContain("drill");
    expect(all).toContain('"tooth":"16"');
  });

  it("lets only members with health.read read and health.manage write", async () => {
    await expectCode(listChart(receptionist(), customerId), "FORBIDDEN");
    await expectCode(chartHistory(receptionist(), customerId), "FORBIDDEN");
    await expectCode(addEntry.run(viewer(), { customerId, tooth: "17", kind: "condition", condition: "caries" }), "FORBIDDEN");
    await expectCode(updateEntry.run(viewer(), { id: entryId, expectedVersion: entryVersion, status: "resolved" }), "FORBIDDEN");
    expect(await listChart(viewer(), customerId)).toHaveLength(2);
  });

  it("resolves and voids entries with optimistic locking", async () => {
    await expectCode(updateEntry.run(doctor(), { id: entryId, expectedVersion: entryVersion + 5, status: "resolved" }), "VERSION_CONFLICT");

    const resolved = await updateEntry.run(doctor(), { id: entryId, expectedVersion: entryVersion, status: "resolved" });
    expect(resolved).toMatchObject({ status: "resolved", version: entryVersion + 1, notes: SECRET_NOTE });
    expect((await listChart(doctor(), customerId)).map((e) => e.status).sort()).toEqual(["active", "resolved"]);

    const edited = await updateEntry.run(doctor(), { id: entryId, expectedVersion: resolved.version, notes: null, surfaces: ["O"] });
    expect(edited).toMatchObject({ notes: null, surfaces: ["O"], status: "resolved" });

    const voided = await updateEntry.run(doctor(), { id: entryId, expectedVersion: edited.version, status: "void" });
    expect(voided.status).toBe("void");
    expect((await listChart(doctor(), customerId)).map((e) => e.id)).not.toContain(entryId);
    await expectCode(updateEntry.run(doctor(), { id: entryId, expectedVersion: voided.version, status: "active" }), "CONFLICT");
  });

  it("shows the history of a tooth from its audit trail", async () => {
    const all = await chartHistory(doctor(), customerId);
    const tooth16 = await chartHistory(doctor(), customerId, "16");
    expect(all.length).toBeGreaterThan(tooth16.length);
    expect(tooth16.map((h) => h.event)).toEqual(["voided", "updated", "resolved", "added"]);
    expect(tooth16.every((h) => h.tooth === "16" && h.entryId === entryId)).toBe(true);
    expect(tooth16[tooth16.length - 1]).toMatchObject({ kind: "condition", condition: "caries", surfaces: ["M", "O", "D"], actorId: "chart-test-user" });
    await expectCode(chartHistory(doctor(), customerId, "99"), "INVALID_INPUT");
  });

  it("reads the tooth numbering setting (FDI unless the clinic chose Universal)", async () => {
    expect(await chartToothNumbering(tenantId)).toBe("fdi");
    await withPlatformTx((tx) =>
      tx
        .insertInto("plugin_setting")
        .values({ tenant_id: tenantId, plugin_id: "appointit.vertical-dental", enabled: true, settings: JSON.stringify({ toothNumbering: "universal" }) })
        .execute(),
    );
    expect(await chartToothNumbering(tenantId)).toBe("universal");
  });
});

describe("procedure catalog", () => {
  it("creates, updates, archives and reorders procedures", async () => {
    const a = await createProcedure.run(catalogManager(), { name: "Composite filling", code: "FIL-1", category: "Restorative", defaultPriceMinor: 12000, currency: "usd" });
    const b = await createProcedure.run(catalogManager(), { name: "Scale and polish" });
    expect(a).toMatchObject({ name: "Composite filling", code: "FIL-1", defaultPriceMinor: 12000, currency: "USD", active: true, serviceId: null });
    expect(b.sort).toBeGreaterThan(a.sort);

    await expectCode(createProcedure.run(catalogManager(), { name: "Another", code: "fil-1" }), "CONFLICT");
    await expectCode(createProcedure.run(catalogManager(), { name: "Priced without currency", defaultPriceMinor: 500 }), "INVALID_INPUT");
    await expectCode(createProcedure.run(catalogManager(), { name: "Bad service", serviceId: randomUUID() }), "INVALID_INPUT");
    await expectCode(createProcedure.run(doctor(), { name: "Not allowed" }), "FORBIDDEN");

    const renamed = await updateProcedure.run(catalogManager(), { id: a.id, expectedVersion: a.version, name: "Composite filling (1 surface)", defaultPriceMinor: null });
    expect(renamed).toMatchObject({ name: "Composite filling (1 surface)", defaultPriceMinor: null, version: a.version + 1 });
    await expectCode(updateProcedure.run(catalogManager(), { id: a.id, expectedVersion: a.version, name: "Stale" }), "VERSION_CONFLICT");

    await reorderProcedures.run(catalogManager(), { ids: [b.id, a.id] });
    expect((await listProcedures(catalogManager())).map((p) => p.id)).toEqual([b.id, a.id]);

    const archived = await archiveProcedure.run(catalogManager(), { id: b.id });
    expect(archived.active).toBe(false);
    expect((await listProcedures(catalogManager())).map((p) => p.id)).toEqual([a.id]);
    expect((await listProcedures(catalogManager(), { includeArchived: true })).map((p) => p.id)).toEqual([b.id, a.id]);

    // Charting members see active procedures only; others see nothing.
    expect((await listProcedures(viewer(), { includeArchived: true })).map((p) => p.id)).toEqual([a.id]);
    await expectCode(listProcedures(receptionist()), "FORBIDDEN");

    const entry = await addEntry.run(doctor(), { customerId, tooth: "26", kind: "planned", procedureId: a.id });
    expect(entry).toMatchObject({ procedureId: a.id, procedureName: "Composite filling (1 surface)", condition: null });
    await expectCode(addEntry.run(doctor(), { customerId, tooth: "26", kind: "planned", procedureId: randomUUID() }), "NOT_FOUND");
  });
});
