// The clinic's procedure catalog: what the clinic can plan and chart. Clinic-defined (no licensed code list is
// shipped): the code is optional free text. A procedure may link to a bookable service so treatment plans can book it.
// Managing needs services.manage; listing is also open to members who can read health records (they pick procedures
// when charting) but they only see active procedures.
import { z } from "@appointit/plugin-sdk";
import { AppError, defineCommand, requirePermission, sql, withTenantTx } from "@appointit/plugin-sdk/server";
import type { CommandContext, Tx } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../db-types";
import type { ProcedureDto } from "./model";

const canManage = requirePermission("services.manage");

type ProcedureRow = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  default_price_minor: string | null;
  currency: string | null;
  service_id: string | null;
  service_name: string | null;
  active: boolean;
  sort: number;
  version: number;
};

function toDto(r: ProcedureRow): ProcedureDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category,
    defaultPriceMinor: r.default_price_minor === null ? null : Number(r.default_price_minor),
    currency: r.currency,
    serviceId: r.service_id,
    serviceName: r.service_name,
    active: r.active,
    sort: r.sort,
    version: r.version,
  };
}

function selectProcedures(tx: Tx, tenantId: string) {
  return dentalDb(tx)
    .selectFrom("plg_dental_procedure as p")
    .leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "p.tenant_id").onRef("s.id", "=", "p.service_id"))
    .select([
      "p.id",
      "p.code",
      "p.name",
      "p.category",
      "p.default_price_minor",
      "p.currency",
      "p.service_id",
      "s.name as service_name",
      "p.active",
      "p.sort",
      "p.version",
    ])
    .where("p.tenant_id", "=", tenantId);
}

async function loadProcedure(tx: Tx, tenantId: string, id: string): Promise<ProcedureDto> {
  const row = await selectProcedures(tx, tenantId).where("p.id", "=", id).executeTakeFirst();
  if (!row) throw new AppError("NOT_FOUND", "Procedure not found");
  return toDto(row);
}

/**
 * The catalog in the clinic's order. Needs services.manage or health.read; without services.manage only active
 * procedures are returned. `includeArchived` adds archived ones for catalog managers.
 */
export async function listProcedures(ctx: CommandContext, opts: { includeArchived?: boolean } = {}): Promise<ProcedureDto[]> {
  const manager = ctx.actor.type === "system" || ctx.permissions?.has("services.manage") === true;
  if (!manager && ctx.permissions?.has("health.read") !== true) {
    throw new AppError("FORBIDDEN", "You do not have permission to do this");
  }
  const archived = manager && opts.includeArchived === true;
  const rows = await withTenantTx(ctx.tenantId, (tx) => {
    let query = selectProcedures(tx, ctx.tenantId);
    if (!archived) query = query.where("p.active", "=", true);
    return query.orderBy("p.sort").orderBy("p.name").orderBy("p.id").execute();
  });
  return rows.map(toDto);
}

const codeSchema = z.string().trim().min(1).max(40);
const nameSchema = z.string().trim().min(1).max(120);
const categorySchema = z.string().trim().min(1).max(60);
const priceSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const currencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/));

async function requireService(tx: Tx, tenantId: string, serviceId: string): Promise<void> {
  const found = await tx.selectFrom("service").select("id").where("tenant_id", "=", tenantId).where("id", "=", serviceId).executeTakeFirst();
  if (!found) {
    throw new AppError("INVALID_INPUT", "Invalid input", {
      issues: [{ path: "serviceId", message: "That service was not found", code: "custom" }],
    });
  }
}

async function checkCodeFree(tx: Tx, tenantId: string, code: string, exceptId?: string): Promise<void> {
  let query = dentalDb(tx)
    .selectFrom("plg_dental_procedure")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where(sql<string>`lower(code)`, "=", code.toLowerCase());
  if (exceptId) query = query.where("id", "!=", exceptId);
  if (await query.executeTakeFirst()) throw new AppError("CONFLICT", "That procedure code is already used", { code: "PROCEDURE_CODE_TAKEN" });
}

function needCurrency(price: number | null | undefined, currency: string | null | undefined): void {
  if (price !== null && price !== undefined && !currency) {
    throw new AppError("INVALID_INPUT", "Invalid input", {
      issues: [{ path: "currency", message: "Choose a currency for the price", code: "custom" }],
    });
  }
}

export const createProcedure = defineCommand({
  name: "dental.procedure.create",
  input: z.object({
    code: codeSchema.nullish(),
    name: nameSchema,
    category: categorySchema.nullish(),
    defaultPriceMinor: priceSchema.nullish(),
    currency: currencySchema.nullish(),
    serviceId: z.uuid().nullish(),
    active: z.boolean().optional(),
  }),
  authorize: canManage,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    needCurrency(input.defaultPriceMinor, input.currency);
    if (input.code) await checkCodeFree(tx, tenantId, input.code);
    if (input.serviceId) await requireService(tx, tenantId, input.serviceId);
    const last = await dentalDb(tx)
      .selectFrom("plg_dental_procedure")
      .select(sql<number>`coalesce(max(sort), 0)`.as("top"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirstOrThrow();
    const row = await dentalDb(tx)
      .insertInto("plg_dental_procedure")
      .values({
        tenant_id: tenantId,
        code: input.code ?? null,
        name: input.name,
        category: input.category ?? null,
        default_price_minor: input.defaultPriceMinor ?? null,
        currency: input.currency ?? null,
        service_id: input.serviceId ?? null,
        active: input.active ?? true,
        sort: Number(last.top) + 10,
      })
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.procedure.create",
      targetType: "dental_procedure",
      targetId: row.id,
      targetVersion: row.version,
      changes: { name: input.name, code: input.code ?? null, serviceId: input.serviceId ?? null },
    });
    return loadProcedure(tx, tenantId, row.id);
  },
});

export const updateProcedure = defineCommand({
  name: "dental.procedure.update",
  input: z.object({
    id: z.uuid(),
    expectedVersion: z.number().int().min(1),
    code: codeSchema.nullable().optional(),
    name: nameSchema.optional(),
    category: categorySchema.nullable().optional(),
    defaultPriceMinor: priceSchema.nullable().optional(),
    currency: currencySchema.nullable().optional(),
    serviceId: z.uuid().nullable().optional(),
    /** false archives the procedure (it stays on old plans and chart entries), true brings it back. */
    active: z.boolean().optional(),
  }),
  authorize: canManage,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const before = await dentalDb(tx)
      .selectFrom("plg_dental_procedure")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", input.id)
      .forUpdate()
      .executeTakeFirst();
    if (!before) throw new AppError("NOT_FOUND", "Procedure not found");
    if (before.version !== input.expectedVersion) {
      throw new AppError("VERSION_CONFLICT", "This procedure was changed by someone else", { currentVersion: before.version });
    }

    const patch: {
      code?: string | null;
      name?: string;
      category?: string | null;
      default_price_minor?: number | null;
      currency?: string | null;
      service_id?: string | null;
      active?: boolean;
    } = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const set = <K extends keyof typeof patch>(key: K, from: unknown, to: (typeof patch)[K], label: string) => {
      if (from === to) return;
      patch[key] = to;
      changes[label] = { from, to };
    };

    if (input.code !== undefined) {
      if (input.code !== null && input.code.toLowerCase() !== (before.code ?? "").toLowerCase()) {
        await checkCodeFree(tx, tenantId, input.code, before.id);
      }
      set("code", before.code, input.code, "code");
    }
    if (input.name !== undefined) set("name", before.name, input.name, "name");
    if (input.category !== undefined) set("category", before.category, input.category, "category");
    const beforePrice = before.default_price_minor === null ? null : Number(before.default_price_minor);
    if (input.defaultPriceMinor !== undefined) set("default_price_minor", beforePrice, input.defaultPriceMinor, "defaultPriceMinor");
    if (input.currency !== undefined) set("currency", before.currency, input.currency, "currency");
    if (input.serviceId !== undefined) {
      if (input.serviceId !== null && input.serviceId !== before.service_id) await requireService(tx, tenantId, input.serviceId);
      set("service_id", before.service_id, input.serviceId, "serviceId");
    }
    if (input.active !== undefined) set("active", before.active, input.active, "active");
    if (Object.keys(patch).length === 0) throw new AppError("INVALID_INPUT", "Nothing to change");

    needCurrency(
      patch.default_price_minor !== undefined ? patch.default_price_minor : beforePrice,
      patch.currency !== undefined ? patch.currency : before.currency,
    );

    const after = await dentalDb(tx)
      .updateTable("plg_dental_procedure")
      .set({ ...patch, version: sql<number>`version + 1` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", before.id)
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.procedure.update",
      targetType: "dental_procedure",
      targetId: after.id,
      targetVersion: after.version,
      changes,
    });
    return loadProcedure(tx, tenantId, after.id);
  },
});

/** Archives a procedure: it leaves the pick lists but stays on old plans and chart entries. Archiving twice is fine. */
export const archiveProcedure = defineCommand({
  name: "dental.procedure.archive",
  input: z.object({ id: z.uuid() }),
  authorize: canManage,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const before = await dentalDb(tx)
      .selectFrom("plg_dental_procedure")
      .select(["id", "active", "version"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", input.id)
      .forUpdate()
      .executeTakeFirst();
    if (!before) throw new AppError("NOT_FOUND", "Procedure not found");
    if (before.active) {
      const after = await dentalDb(tx)
        .updateTable("plg_dental_procedure")
        .set({ active: false, version: sql<number>`version + 1` })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", before.id)
        .returning("version")
        .executeTakeFirstOrThrow();
      await scope.audit({
        action: "dental.procedure.archive",
        targetType: "dental_procedure",
        targetId: before.id,
        targetVersion: after.version,
        changes: { active: { from: true, to: false } },
      });
    }
    return loadProcedure(tx, tenantId, before.id);
  },
});

/** Sets the order of the catalog: `ids` lists procedures in their new order (ones left out keep their place after them). */
export const reorderProcedures = defineCommand({
  name: "dental.procedure.reorder",
  input: z.object({ ids: z.array(z.uuid()).min(1).max(1000) }),
  authorize: canManage,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const ids = [...new Set(input.ids)];
    const found = await dentalDb(tx).selectFrom("plg_dental_procedure").select("id").where("tenant_id", "=", tenantId).where("id", "in", ids).execute();
    if (found.length !== ids.length) throw new AppError("NOT_FOUND", "One of the procedures was not found");
    for (const [index, id] of ids.entries()) {
      await dentalDb(tx)
        .updateTable("plg_dental_procedure")
        .set({ sort: (index + 1) * 10 })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .execute();
    }
    // Procedures not named keep their relative order, after the named ones.
    const rest = await dentalDb(tx)
      .selectFrom("plg_dental_procedure")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("id", "not in", ids)
      .orderBy("sort")
      .orderBy("name")
      .orderBy("id")
      .execute();
    for (const [index, row] of rest.entries()) {
      await dentalDb(tx)
        .updateTable("plg_dental_procedure")
        .set({ sort: (ids.length + index + 1) * 10 })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", row.id)
        .execute();
    }
    await scope.audit({
      action: "dental.procedure.reorder",
      targetType: "dental_procedure",
      changes: { order: ids },
    });
    return { ids };
  },
});
