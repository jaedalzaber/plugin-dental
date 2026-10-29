// Patient insurance policies. The member id is encrypted (member_id_enc, bound to the policy id); reading it
// needs health.read and writes a health.read audit row; edits need health.manage and are audited by field name
// only. Command results never contain the member id.
import {
  AppError,
  decryptField,
  defineCommand,
  encryptField,
  requirePermission,
  sql,
  uuidv7,
} from "@appointit/plugin-sdk/server";
import type { CommandContext, Tx } from "@appointit/plugin-sdk/server";
import { z } from "@appointit/plugin-sdk";
import { dentalDb } from "../db-types";

export const INSURANCE_RELATIONSHIPS = ["self", "spouse", "child", "parent", "other"] as const;

const memberContext = (tenantId: string, id: string) => ({ tenantId, field: `plg_dental_insurance.member_id:${id}` });

export interface InsuranceDto {
  id: string;
  customerId: string;
  carrier: string;
  memberId: string | null;
  groupNumber: string | null;
  subscriberName: string | null;
  subscriberRelationship: string | null;
  isPrimary: boolean;
  /** "YYYY-MM-DD" or null. */
  validTo: string | null;
  version: number;
}

const optionalText = (max: number) => z.string().trim().max(max).nullish();

const fieldsShape = {
  carrier: z.string().trim().min(1).max(200),
  /** Plain text in, encrypted at rest. Empty or null clears it. */
  memberId: optionalText(100),
  groupNumber: optionalText(100),
  subscriberName: optionalText(200),
  subscriberRelationship: z.enum(INSURANCE_RELATIONSHIPS).nullish(),
  isPrimary: z.boolean().optional(),
  validTo: z.iso.date().nullish(),
};

const blankToNull = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === "" ? null : v.trim());

// ---- list ---------------------------------------------------------------------------------------------------------

const listCommand = defineCommand({
  name: "dental.insurance.list",
  input: z.object({ customerId: z.uuid() }),
  authorize: requirePermission("health.read"),
  handler: async (tx, input, scope): Promise<InsuranceDto[]> => {
    const tenantId = scope.ctx.tenantId;
    const rows = await dentalDb(tx)
      .selectFrom("plg_dental_insurance")
      .select([
        "id",
        "customer_id",
        "carrier",
        "member_id_enc",
        "group_number",
        "subscriber_name",
        "subscriber_relationship",
        "is_primary",
        sql<string | null>`to_char(valid_to, 'YYYY-MM-DD')`.as("valid_to"),
        "version",
      ])
      .where("tenant_id", "=", tenantId)
      .where("customer_id", "=", input.customerId)
      .orderBy("is_primary", "desc")
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    const withMember = rows.filter((r) => r.member_id_enc !== null).length;
    if (withMember > 0) {
      await scope.audit({
        action: "health.read",
        targetType: "customer",
        targetId: input.customerId,
        changes: { resource: "dental.insurance", count: withMember },
      });
    }
    return rows.map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      carrier: r.carrier,
      memberId: r.member_id_enc ? decryptField(r.member_id_enc, memberContext(tenantId, r.id)) : null,
      groupNumber: r.group_number,
      subscriberName: r.subscriber_name,
      subscriberRelationship: r.subscriber_relationship,
      isPrimary: r.is_primary,
      validTo: r.valid_to,
      version: r.version,
    }));
  },
});

/** The patient's policies with member ids decrypted (health.read; the read is logged). */
export function listInsurance(ctx: CommandContext, customerId: string): Promise<InsuranceDto[]> {
  const { idempotencyKey: _dropped, ...plain } = ctx;
  return listCommand.run(plain, { customerId });
}

// ---- create / update / delete -------------------------------------------------------------------------------------

async function clearOtherPrimaries(tx: Tx, tenantId: string, customerId: string, keepId: string): Promise<void> {
  await dentalDb(tx)
    .updateTable("plg_dental_insurance")
    .set({ is_primary: false })
    .where("tenant_id", "=", tenantId)
    .where("customer_id", "=", customerId)
    .where("id", "!=", keepId)
    .where("is_primary", "=", true)
    .execute();
}

export const createInsuranceCommand = defineCommand({
  name: "dental.insurance.create",
  input: z.object({ customerId: z.uuid(), ...fieldsShape }),
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope): Promise<{ id: string; version: number }> => {
    const tenantId = scope.ctx.tenantId;
    const customer = await tx.selectFrom("customer").select("id").where("tenant_id", "=", tenantId).where("id", "=", input.customerId).executeTakeFirst();
    if (!customer) throw new AppError("NOT_FOUND", "Patient not found");
    const existing = await dentalDb(tx)
      .selectFrom("plg_dental_insurance")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("customer_id", "=", input.customerId)
      .limit(1)
      .executeTakeFirst();
    const id = uuidv7();
    const memberId = blankToNull(input.memberId);
    const isPrimary = input.isPrimary ?? existing === undefined;
    const row = await dentalDb(tx)
      .insertInto("plg_dental_insurance")
      .values({
        tenant_id: tenantId,
        id,
        customer_id: input.customerId,
        carrier: input.carrier,
        member_id_enc: memberId === null ? null : encryptField(memberId, memberContext(tenantId, id)),
        group_number: blankToNull(input.groupNumber),
        subscriber_name: blankToNull(input.subscriberName),
        subscriber_relationship: input.subscriberRelationship ?? null,
        is_primary: isPrimary,
        valid_to: input.validTo ?? null,
      })
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    if (isPrimary) await clearOtherPrimaries(tx, tenantId, input.customerId, id);
    await scope.audit({
      action: "dental.insurance.create",
      targetType: "customer",
      targetId: input.customerId,
      changes: { insuranceId: id, fields: ["carrier", ...(memberId !== null ? ["memberId"] : [])] },
    });
    return row;
  },
});

export const updateInsuranceCommand = defineCommand({
  name: "dental.insurance.update",
  input: z.object({
    id: z.uuid(),
    expectedVersion: z.number().int().min(1),
    carrier: fieldsShape.carrier.optional(),
    memberId: fieldsShape.memberId,
    groupNumber: fieldsShape.groupNumber,
    subscriberName: fieldsShape.subscriberName,
    subscriberRelationship: fieldsShape.subscriberRelationship,
    isPrimary: fieldsShape.isPrimary,
    validTo: fieldsShape.validTo,
  }),
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope): Promise<{ id: string; version: number }> => {
    const tenantId = scope.ctx.tenantId;
    const row = await dentalDb(tx)
      .selectFrom("plg_dental_insurance")
      .select(["customer_id", "version"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", input.id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AppError("NOT_FOUND", "Insurance policy not found");
    if (row.version !== input.expectedVersion) {
      throw new AppError("VERSION_CONFLICT", "This policy was changed by someone else", { currentVersion: row.version });
    }
    const memberId = input.memberId === undefined ? undefined : blankToNull(input.memberId);
    const changes = {
      ...(input.carrier !== undefined && { carrier: input.carrier }),
      ...(memberId !== undefined && { member_id_enc: memberId === null ? null : encryptField(memberId, memberContext(tenantId, input.id)) }),
      ...(input.groupNumber !== undefined && { group_number: blankToNull(input.groupNumber) }),
      ...(input.subscriberName !== undefined && { subscriber_name: blankToNull(input.subscriberName) }),
      ...(input.subscriberRelationship !== undefined && { subscriber_relationship: input.subscriberRelationship }),
      ...(input.isPrimary !== undefined && { is_primary: input.isPrimary }),
      ...(input.validTo !== undefined && { valid_to: input.validTo }),
    };
    // Field names only: the audit row never carries values.
    const fields = Object.keys(changes).map((column) => (column === "member_id_enc" ? "memberId" : column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())));

    const updated = await dentalDb(tx)
      .updateTable("plg_dental_insurance")
      .set({ ...changes, version: row.version + 1 })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", input.id)
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    if (input.isPrimary === true) await clearOtherPrimaries(tx, tenantId, row.customer_id, input.id);
    await scope.audit({
      action: "dental.insurance.update",
      targetType: "customer",
      targetId: row.customer_id,
      changes: { insuranceId: input.id, fields },
    });
    return updated;
  },
});

export const deleteInsuranceCommand = defineCommand({
  name: "dental.insurance.delete",
  input: z.object({ id: z.uuid() }),
  authorize: requirePermission("health.manage"),
  handler: async (tx, input, scope): Promise<{ id: string }> => {
    const tenantId = scope.ctx.tenantId;
    const row = await dentalDb(tx)
      .deleteFrom("plg_dental_insurance")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", input.id)
      .returning("customer_id")
      .executeTakeFirst();
    if (!row) throw new AppError("NOT_FOUND", "Insurance policy not found");
    await scope.audit({
      action: "dental.insurance.delete",
      targetType: "customer",
      targetId: row.customer_id,
      changes: { insuranceId: input.id },
    });
    return { id: input.id };
  },
});

export const createInsurance = (ctx: CommandContext, input: unknown) => createInsuranceCommand.run(ctx, input);
export const updateInsurance = (ctx: CommandContext, input: unknown) => updateInsuranceCommand.run(ctx, input);
export const deleteInsurance = (ctx: CommandContext, input: unknown) => deleteInsuranceCommand.run(ctx, input);
