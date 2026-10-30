"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_plugin_sdk12 = require("@appointit/plugin-sdk");

// src/server/chart/teeth.ts
var adultTeeth = [];
for (const quadrant of [1, 2, 3, 4]) for (let position = 1; position <= 8; position++) adultTeeth.push(`${quadrant}${position}`);
var childTeeth = [];
for (const quadrant of [5, 6, 7, 8]) for (let position = 1; position <= 5; position++) childTeeth.push(`${quadrant}${position}`);
var ALL_TEETH = [...adultTeeth, ...childTeeth];
var VALID = new Set(ALL_TEETH);
function isValidTooth(value) {
  return typeof value === "string" && VALID.has(value);
}
function assertTooth(fdi) {
  if (!isValidTooth(fdi)) throw new RangeError(`Not an FDI tooth number: ${String(fdi)}`);
}
function dentitionOf(fdi) {
  assertTooth(fdi);
  return Number(fdi[0]) >= 5 ? "child" : "adult";
}
function quadrantOf(fdi) {
  assertTooth(fdi);
  return Number(fdi[0]);
}
function positionOf(fdi) {
  assertTooth(fdi);
  return Number(fdi[1]);
}
function isUpper(fdi) {
  const q = quadrantOf(fdi);
  return q === 1 || q === 2 || q === 5 || q === 6;
}
function toothType(fdi) {
  const position = positionOf(fdi);
  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  if (dentitionOf(fdi) === "child") return "molar";
  return position <= 5 ? "premolar" : "molar";
}
function isAnterior(fdi) {
  const type = toothType(fdi);
  return type === "incisor" || type === "canine";
}
function toothNumberingOf(value) {
  return value === "universal" ? "universal" : "fdi";
}
var SURFACE_SLOTS = ["mesial", "occlusal", "distal", "buccal", "lingual"];
var SLOT_OF = {
  M: "mesial",
  D: "distal",
  O: "occlusal",
  I: "occlusal",
  B: "buccal",
  F: "buccal",
  L: "lingual",
  P: "lingual"
};
function isSurfaceLetter(value) {
  return typeof value === "string" && Object.hasOwn(SLOT_OF, value);
}
function surfaceLetters(fdi) {
  assertTooth(fdi);
  const anterior = isAnterior(fdi);
  return {
    mesial: "M",
    distal: "D",
    occlusal: anterior ? "I" : "O",
    buccal: anterior ? "F" : "B",
    lingual: isUpper(fdi) ? "P" : "L"
  };
}
function canonicalSurfaces(fdi, letters) {
  const own = surfaceLetters(fdi);
  const faces = /* @__PURE__ */ new Set();
  for (const letter of letters) {
    const upper = String(letter).trim().toUpperCase();
    if (!isSurfaceLetter(upper)) throw new RangeError(`Not a tooth surface: ${String(letter)}`);
    faces.add(SLOT_OF[upper]);
  }
  return SURFACE_SLOTS.filter((slot) => faces.has(slot)).map((slot) => own[slot]);
}

// src/server/chart/model.ts
var ENTRY_KINDS = ["condition", "existing", "planned", "completed"];
var ENTRY_STATUSES = ["active", "resolved", "void"];
var CONDITIONS = [
  "caries",
  "filling",
  "crown",
  "bridge",
  "implant",
  "root_canal",
  "missing",
  "extraction_needed",
  "fracture",
  "sealant",
  "veneer",
  "impacted",
  "mobility",
  "periodontal_pocket",
  "watch"
];
function isCondition(value) {
  return typeof value === "string" && CONDITIONS.includes(value);
}
var DENTAL_PLUGIN_ID = "appointit.vertical-dental";

// src/server/chart/entries.ts
var import_plugin_sdk = require("@appointit/plugin-sdk");
var import_server = require("@appointit/plugin-sdk/server");

// src/server/db-types.ts
function dentalDb(tx) {
  return tx.withTables();
}

// src/server/chart/entries.ts
var NOTES_FIELD = "dental.chart.notes";
var notesContext = (tenantId) => ({ tenantId, field: NOTES_FIELD });
var canRead = (0, import_server.requirePermission)("health.read");
var canWrite = (0, import_server.requirePermission)("health.manage");
var toothSchema = import_plugin_sdk.z.string().refine(isValidTooth, "Not a valid FDI tooth number (11-48 or 51-85)");
function surfacesOf(tooth, letters) {
  try {
    return canonicalSurfaces(tooth, letters);
  } catch {
    throw new import_server.AppError("INVALID_INPUT", "Invalid input", {
      issues: [{ path: "surfaces", message: "Use the letters M, O, D, B, L, I, F or P", code: "custom" }]
    });
  }
}
function toDto(tenantId, r) {
  return {
    id: r.id,
    customerId: r.customer_id,
    tooth: r.tooth,
    surfaces: r.surfaces,
    kind: r.kind,
    condition: isCondition(r.condition) ? r.condition : null,
    procedureId: r.procedure_id,
    procedureName: r.procedure_name,
    planItemId: r.plan_item_id,
    notes: r.notes_enc === null ? null : (0, import_server.decryptField)(r.notes_enc, notesContext(tenantId)),
    status: r.status,
    recordedBy: r.recorded_by,
    recordedByName: r.recorded_by_name,
    recordedAt: r.recorded_at.toISOString(),
    version: r.version
  };
}
function selectEntries(tx, tenantId) {
  return dentalDb(tx).selectFrom("plg_dental_chart_entry as e").leftJoin("plg_dental_procedure as p", (join) => join.onRef("p.tenant_id", "=", "e.tenant_id").onRef("p.id", "=", "e.procedure_id")).leftJoin("user as u", "u.id", "e.recorded_by").select([
    "e.id",
    "e.customer_id",
    "e.tooth",
    "e.surfaces",
    "e.kind",
    "e.condition",
    "e.procedure_id",
    "e.plan_item_id",
    "e.notes_enc",
    "e.status",
    "e.recorded_by",
    "e.recorded_at",
    "e.version",
    "p.name as procedure_name",
    "u.name as recorded_by_name"
  ]).where("e.tenant_id", "=", tenantId);
}
async function loadEntry(tx, tenantId, id) {
  const row = await selectEntries(tx, tenantId).where("e.id", "=", id).executeTakeFirst();
  if (!row) throw new import_server.AppError("NOT_FOUND", "Chart entry not found");
  return toDto(tenantId, row);
}
async function requireCustomer(tx, tenantId, customerId) {
  const found = await tx.selectFrom("customer").select("id").where("tenant_id", "=", tenantId).where("id", "=", customerId).executeTakeFirst();
  if (!found) throw new import_server.AppError("NOT_FOUND", "Patient not found");
}
async function requireProcedure(tx, tenantId, procedureId) {
  const found = await dentalDb(tx).selectFrom("plg_dental_procedure").select("id").where("tenant_id", "=", tenantId).where("id", "=", procedureId).executeTakeFirst();
  if (!found) throw new import_server.AppError("NOT_FOUND", "Procedure not found");
}
async function auditHealthRead(tx, ctx, customerId, resource) {
  const requestId = ctx.requestId ?? null;
  if (requestId !== null) {
    const seen = await tx.selectFrom("audit_event").select("id").where("tenant_id", "=", ctx.tenantId).where("request_id", "=", requestId).where("action", "=", "health.read").where("target_id", "=", customerId).limit(1).executeTakeFirst();
    if (seen) return;
  }
  await tx.insertInto("audit_event").values({
    tenant_id: ctx.tenantId,
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id ?? null,
    action: "health.read",
    target_type: "customer",
    target_id: customerId,
    changes: JSON.stringify({ resource }),
    request_id: requestId,
    ip: ctx.ip ?? null,
    user_agent: ctx.userAgent ?? null
  }).execute();
}
var customerIdSchema = import_plugin_sdk.z.uuid();
function parseCustomerId(customerId) {
  const parsed = customerIdSchema.safeParse(customerId);
  if (!parsed.success) throw new import_server.AppError("INVALID_INPUT", "Invalid patient id");
  return parsed.data;
}
async function listChart(ctx, customerId) {
  canRead(ctx);
  const id = parseCustomerId(customerId);
  return (0, import_server.withTenantTx)(ctx.tenantId, async (tx) => {
    await requireCustomer(tx, ctx.tenantId, id);
    await auditHealthRead(tx, ctx, id, "dental.chart");
    const rows = await selectEntries(tx, ctx.tenantId).where("e.customer_id", "=", id).where("e.status", "in", ["active", "resolved"]).orderBy("e.recorded_at", "desc").orderBy("e.id", "desc").execute();
    return rows.map((r) => toDto(ctx.tenantId, r));
  });
}
async function chartToothNumbering(tenantId) {
  return (0, import_server.withTenantTx)(tenantId, async (tx) => {
    const row = await tx.selectFrom("plugin_setting").select("settings").where("tenant_id", "=", tenantId).where("plugin_id", "=", DENTAL_PLUGIN_ID).executeTakeFirst();
    const settings = row?.settings;
    const value = typeof settings === "object" && settings !== null && !Array.isArray(settings) ? settings.toothNumbering : void 0;
    return toothNumberingOf(value);
  });
}
var CHART_ACTIONS = ["dental.chart.addEntry", "dental.chart.updateEntry"];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function textOrNull(value) {
  return typeof value === "string" ? value : null;
}
async function chartHistory(ctx, customerId, tooth) {
  canRead(ctx);
  const id = parseCustomerId(customerId);
  if (tooth !== void 0 && !isValidTooth(tooth)) throw new import_server.AppError("INVALID_INPUT", "Not a valid FDI tooth number");
  return (0, import_server.withTenantTx)(ctx.tenantId, async (tx) => {
    await requireCustomer(tx, ctx.tenantId, id);
    await auditHealthRead(tx, ctx, id, "dental.chart.history");
    let entries = dentalDb(tx).selectFrom("plg_dental_chart_entry").select(["id", "tooth"]).where("tenant_id", "=", ctx.tenantId).where("customer_id", "=", id);
    if (tooth !== void 0) entries = entries.where("tooth", "=", tooth);
    const found = await entries.execute();
    if (found.length === 0) return [];
    const toothOf = new Map(found.map((e) => [e.id, e.tooth]));
    const events = await tx.selectFrom("audit_event as a").leftJoin("user as u", "u.id", "a.actor_id").select(["a.id", "a.action", "a.target_id", "a.changes", "a.occurred_at", "a.actor_id", "u.name as actor_name"]).where("a.tenant_id", "=", ctx.tenantId).where("a.target_type", "=", "dental_chart_entry").where("a.action", "in", CHART_ACTIONS).where("a.target_id", "in", [...toothOf.keys()]).orderBy("a.occurred_at", "desc").orderBy("a.id", "desc").limit(500).execute();
    return events.map((e) => {
      const changes = isRecord(e.changes) ? e.changes : {};
      const status = isRecord(changes.status) ? changes.status : null;
      const to = status ? textOrNull(status.to) : null;
      const event = e.action === "dental.chart.addEntry" ? "added" : to === "resolved" ? "resolved" : to === "void" ? "voided" : to === "active" ? "reopened" : "updated";
      const surfaces = Array.isArray(changes.surfaces) ? changes.surfaces.filter((s) => typeof s === "string") : isRecord(changes.surfaces) && Array.isArray(changes.surfaces.to) ? changes.surfaces.to.filter((s) => typeof s === "string") : [];
      return {
        id: e.id,
        at: e.occurred_at.toISOString(),
        event,
        entryId: e.target_id,
        tooth: textOrNull(changes.tooth) ?? (e.target_id ? toothOf.get(e.target_id) ?? null : null),
        kind: textOrNull(changes.kind),
        condition: textOrNull(changes.condition),
        surfaces,
        actorId: e.actor_id,
        actorName: e.actor_name
      };
    });
  });
}
var notesSchema = import_plugin_sdk.z.string().trim().max(4e3);
var addEntry = (0, import_server.defineCommand)({
  name: "dental.chart.addEntry",
  input: import_plugin_sdk.z.object({
    customerId: import_plugin_sdk.z.uuid(),
    tooth: toothSchema,
    /** Anatomical letters; empty = the whole tooth. */
    surfaces: import_plugin_sdk.z.array(import_plugin_sdk.z.string().min(1).max(2)).max(8).default([]),
    kind: import_plugin_sdk.z.enum(ENTRY_KINDS),
    condition: import_plugin_sdk.z.enum(CONDITIONS).nullish(),
    procedureId: import_plugin_sdk.z.uuid().nullish(),
    /** Set by treatment plans to tie the entry to a plan item. */
    planItemId: import_plugin_sdk.z.uuid().nullish(),
    notes: notesSchema.nullish()
  }).refine((i) => Boolean(i.condition) || Boolean(i.procedureId), { message: "Choose a condition or a procedure", path: ["condition"] }),
  authorize: canWrite,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    await requireCustomer(tx, tenantId, input.customerId);
    if (input.procedureId) await requireProcedure(tx, tenantId, input.procedureId);
    const surfaces = surfacesOf(input.tooth, input.surfaces);
    const notes = input.notes ? input.notes : null;
    const row = await dentalDb(tx).insertInto("plg_dental_chart_entry").values({
      tenant_id: tenantId,
      customer_id: input.customerId,
      tooth: input.tooth,
      surfaces,
      kind: input.kind,
      condition: input.condition ?? null,
      procedure_id: input.procedureId ?? null,
      plan_item_id: input.planItemId ?? null,
      notes_enc: notes === null ? null : (0, import_server.encryptField)(notes, notesContext(tenantId)),
      recorded_by: scope.ctx.actor.id ?? null
    }).returning(["id", "version"]).executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.chart.addEntry",
      targetType: "dental_chart_entry",
      targetId: row.id,
      targetVersion: row.version,
      changes: {
        customerId: input.customerId,
        tooth: input.tooth,
        kind: input.kind,
        surfaces,
        condition: input.condition ?? null,
        procedureId: input.procedureId ?? null
      }
    });
    return loadEntry(tx, tenantId, row.id);
  }
});
var ALLOWED_STATUS_MOVES = {
  active: ["resolved", "void"],
  resolved: ["active", "void"],
  void: []
};
var updateEntry = (0, import_server.defineCommand)({
  name: "dental.chart.updateEntry",
  input: import_plugin_sdk.z.object({
    id: import_plugin_sdk.z.uuid(),
    expectedVersion: import_plugin_sdk.z.number().int().min(1),
    /** active -> resolved or void; resolved -> active (reopen) or void. A void entry cannot change any more. */
    status: import_plugin_sdk.z.enum(ENTRY_STATUSES).optional(),
    surfaces: import_plugin_sdk.z.array(import_plugin_sdk.z.string().min(1).max(2)).max(8).optional(),
    condition: import_plugin_sdk.z.enum(CONDITIONS).nullable().optional(),
    procedureId: import_plugin_sdk.z.uuid().nullable().optional(),
    notes: notesSchema.nullable().optional()
  }),
  authorize: canWrite,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const before = await dentalDb(tx).selectFrom("plg_dental_chart_entry").selectAll().where("tenant_id", "=", tenantId).where("id", "=", input.id).forUpdate().executeTakeFirst();
    if (!before) throw new import_server.AppError("NOT_FOUND", "Chart entry not found");
    if (before.version !== input.expectedVersion) {
      throw new import_server.AppError("VERSION_CONFLICT", "This chart entry was changed by someone else", { currentVersion: before.version });
    }
    if (before.status === "void") throw new import_server.AppError("CONFLICT", "A voided chart entry cannot be changed");
    const patch = {};
    const changes = { tooth: before.tooth, kind: before.kind };
    if (input.status !== void 0 && input.status !== before.status) {
      if (!ALLOWED_STATUS_MOVES[before.status]?.includes(input.status)) {
        throw new import_server.AppError("CONFLICT", `A ${before.status} chart entry cannot become ${input.status}`);
      }
      patch.status = input.status;
      changes.status = { from: before.status, to: input.status };
    }
    if (input.surfaces !== void 0) {
      const next = surfacesOf(before.tooth, input.surfaces);
      if (JSON.stringify(next) !== JSON.stringify(before.surfaces)) {
        patch.surfaces = next;
        changes.surfaces = { from: before.surfaces, to: next };
      }
    }
    if (input.condition !== void 0 && input.condition !== before.condition) {
      patch.condition = input.condition;
      changes.condition = { from: before.condition, to: input.condition };
    }
    if (input.procedureId !== void 0 && input.procedureId !== before.procedure_id) {
      if (input.procedureId !== null) await requireProcedure(tx, tenantId, input.procedureId);
      patch.procedure_id = input.procedureId;
      changes.procedureId = { from: before.procedure_id, to: input.procedureId };
    }
    if (input.notes !== void 0) {
      patch.notes_enc = input.notes ? (0, import_server.encryptField)(input.notes, notesContext(tenantId)) : null;
      changes.notesChanged = true;
    }
    if (Object.keys(patch).length === 0) throw new import_server.AppError("INVALID_INPUT", "Nothing to change");
    const nextCondition = patch.condition !== void 0 ? patch.condition : before.condition;
    const nextProcedure = patch.procedure_id !== void 0 ? patch.procedure_id : before.procedure_id;
    if (!nextCondition && !nextProcedure) {
      throw new import_server.AppError("INVALID_INPUT", "Invalid input", {
        issues: [{ path: "condition", message: "Choose a condition or a procedure", code: "custom" }]
      });
    }
    const after = await dentalDb(tx).updateTable("plg_dental_chart_entry").set({ ...patch, version: import_server.sql`version + 1` }).where("tenant_id", "=", tenantId).where("id", "=", before.id).returning(["id", "version"]).executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.chart.updateEntry",
      targetType: "dental_chart_entry",
      targetId: after.id,
      targetVersion: after.version,
      changes
    });
    return loadEntry(tx, tenantId, after.id);
  }
});

// src/server/chart/procedures.ts
var import_plugin_sdk2 = require("@appointit/plugin-sdk");
var import_server2 = require("@appointit/plugin-sdk/server");
var canManage = (0, import_server2.requirePermission)("services.manage");
function toDto2(r) {
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
    version: r.version
  };
}
function selectProcedures(tx, tenantId) {
  return dentalDb(tx).selectFrom("plg_dental_procedure as p").leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "p.tenant_id").onRef("s.id", "=", "p.service_id")).select([
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
    "p.version"
  ]).where("p.tenant_id", "=", tenantId);
}
async function loadProcedure(tx, tenantId, id) {
  const row = await selectProcedures(tx, tenantId).where("p.id", "=", id).executeTakeFirst();
  if (!row) throw new import_server2.AppError("NOT_FOUND", "Procedure not found");
  return toDto2(row);
}
async function listProcedures(ctx, opts = {}) {
  const manager = ctx.actor.type === "system" || ctx.permissions?.has("services.manage") === true;
  if (!manager && ctx.permissions?.has("health.read") !== true) {
    throw new import_server2.AppError("FORBIDDEN", "You do not have permission to do this");
  }
  const archived = manager && opts.includeArchived === true;
  const rows = await (0, import_server2.withTenantTx)(ctx.tenantId, (tx) => {
    let query = selectProcedures(tx, ctx.tenantId);
    if (!archived) query = query.where("p.active", "=", true);
    return query.orderBy("p.sort").orderBy("p.name").orderBy("p.id").execute();
  });
  return rows.map(toDto2);
}
var codeSchema = import_plugin_sdk2.z.string().trim().min(1).max(40);
var nameSchema = import_plugin_sdk2.z.string().trim().min(1).max(120);
var categorySchema = import_plugin_sdk2.z.string().trim().min(1).max(60);
var priceSchema = import_plugin_sdk2.z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
var currencySchema = import_plugin_sdk2.z.string().trim().length(3).transform((v) => v.toUpperCase()).pipe(import_plugin_sdk2.z.string().regex(/^[A-Z]{3}$/));
async function requireService(tx, tenantId, serviceId) {
  const found = await tx.selectFrom("service").select("id").where("tenant_id", "=", tenantId).where("id", "=", serviceId).executeTakeFirst();
  if (!found) {
    throw new import_server2.AppError("INVALID_INPUT", "Invalid input", {
      issues: [{ path: "serviceId", message: "That service was not found", code: "custom" }]
    });
  }
}
async function checkCodeFree(tx, tenantId, code, exceptId) {
  let query = dentalDb(tx).selectFrom("plg_dental_procedure").select("id").where("tenant_id", "=", tenantId).where(import_server2.sql`lower(code)`, "=", code.toLowerCase());
  if (exceptId) query = query.where("id", "!=", exceptId);
  if (await query.executeTakeFirst()) throw new import_server2.AppError("CONFLICT", "That procedure code is already used", { code: "PROCEDURE_CODE_TAKEN" });
}
function needCurrency(price, currency) {
  if (price !== null && price !== void 0 && !currency) {
    throw new import_server2.AppError("INVALID_INPUT", "Invalid input", {
      issues: [{ path: "currency", message: "Choose a currency for the price", code: "custom" }]
    });
  }
}
var createProcedure = (0, import_server2.defineCommand)({
  name: "dental.procedure.create",
  input: import_plugin_sdk2.z.object({
    code: codeSchema.nullish(),
    name: nameSchema,
    category: categorySchema.nullish(),
    defaultPriceMinor: priceSchema.nullish(),
    currency: currencySchema.nullish(),
    serviceId: import_plugin_sdk2.z.uuid().nullish(),
    active: import_plugin_sdk2.z.boolean().optional()
  }),
  authorize: canManage,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    needCurrency(input.defaultPriceMinor, input.currency);
    if (input.code) await checkCodeFree(tx, tenantId, input.code);
    if (input.serviceId) await requireService(tx, tenantId, input.serviceId);
    const last = await dentalDb(tx).selectFrom("plg_dental_procedure").select(import_server2.sql`coalesce(max(sort), 0)`.as("top")).where("tenant_id", "=", tenantId).executeTakeFirstOrThrow();
    const row = await dentalDb(tx).insertInto("plg_dental_procedure").values({
      tenant_id: tenantId,
      code: input.code ?? null,
      name: input.name,
      category: input.category ?? null,
      default_price_minor: input.defaultPriceMinor ?? null,
      currency: input.currency ?? null,
      service_id: input.serviceId ?? null,
      active: input.active ?? true,
      sort: Number(last.top) + 10
    }).returning(["id", "version"]).executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.procedure.create",
      targetType: "dental_procedure",
      targetId: row.id,
      targetVersion: row.version,
      changes: { name: input.name, code: input.code ?? null, serviceId: input.serviceId ?? null }
    });
    return loadProcedure(tx, tenantId, row.id);
  }
});
var updateProcedure = (0, import_server2.defineCommand)({
  name: "dental.procedure.update",
  input: import_plugin_sdk2.z.object({
    id: import_plugin_sdk2.z.uuid(),
    expectedVersion: import_plugin_sdk2.z.number().int().min(1),
    code: codeSchema.nullable().optional(),
    name: nameSchema.optional(),
    category: categorySchema.nullable().optional(),
    defaultPriceMinor: priceSchema.nullable().optional(),
    currency: currencySchema.nullable().optional(),
    serviceId: import_plugin_sdk2.z.uuid().nullable().optional(),
    /** false archives the procedure (it stays on old plans and chart entries), true brings it back. */
    active: import_plugin_sdk2.z.boolean().optional()
  }),
  authorize: canManage,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const before = await dentalDb(tx).selectFrom("plg_dental_procedure").selectAll().where("tenant_id", "=", tenantId).where("id", "=", input.id).forUpdate().executeTakeFirst();
    if (!before) throw new import_server2.AppError("NOT_FOUND", "Procedure not found");
    if (before.version !== input.expectedVersion) {
      throw new import_server2.AppError("VERSION_CONFLICT", "This procedure was changed by someone else", { currentVersion: before.version });
    }
    const patch = {};
    const changes = {};
    const set = (key, from, to, label) => {
      if (from === to) return;
      patch[key] = to;
      changes[label] = { from, to };
    };
    if (input.code !== void 0) {
      if (input.code !== null && input.code.toLowerCase() !== (before.code ?? "").toLowerCase()) {
        await checkCodeFree(tx, tenantId, input.code, before.id);
      }
      set("code", before.code, input.code, "code");
    }
    if (input.name !== void 0) set("name", before.name, input.name, "name");
    if (input.category !== void 0) set("category", before.category, input.category, "category");
    const beforePrice = before.default_price_minor === null ? null : Number(before.default_price_minor);
    if (input.defaultPriceMinor !== void 0) set("default_price_minor", beforePrice, input.defaultPriceMinor, "defaultPriceMinor");
    if (input.currency !== void 0) set("currency", before.currency, input.currency, "currency");
    if (input.serviceId !== void 0) {
      if (input.serviceId !== null && input.serviceId !== before.service_id) await requireService(tx, tenantId, input.serviceId);
      set("service_id", before.service_id, input.serviceId, "serviceId");
    }
    if (input.active !== void 0) set("active", before.active, input.active, "active");
    if (Object.keys(patch).length === 0) throw new import_server2.AppError("INVALID_INPUT", "Nothing to change");
    needCurrency(
      patch.default_price_minor !== void 0 ? patch.default_price_minor : beforePrice,
      patch.currency !== void 0 ? patch.currency : before.currency
    );
    const after = await dentalDb(tx).updateTable("plg_dental_procedure").set({ ...patch, version: import_server2.sql`version + 1` }).where("tenant_id", "=", tenantId).where("id", "=", before.id).returning(["id", "version"]).executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.procedure.update",
      targetType: "dental_procedure",
      targetId: after.id,
      targetVersion: after.version,
      changes
    });
    return loadProcedure(tx, tenantId, after.id);
  }
});
var archiveProcedure = (0, import_server2.defineCommand)({
  name: "dental.procedure.archive",
  input: import_plugin_sdk2.z.object({ id: import_plugin_sdk2.z.uuid() }),
  authorize: canManage,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const before = await dentalDb(tx).selectFrom("plg_dental_procedure").select(["id", "active", "version"]).where("tenant_id", "=", tenantId).where("id", "=", input.id).forUpdate().executeTakeFirst();
    if (!before) throw new import_server2.AppError("NOT_FOUND", "Procedure not found");
    if (before.active) {
      const after = await dentalDb(tx).updateTable("plg_dental_procedure").set({ active: false, version: import_server2.sql`version + 1` }).where("tenant_id", "=", tenantId).where("id", "=", before.id).returning("version").executeTakeFirstOrThrow();
      await scope.audit({
        action: "dental.procedure.archive",
        targetType: "dental_procedure",
        targetId: before.id,
        targetVersion: after.version,
        changes: { active: { from: true, to: false } }
      });
    }
    return loadProcedure(tx, tenantId, before.id);
  }
});
var reorderProcedures = (0, import_server2.defineCommand)({
  name: "dental.procedure.reorder",
  input: import_plugin_sdk2.z.object({ ids: import_plugin_sdk2.z.array(import_plugin_sdk2.z.uuid()).min(1).max(1e3) }),
  authorize: canManage,
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const ids = [...new Set(input.ids)];
    const found = await dentalDb(tx).selectFrom("plg_dental_procedure").select("id").where("tenant_id", "=", tenantId).where("id", "in", ids).execute();
    if (found.length !== ids.length) throw new import_server2.AppError("NOT_FOUND", "One of the procedures was not found");
    for (const [index, id] of ids.entries()) {
      await dentalDb(tx).updateTable("plg_dental_procedure").set({ sort: (index + 1) * 10 }).where("tenant_id", "=", tenantId).where("id", "=", id).execute();
    }
    const rest = await dentalDb(tx).selectFrom("plg_dental_procedure").select("id").where("tenant_id", "=", tenantId).where("id", "not in", ids).orderBy("sort").orderBy("name").orderBy("id").execute();
    for (const [index, row] of rest.entries()) {
      await dentalDb(tx).updateTable("plg_dental_procedure").set({ sort: (ids.length + index + 1) * 10 }).where("tenant_id", "=", tenantId).where("id", "=", row.id).execute();
    }
    await scope.audit({
      action: "dental.procedure.reorder",
      targetType: "dental_procedure",
      changes: { order: ids }
    });
    return { ids };
  }
});

// src/server/chart/index.ts
function registerChart(_api) {
}

// src/server/history/reminders.ts
var import_server5 = require("@appointit/plugin-sdk/server");
var import_plugin_sdk4 = require("@appointit/plugin-sdk");

// src/server/enabled.ts
var import_server4 = require("@appointit/plugin-sdk/server");

// src/server/history/consent.ts
var import_server3 = require("@appointit/plugin-sdk/server");
var import_plugin_sdk3 = require("@appointit/plugin-sdk");
var DENTAL_PLUGIN_ID2 = "appointit.vertical-dental";
var ACTIVE_STATUSES = /* @__PURE__ */ new Set(["requested", "confirmed", "checked_in", "in_progress"]);
function readMap(settings) {
  const raw = typeof settings === "object" && settings !== null ? settings.consentForms : void 0;
  const out = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [serviceId, slug] of Object.entries(raw)) if (typeof slug === "string" && slug !== "") out[serviceId] = slug;
  }
  return out;
}
async function getConsentForms(tenantId) {
  const row = await (0, import_server3.withTenantTx)(
    tenantId,
    (tx) => tx.selectFrom("plugin_setting").select("settings").where("tenant_id", "=", tenantId).where("plugin_id", "=", DENTAL_PLUGIN_ID2).executeTakeFirst()
  );
  return readMap(row?.settings);
}
var setConsentFormsCommand = (0, import_server3.defineCommand)({
  name: "dental.consent.setForms",
  input: import_plugin_sdk3.z.object({
    /** Replaces the whole mapping; a service left out has no consent form. */
    consentForms: import_plugin_sdk3.z.record(import_plugin_sdk3.z.uuid(), import_plugin_sdk3.z.string().trim().min(1).max(200))
  }),
  authorize: (0, import_server3.requirePermission)("plugins.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const slugs = [...new Set(Object.values(input.consentForms))];
    if (slugs.length > 0) {
      const found = await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).where("slug", "in", slugs).execute();
      const have = new Set(found.map((f) => f.slug));
      const missing = slugs.filter((s) => !have.has(s));
      if (missing.length > 0) throw new import_server3.AppError("INVALID_INPUT", "Unknown consent form", { issues: [{ path: "consentForms", message: `Unknown form: ${missing[0]}`, code: "custom" }] });
    }
    const patch = JSON.stringify({ consentForms: input.consentForms });
    const row = await tx.selectFrom("plugin_setting").select("version").where("tenant_id", "=", tenantId).where("plugin_id", "=", DENTAL_PLUGIN_ID2).forUpdate().executeTakeFirst();
    if (row) {
      await tx.updateTable("plugin_setting").set({ settings: import_server3.sql`settings || ${patch}::jsonb`, version: row.version + 1 }).where("tenant_id", "=", tenantId).where("plugin_id", "=", DENTAL_PLUGIN_ID2).execute();
    } else {
      await tx.insertInto("plugin_setting").values({ tenant_id: tenantId, plugin_id: DENTAL_PLUGIN_ID2, settings: patch }).execute();
    }
    await scope.audit({
      action: "dental.consent.setForms",
      targetType: "plugin_setting",
      targetId: DENTAL_PLUGIN_ID2,
      changes: { services: Object.keys(input.consentForms).length }
    });
    return { count: Object.keys(input.consentForms).length };
  }
});
function setConsentForms(ctx, consentForms) {
  return setConsentFormsCommand.run(ctx, { consentForms });
}
async function getConsentStatus(ctx, bookingId) {
  (0, import_server3.requirePermission)("bookings.read")(ctx);
  if (!import_plugin_sdk3.z.uuid().safeParse(bookingId).success) throw new import_server3.AppError("INVALID_INPUT", "Invalid booking id");
  const tenantId = ctx.tenantId;
  return (0, import_server3.withTenantTx)(tenantId, async (tx) => {
    const booking = await tx.selectFrom("booking").select(["customer_id", "status", "created_at"]).where("tenant_id", "=", tenantId).where("id", "=", bookingId).executeTakeFirst();
    if (!booking) throw new import_server3.AppError("NOT_FOUND", "Booking not found");
    const none = { bookingId, customerId: booking.customer_id, needed: false, forms: [] };
    if (!ACTIVE_STATUSES.has(booking.status)) return none;
    const items = await tx.selectFrom("booking_item").select("service_id").where("tenant_id", "=", tenantId).where("booking_id", "=", bookingId).execute();
    const setting = await tx.selectFrom("plugin_setting").select("settings").where("tenant_id", "=", tenantId).where("plugin_id", "=", DENTAL_PLUGIN_ID2).executeTakeFirst();
    const map = readMap(setting?.settings);
    const wanted = /* @__PURE__ */ new Map();
    for (const item of items) {
      const slug = map[item.service_id];
      if (slug !== void 0 && !wanted.has(slug)) wanted.set(slug, item.service_id);
    }
    if (wanted.size === 0) return none;
    const forms = await tx.selectFrom("form").select(["id", "slug", "name"]).where("tenant_id", "=", tenantId).where("status", "=", "published").where("slug", "in", [...wanted.keys()]).execute();
    if (forms.length === 0) return none;
    const signedIds = /* @__PURE__ */ new Set();
    if (booking.customer_id !== null) {
      const subs = await tx.selectFrom("form_submission").select("form_id").distinct().where("tenant_id", "=", tenantId).where("customer_id", "=", booking.customer_id).where("status", "=", "complete").where("created_at", ">=", booking.created_at).where("form_id", "in", forms.map((f) => f.id)).execute();
      for (const s of subs) signedIds.add(s.form_id);
    }
    const query = booking.customer_id !== null ? `?customer=${encodeURIComponent(booking.customer_id)}` : "";
    const rows = forms.map((f) => ({
      slug: f.slug,
      name: f.name,
      serviceId: wanted.get(f.slug),
      signed: signedIds.has(f.id),
      link: `/f/${encodeURIComponent(f.slug)}${query}`
    }));
    return { bookingId, customerId: booking.customer_id, needed: rows.some((r) => !r.signed), forms: rows };
  });
}

// src/server/enabled.ts
function isDentalEnabled(tenantId) {
  return (0, import_server4.withTenantTx)(tenantId, (tx) => (0, import_server4.isPluginEnabled)(tx, DENTAL_PLUGIN_ID2));
}

// src/setup/data/forms.ts
var INTAKE_FORM_SLUG = "new-patient-intake";
var CONSENT_FORM_SLUG = "consent-to-treatment";
var BOOKING_FORM_SLUG = "book-an-appointment";
var BOOKING_THANKS = "You're booked! We sent a confirmation to your email.";
var FORM_THANKS = "Thank you. We have received your form.";
var field = (step, id, type, label, o = {}) => ({
  id,
  type,
  label,
  ph: "",
  help: "",
  req: false,
  w: "full",
  step,
  ...o
});
var base = (name, purpose, popupBtn, contacts, thanks = FORM_THANKS) => ({
  schemaVersion: 1,
  name,
  rules: [],
  after: {
    notify: "",
    route: false,
    bell: true,
    push: false,
    auto: false,
    autoSub: "",
    body: "",
    thanks,
    redirect: "",
    contacts
  },
  spam: { honey: true, speed: true, rate: true, dup: true, turn: false, otp: false },
  place: [],
  avail: { open: true, until: "", max: 0, closed: "Closed" },
  popupBtn,
  purpose,
  autos: []
});
var YES_NO = ["Yes", "No"];
var intakeFields = [
  field("about", "name", "name", "Full name", { req: true, w: "half", role: "name" }),
  field("about", "date_of_birth", "date", "Date of birth", { req: true, w: "half" }),
  field("about", "email", "email", "Email", { req: true, w: "half", role: "email" }),
  field("about", "phone", "phone", "Phone", { req: true, w: "half", role: "phone" }),
  field("about", "address", "address", "Home address", { role: "address" }),
  field("about", "visit_reason", "short", "What brings you in?", { ph: "For example: a check-up" }),
  field("history", "conditions", "check", "Do you have, or have you had, any of these health conditions?", {
    opts: [
      "Heart condition",
      "High blood pressure",
      "Low blood pressure",
      "Diabetes",
      "Asthma",
      "Epilepsy or seizures",
      "Bleeding disorder",
      "Hepatitis",
      "HIV or AIDS",
      "Kidney disease",
      "Liver disease",
      "Cancer or radiotherapy",
      "None of these"
    ]
  }),
  field("history", "allergies", "check", "Are you allergic to any of these?", {
    opts: ["Penicillin", "Latex", "Local anaesthetic (numbing injection)", "NSAID painkillers such as ibuprofen", "None of these"]
  }),
  field("history", "other_allergies", "short", "Any other allergies?", { help: "Write None if you have none." }),
  field("history", "medications", "long", "Medicines you take now", { help: "Include vitamins and supplements. Write None if you take none." }),
  field("history", "blood_thinners", "radio", "Do you take blood thinners (anticoagulants)?", { opts: YES_NO, req: true }),
  field("history", "bisphosphonates", "radio", "Do you take, or have you taken, bisphosphonate medicines for bone strength?", { opts: YES_NO, req: true }),
  field("more", "pregnant", "radio", "Are you pregnant?", { opts: ["No", "Yes", "Not applicable"], req: true }),
  field("more", "pregnancy_weeks", "short", "If you are pregnant, how many weeks?", { w: "half" }),
  field("more", "smoker", "radio", "Do you smoke or use tobacco or vapes?", { opts: YES_NO, req: true }),
  field("more", "dental_history", "long", "Previous dental problems or treatment", { help: "Write None if there is nothing to tell us." }),
  field("more", "health_notes", "long", "Anything else about your health we should know?"),
  field("emergency", "emergency_name", "short", "Emergency contact name", { req: true, w: "half" }),
  field("emergency", "emergency_phone", "short", "Emergency contact phone", { req: true, w: "half", ph: "(123) 456-7890" }),
  field("emergency", "confirm_true", "consent", "I confirm that the information I gave is true and complete.", { req: true })
];
var INTAKE_FORM = {
  slug: INTAKE_FORM_SLUG,
  name: "New patient intake and medical history",
  purpose: "intake",
  content: {
    ...base("New patient intake and medical history", "request", "Start intake", true),
    steps: [
      { id: "about", t: "About you" },
      { id: "history", t: "Health history", desc: "This helps us look after you safely. Tell us if anything changes later." },
      { id: "more", t: "A few more questions" },
      { id: "emergency", t: "Emergency contact and confirmation" }
    ],
    fields: intakeFields
  }
};
var CONSENT_FORM = {
  slug: CONSENT_FORM_SLUG,
  name: "Consent to treatment",
  purpose: "consent",
  content: {
    ...base("Consent to treatment", "blank", "Sign consent", false),
    steps: [
      { id: "patient", t: "Patient" },
      { id: "consent", t: "Consent and signature" }
    ],
    fields: [
      field("patient", "name", "name", "Full name", { req: true, role: "name" }),
      field("patient", "consent_date", "date", "Date", { req: true, w: "half" }),
      field("consent", "consent_info", "textimage", "About your treatment", {
        html: "<p><b>Consent to treatment</b></p><p>Your dentist has explained the proposed treatment, why it is suggested, what to expect, the possible risks and the alternatives, including having no treatment. You can ask questions at any time and you can change your mind before treatment starts.</p>"
      }),
      field("consent", "agree_explained", "consent", "The treatment, its risks and the alternatives were explained to me.", { req: true }),
      field("consent", "agree_questions", "consent", "I had the chance to ask questions and they were answered.", { req: true }),
      field("consent", "agree_treatment", "consent", "I agree to the treatment.", { req: true }),
      field("consent", "signature", "signature", "Patient signature", { req: true })
    ]
  }
};
var BOOKING_FORM = {
  slug: BOOKING_FORM_SLUG,
  name: "Book an appointment",
  purpose: "booking",
  content: {
    ...base("Book an appointment", "booking", "Book now", true, BOOKING_THANKS),
    confirm: "paid",
    steps: [
      { id: "service", t: "Service" },
      { id: "time", t: "Date & time" },
      { id: "you", t: "Your info" },
      { id: "review", t: "Review" },
      { id: "payment", t: "Payment" }
    ],
    fields: [
      field("service", "service", "service", "Which services?", { req: true, role: "service", disp: "cards", multi: true, ph: "Choose a service", prefill: "service" }),
      field("time", "slot", "slot", "Date & time", { req: true, role: "slot", hold: 10 }),
      field("you", "name", "name", "Full name", { req: true, w: "half", role: "name", ph: "John Doe" }),
      field("you", "email", "email", "Email", { req: true, role: "email", ph: "john@example.com" }),
      field("you", "phone", "phone", "Phone", { req: true, w: "half", role: "phone", ph: "(123) 456-7890" }),
      field("you", "sms", "consent", "I agree to receive appointment text messages.", { role: "sms", policy: "" }),
      field("you", "agree", "consent", "I agree to the Privacy Policy and Terms of Service", { req: true }),
      field("review", "summary", "summary", "Check your booking", { req: true }),
      field("payment", "payment", "payment", "Payment", { req: true, pay: { mode: "deposit", amountType: "fixed", amount: 20, refundHours: 24 } })
    ]
  }
};
var FORMS_PACK = [INTAKE_FORM, CONSENT_FORM, BOOKING_FORM];

// src/server/history/reminders.ts
var HISTORY_REVIEW_TASK = "dental_history_review";
var TEMPLATE = "dental.history_review";
var HELLO = "{{#if customer.name}}Hello {{customer.name}},\n\n{{/if}}";
var HISTORY_REVIEW_TEMPLATE = {
  key: TEMPLATE,
  label: "Medical history review",
  description: "Sent to a patient a few days before a visit when their medical history needs to be reviewed. It only carries the visit date and a link to the form, never any health details.",
  variables: ["customer.name", "business.name", "visit.date", "formUrl"],
  channels: {
    email: {
      subject: "Please review your medical history before your visit",
      body: `${HELLO}Please review your medical history before your visit on {{visit.date}}.{{#if formUrl}}

Open the form: {{formUrl}}{{/if}}`
    },
    sms: {
      body: "{{business.name}}: please review your medical history before your visit on {{visit.date}}.{{#if formUrl}} Form: {{formUrl}}{{/if}}"
    }
  }
};
var WINDOW_DAYS = 3;
var BATCH = 100;
var MAX_BATCHES = 50;
var appUrlConfig = import_plugin_sdk4.z.object({ APP_URL: import_plugin_sdk4.z.url().default("http://localhost:3000") });
async function intakeLink(tx, tenantId) {
  const forms = await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).where("status", "=", "published").where("purpose", "=", "intake").orderBy("created_at").execute();
  if (forms.length === 0) return null;
  let slug = forms.find((f) => f.slug === INTAKE_FORM_SLUG)?.slug;
  if (slug === void 0) {
    const tenant = await tx.selectFrom("tenant").select("settings").where("id", "=", tenantId).executeTakeFirst();
    const settings = tenant?.settings;
    const hasHistory = await dentalDb(tx).selectFrom("plg_dental_medical_history").select("customer_id").where("tenant_id", "=", tenantId).limit(1).executeTakeFirst();
    if (settings?.businessType === "dental" || hasHistory) slug = forms[0]?.slug;
  }
  if (slug === void 0) return null;
  return `${(0, import_server5.readConfig)(appUrlConfig).APP_URL.replace(/\/+$/, "")}/f/${encodeURIComponent(slug)}`;
}
function visitDate(ms, timeZone, locale) {
  const options = { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone };
  try {
    return new Intl.DateTimeFormat(locale, options).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(ms);
  }
}
async function queueReminders(tx, row, formUrl) {
  const vars = {
    customer: { name: row.display_name, firstName: row.display_name.split(/\s+/)[0] ?? row.display_name },
    visit: { date: visitDate(row.starts_at.getTime(), row.time_zone, row.locale) },
    formUrl
  };
  let queued = 0;
  for (const [channel, to] of [["email", row.email], ["sms", row.phone]]) {
    if (!to || to.trim() === "") continue;
    const result = await (0, import_server5.queueMessage)(tx, {
      template: TEMPLATE,
      channel,
      to: to.trim(),
      vars,
      customerId: row.customer_id,
      bookingId: row.booking_id,
      locationId: row.location_id,
      idempotencyKey: `dental.history_review:${row.customer_id}:${row.booking_id}:${channel}`
    });
    if (result.status === "queued") queued += 1;
  }
  return queued;
}
async function processTenantHistoryReviews(tenantId) {
  const totals = { visits: 0, messages: 0 };
  const formUrl = await (0, import_server5.withTenantTx)(tenantId, (tx) => intakeLink(tx, tenantId));
  if (formUrl === null) return totals;
  let after = null;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const cursor = after;
    const rows = await (0, import_server5.withTenantTx)(tenantId, async (tx) => {
      const found = await import_server5.sql`
        select b.id as booking_id, b.customer_id, b.location_id, b.starts_at, b.starts_at::text as starts_at_raw,
          c.display_name, c.email, c.phone, l.time_zone, coalesce(c.locale, l.locale) as locale
        from booking b
        join customer c on c.tenant_id = b.tenant_id and c.id = b.customer_id
        join location l on l.tenant_id = b.tenant_id and l.id = b.location_id
        left join plg_dental_medical_history h on h.tenant_id = b.tenant_id and h.customer_id = b.customer_id
        where b.tenant_id = ${tenantId} and b.customer_id is not null and b.status in ('requested', 'confirmed')
          and b.starts_at > now() and b.starts_at <= now() + make_interval(days => ${WINDOW_DAYS}::int)
          and (h.customer_id is null or h.review_due_at is null or h.review_due_at <= b.starts_at)
          ${cursor ? import_server5.sql`and (b.starts_at, b.id) > (${cursor.startsAt}::timestamptz, ${cursor.bookingId}::uuid)` : import_server5.sql``}
        order by b.starts_at, b.id
        limit ${BATCH}`.execute(tx);
      for (const row of found.rows) {
        totals.visits += 1;
        totals.messages += await queueReminders(tx, row, formUrl);
      }
      return found.rows;
    });
    const last = rows[rows.length - 1];
    if (!last || rows.length < BATCH) break;
    after = { startsAt: last.starts_at_raw, bookingId: last.booking_id };
  }
  return totals;
}
async function runHistoryReviewDaily() {
  const tenants = await (0, import_server5.withPlatformTx)(async (tx) => {
    const found = await import_server5.sql`
      select distinct b.tenant_id
      from booking b
      join tenant t on t.id = b.tenant_id and t.status = 'active'
      where b.customer_id is not null and b.status in ('requested', 'confirmed')
        and b.starts_at > now() and b.starts_at <= now() + make_interval(days => ${WINDOW_DAYS}::int)
        and exists (select 1 from form f where f.tenant_id = b.tenant_id and f.status = 'published' and f.purpose = 'intake')`.execute(tx);
    return found.rows.map((row) => row.tenant_id);
  });
  let messages = 0;
  let checked = 0;
  for (const tenantId of tenants) {
    try {
      if (!await isDentalEnabled(tenantId)) continue;
      checked += 1;
      messages += (await processTenantHistoryReviews(tenantId)).messages;
    } catch (err) {
      console.error(`[dental] history review reminders failed for tenant ${tenantId}`, err);
    }
  }
  return { tenants: checked, messages };
}

// src/server/history/history.ts
var import_server6 = require("@appointit/plugin-sdk/server");
var import_plugin_sdk6 = require("@appointit/plugin-sdk");

// src/server/history/schema.ts
var import_plugin_sdk5 = require("@appointit/plugin-sdk");
var text = (max) => import_plugin_sdk5.z.string().trim().max(max).default("");
var flag = import_plugin_sdk5.z.boolean().default(false);
var list = (maxItems, maxLen) => import_plugin_sdk5.z.array(import_plugin_sdk5.z.string().trim().min(1).max(maxLen)).max(maxItems).default([]);
var conditionsSchema = import_plugin_sdk5.z.object({
  heartDisease: flag,
  highBloodPressure: flag,
  lowBloodPressure: flag,
  diabetes: flag,
  asthma: flag,
  epilepsy: flag,
  bleedingDisorder: flag,
  hepatitis: flag,
  hiv: flag,
  kidneyDisease: flag,
  liverDisease: flag,
  cancerRadiotherapy: flag,
  other: text(2e3)
});
var allergiesSchema = import_plugin_sdk5.z.object({
  penicillin: flag,
  latex: flag,
  localAnaesthetic: flag,
  nsaids: flag,
  other: text(2e3)
});
var pregnancySchema = import_plugin_sdk5.z.object({
  pregnant: flag,
  weeks: import_plugin_sdk5.z.number().int().min(0).max(45).nullable().default(null)
});
var historyDocumentSchema = import_plugin_sdk5.z.object({
  schemaVersion: import_plugin_sdk5.z.literal(1).default(1),
  conditions: conditionsSchema.default(() => conditionsSchema.parse({})),
  medications: list(100, 200),
  allergies: allergiesSchema.default(() => allergiesSchema.parse({})),
  pregnancy: pregnancySchema.default(() => pregnancySchema.parse({})),
  smoker: flag,
  anticoagulants: flag,
  bisphosphonates: flag,
  previousDentalIssues: text(4e3),
  notes: text(8e3),
  /** Alerts staff add by hand; shown next to the computed ones. */
  manualAlerts: list(20, 200)
});
var CONDITION_KEYS = [
  "heartDisease",
  "highBloodPressure",
  "lowBloodPressure",
  "diabetes",
  "asthma",
  "epilepsy",
  "bleedingDisorder",
  "hepatitis",
  "hiv",
  "kidneyDisease",
  "liverDisease",
  "cancerRadiotherapy"
];
var ALLERGY_KEYS = ["penicillin", "latex", "localAnaesthetic", "nsaids"];
function emptyHistory() {
  return historyDocumentSchema.parse({});
}
var ALLERGY_LABELS = {
  penicillin: "Allergy: penicillin",
  latex: "Allergy: latex",
  localAnaesthetic: "Allergy: local anaesthetic",
  nsaids: "Allergy: NSAIDs"
};
function computeAlerts(doc) {
  const out = [];
  for (const key of ALLERGY_KEYS) if (doc.allergies[key]) out.push({ code: `allergy_${key}`, label: ALLERGY_LABELS[key] });
  if (doc.allergies.other) out.push({ code: "allergy_other", label: `Allergy: ${doc.allergies.other}` });
  if (doc.anticoagulants) out.push({ code: "anticoagulants", label: "Takes anticoagulants" });
  if (doc.bisphosphonates) out.push({ code: "bisphosphonates", label: "Takes bisphosphonates" });
  if (doc.conditions.bleedingDisorder) out.push({ code: "bleeding_disorder", label: "Bleeding disorder" });
  if (doc.conditions.heartDisease) out.push({ code: "heart_condition", label: "Heart condition" });
  if (doc.pregnancy.pregnant) {
    out.push({ code: "pregnancy", label: doc.pregnancy.weeks ? `Pregnant (${doc.pregnancy.weeks} weeks)` : "Pregnant" });
  }
  for (const manual of doc.manualAlerts) out.push({ code: "manual", label: manual });
  return out;
}
function changedSections(before, after) {
  const keys = Object.keys(after);
  return keys.filter((k) => k !== "schemaVersion" && JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

// src/server/history/intake-mapping.ts
var SKIP_TYPES = /* @__PURE__ */ new Set([
  "heading",
  "divider",
  "consent",
  "signature",
  "name",
  "email",
  "phone",
  "address",
  "verify",
  "payment",
  "summary",
  "total",
  "hidden",
  "photo",
  "picture",
  "slot",
  "service",
  "coupon",
  "estimate",
  "addons",
  "map"
]);
var FLAG_PATTERNS = [
  ["heartDisease", /\bheart|cardiac|angina|pacemaker/],
  ["highBloodPressure", /high blood pressure|hypertens/],
  ["lowBloodPressure", /low blood pressure|hypotens/],
  ["diabetes", /diabet/],
  ["asthma", /asthma/],
  ["epilepsy", /epilep|seizure|fits\b/],
  ["bleedingDisorder", /bleed|h(a)?emophil|clotting/],
  ["hepatitis", /hepatitis/],
  ["hiv", /\bhiv\b|\baids\b/],
  ["kidneyDisease", /kidney|renal/],
  ["liverDisease", /liver/],
  ["cancerRadiotherapy", /cancer|radiotherap|chemo|tumou?r/],
  ["pregnant", /pregnan/],
  ["smoker", /smok|tobacco|cigarette|vap(e|ing)/],
  ["anticoagulants", /blood thinner|anticoag|warfarin|clopidogrel|apixaban|rivaroxaban|heparin/],
  ["bisphosphonates", /bisphosphonate|alendron|zoledron|risedron|ibandron|fosamax/]
];
var ALLERGEN_PATTERNS = [
  ["penicillin", /penicillin|amoxicillin/],
  ["latex", /latex|rubber/],
  ["localAnaesthetic", /an(a)?esthe|numbing|lidocaine|lignocaine|novocain/],
  ["nsaids", /nsaid|ibuprofen|aspirin|diclofenac|naproxen/]
];
var NEGATIVE = /^(no|none|nil|n\/a|na|not applicable|nope|false|never|-+)(?![a-z0-9])/i;
var POSITIVE = /^(yes|y|true|yep|yeah|1)\b/i;
function normalise(s) {
  return s.toLowerCase().replace(/[^a-z0-9/&+\-\s]/g, " ").replace(/\s+/g, " ").trim();
}
function answerParts(value) {
  if (value === null || value === void 0) return [];
  if (Array.isArray(value)) return value.flatMap(answerParts);
  if (typeof value === "boolean") return [value ? "Yes" : "No"];
  if (typeof value === "number") return [String(value)];
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? [] : [t];
  }
  return [];
}
function isNegative(parts) {
  return parts.length > 0 && parts.every((p2) => NEGATIVE.test(p2.trim()));
}
function meansYes(parts) {
  if (parts.length === 0 || isNegative(parts)) return false;
  return parts.some((p2) => POSITIVE.test(p2.trim())) || parts.some((p2) => p2.trim().length > 0 && !NEGATIVE.test(p2.trim()));
}
function isYesNoAnswer(parts) {
  return parts.length === 1 && (POSITIVE.test(parts[0].trim()) || NEGATIVE.test(parts[0].trim()));
}
function splitList(parts) {
  return parts.flatMap((p2) => p2.split(/[\n,;]+|\band\b/i)).map((p2) => p2.trim()).filter((p2) => p2 !== "" && !NEGATIVE.test(p2));
}
function setFlag(doc, flag2) {
  if (flag2 === "pregnant") doc.pregnancy.pregnant = true;
  else if (flag2 === "smoker") doc.smoker = true;
  else if (flag2 === "anticoagulants") doc.anticoagulants = true;
  else if (flag2 === "bisphosphonates") doc.bisphosphonates = true;
  else doc.conditions[flag2] = true;
}
function addOther(current, extra) {
  const e = extra.trim();
  if (!e) return current;
  if (current.toLowerCase().includes(e.toLowerCase())) return current;
  return current ? `${current}; ${e}` : e;
}
function mapIntakeAnswers(fields, answers) {
  const doc = emptyHistory();
  const mapped = /* @__PURE__ */ new Set();
  const noteLines = [];
  for (const field2 of fields) {
    if (field2.type && SKIP_TYPES.has(field2.type)) continue;
    const parts = answerParts(answers[field2.id]);
    if (parts.length === 0) continue;
    const label = (field2.label ?? "").trim();
    const key = /^[A-Za-z_]+$/.test(field2.id) ? field2.id.replace(/_/g, " ") : "";
    const q = normalise(`${label} ${key}`);
    const joined = parts.join(", ");
    if (/allerg/.test(q)) {
      if (isNegative(parts)) continue;
      const fromLabel = ALLERGEN_PATTERNS.filter(([, re]) => re.test(q));
      if (isYesNoAnswer(parts) && fromLabel.length > 0) {
        if (meansYes(parts)) {
          for (const [k] of fromLabel) doc.allergies[k] = true;
          mapped.add("allergies");
        }
        continue;
      }
      const leftovers = [];
      let touched = false;
      for (const item of splitList(parts)) {
        const hit2 = ALLERGEN_PATTERNS.find(([, re]) => re.test(normalise(item)));
        if (hit2) {
          doc.allergies[hit2[0]] = true;
          touched = true;
        } else if (!isYesNoAnswer([item])) leftovers.push(item);
      }
      if (leftovers.length > 0) {
        doc.allergies.other = addOther(doc.allergies.other, leftovers.join(", "));
        touched = true;
      }
      if (touched) mapped.add("allergies");
      continue;
    }
    if (/medic|tablet|drug|prescription/.test(q) && !FLAG_PATTERNS.some(([, re]) => re.test(q))) {
      if (isNegative(parts)) continue;
      if (isYesNoAnswer(parts)) continue;
      for (const m of splitList(parts)) if (!doc.medications.some((x) => x.toLowerCase() === m.toLowerCase())) doc.medications.push(m);
      mapped.add("medications");
      continue;
    }
    if (/(previous|past|prior|history).*(dental|tooth|teeth)|dental (history|problem|issue|treatment)/.test(q)) {
      if (isNegative(parts)) continue;
      doc.previousDentalIssues = addOther(doc.previousDentalIssues, joined);
      mapped.add("previousDentalIssues");
      continue;
    }
    if (/pregnan/.test(q) && /week/.test(`${q} ${normalise(joined)}`)) {
      const n = /(\d{1,2})/.exec(joined);
      if (n) {
        const weeks = Number(n[1]);
        if (weeks > 0 && weeks <= 45) {
          doc.pregnancy.pregnant = true;
          doc.pregnancy.weeks = weeks;
          mapped.add("pregnancy");
          continue;
        }
      }
    }
    const isChoice = field2.type === "check" || Array.isArray(answers[field2.id]);
    if (isChoice && /condition|illness|disease|suffer|medical|health|problem/.test(q)) {
      const unknown = [];
      for (const item of parts) {
        const nq = normalise(item);
        const hit2 = FLAG_PATTERNS.find(([, re]) => re.test(nq));
        if (hit2) {
          setFlag(doc, hit2[0]);
          mapped.add(hit2[0] === "pregnant" ? "pregnancy" : hit2[0] === "smoker" || hit2[0] === "anticoagulants" || hit2[0] === "bisphosphonates" ? hit2[0] : "conditions");
        } else if (!NEGATIVE.test(item.trim())) {
          unknown.push(item);
        }
      }
      if (unknown.length > 0) {
        doc.conditions.other = addOther(doc.conditions.other, unknown.join(", "));
        mapped.add("conditions");
      }
      continue;
    }
    const hit = FLAG_PATTERNS.find(([, re]) => re.test(q));
    if (hit) {
      if (meansYes(parts)) {
        setFlag(doc, hit[0]);
        mapped.add(hit[0] === "pregnant" ? "pregnancy" : hit[0] === "smoker" || hit[0] === "anticoagulants" || hit[0] === "bisphosphonates" ? hit[0] : "conditions");
        if (!isYesNoAnswer(parts) && parts.join(" ").length > 3) noteLines.push(`Intake - ${label || field2.id}: ${joined}`);
      }
      continue;
    }
    if (!isNegative(parts)) noteLines.push(`Intake - ${label || field2.id}: ${joined}`);
  }
  if (noteLines.length > 0) {
    doc.notes = noteLines.join("\n").slice(0, 8e3);
    mapped.add("notes");
  }
  const unmapped = noteLines.length;
  return { document: doc, mappedSections: [...mapped].sort(), unmapped };
}
function union(a, b) {
  const out = [...a];
  for (const item of b) if (!out.some((x) => x.toLowerCase() === item.toLowerCase())) out.push(item);
  return out;
}
function appendBlock(current, extra, max) {
  const e = extra.trim();
  if (!e) return current;
  const lines = current.split("\n");
  const fresh = e.split("\n").filter((l) => !lines.includes(l));
  if (fresh.length === 0) return current;
  return (current ? `${current}
${fresh.join("\n")}` : fresh.join("\n")).slice(0, max);
}
function mergeImported(existing, imported) {
  const out = structuredClone(existing);
  for (const k of CONDITION_KEYS) if (imported.conditions[k]) out.conditions[k] = true;
  out.conditions.other = addOther(out.conditions.other, imported.conditions.other);
  for (const k of ALLERGY_KEYS) if (imported.allergies[k]) out.allergies[k] = true;
  out.allergies.other = addOther(out.allergies.other, imported.allergies.other);
  out.medications = union(out.medications, imported.medications).slice(0, 100);
  if (imported.pregnancy.pregnant) out.pregnancy.pregnant = true;
  if (imported.pregnancy.weeks !== null) out.pregnancy.weeks = imported.pregnancy.weeks;
  if (imported.smoker) out.smoker = true;
  if (imported.anticoagulants) out.anticoagulants = true;
  if (imported.bisphosphonates) out.bisphosphonates = true;
  out.previousDentalIssues = addOther(out.previousDentalIssues, imported.previousDentalIssues).slice(0, 4e3);
  out.notes = appendBlock(out.notes, imported.notes, 8e3);
  return out;
}

// src/server/history/history.ts
var DEFAULT_REVIEW_MONTHS = 12;
async function reviewMonths(tx, tenantId) {
  const row = await tx.selectFrom("plugin_setting").select("settings").where("tenant_id", "=", tenantId).where("plugin_id", "=", "appointit.vertical-dental").executeTakeFirst();
  const settings = row?.settings;
  const value = typeof settings === "object" && settings !== null && !Array.isArray(settings) ? settings.historyReviewMonths : void 0;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 120 ? value : DEFAULT_REVIEW_MONTHS;
}
var dataContext = (tenantId, customerId) => ({ tenantId, field: `plg_dental_medical_history.data:${customerId}` });
var alertsContext = (tenantId, customerId) => ({ tenantId, field: `plg_dental_medical_history.alerts:${customerId}` });
function withoutIdempotency(ctx) {
  const { idempotencyKey: _dropped, ...rest } = ctx;
  return rest;
}
async function assertCustomer(tx, tenantId, customerId) {
  const found = await tx.selectFrom("customer").select("id").where("tenant_id", "=", tenantId).where("id", "=", customerId).executeTakeFirst();
  if (!found) throw new import_server6.AppError("NOT_FOUND", "Patient not found");
}
async function loadRow(tx, tenantId, customerId, lock = false) {
  const query = dentalDb(tx).selectFrom("plg_dental_medical_history").select(["data_enc", "alerts_enc", "has_alerts", "reviewed_at", "review_due_at", "source_submission_id", "version", "updated_at"]).where("tenant_id", "=", tenantId).where("customer_id", "=", customerId);
  return (lock ? query.forUpdate() : query).executeTakeFirst();
}
async function openDocument(scope, customerId, row, why) {
  const tenantId = scope.ctx.tenantId;
  await scope.audit({ action: "health.read", targetType: "customer", targetId: customerId, changes: { resource: "dental.medical_history", why } });
  const json = (0, import_server6.decryptField)(row.data_enc, dataContext(tenantId, customerId));
  return historyDocumentSchema.parse(JSON.parse(json));
}
function toDto3(customerId, row, document) {
  const alerts = computeAlerts(document);
  const dueAt = row?.review_due_at ?? null;
  return {
    customerId,
    exists: row !== void 0,
    version: row?.version ?? 0,
    document,
    alerts,
    hasAlerts: alerts.length > 0,
    reviewedAt: row?.reviewed_at?.toISOString() ?? null,
    reviewDueAt: dueAt?.toISOString() ?? null,
    reviewDue: row === void 0 || dueAt === null || dueAt.getTime() <= Date.now(),
    sourceSubmissionId: row?.source_submission_id ?? null,
    updatedAt: row?.updated_at.toISOString() ?? null
  };
}
var getHistoryCommand = (0, import_server6.defineCommand)({
  name: "dental.history.get",
  input: import_plugin_sdk6.z.object({ customerId: import_plugin_sdk6.z.uuid() }),
  authorize: (0, import_server6.requirePermission)("health.read"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    await assertCustomer(tx, tenantId, input.customerId);
    const row = await loadRow(tx, tenantId, input.customerId);
    if (!row) {
      await scope.audit({ action: "health.read", targetType: "customer", targetId: input.customerId, changes: { resource: "dental.medical_history", why: "view" } });
      return toDto3(input.customerId, void 0, emptyHistory());
    }
    const document = await openDocument(scope, input.customerId, row, "view");
    return toDto3(input.customerId, row, document);
  }
});
function getHistory(ctx, customerId) {
  return getHistoryCommand.run(withoutIdempotency(ctx), { customerId });
}
async function persist(tx, scope, p2) {
  const tenantId = scope.ctx.tenantId;
  const alerts = computeAlerts(p2.document);
  const dataEnc = (0, import_server6.encryptField)(JSON.stringify(p2.document), dataContext(tenantId, p2.customerId));
  const alertsEnc = alerts.length > 0 ? (0, import_server6.encryptField)(JSON.stringify(alerts), alertsContext(tenantId, p2.customerId)) : null;
  const interval = import_server6.sql`now() + make_interval(months => ${await reviewMonths(tx, tenantId)}::int)`;
  const now = import_server6.sql`now()`;
  const actor = scope.ctx.actor.id ?? null;
  if (!p2.row) {
    return dentalDb(tx).insertInto("plg_dental_medical_history").values({
      tenant_id: tenantId,
      customer_id: p2.customerId,
      data_enc: dataEnc,
      alerts_enc: alertsEnc,
      has_alerts: alerts.length > 0,
      reviewed_at: p2.markReviewed ? now : null,
      // A first record is due for review until someone confirms it with the patient.
      review_due_at: p2.markReviewed ? interval : now,
      source_submission_id: p2.sourceSubmissionId ?? null,
      updated_by: actor
    }).returning(["version", "has_alerts", "reviewed_at", "review_due_at"]).executeTakeFirstOrThrow();
  }
  return dentalDb(tx).updateTable("plg_dental_medical_history").set({
    data_enc: dataEnc,
    alerts_enc: alertsEnc,
    has_alerts: alerts.length > 0,
    ...p2.markReviewed && { reviewed_at: now, review_due_at: interval },
    ...p2.sourceSubmissionId !== void 0 && { source_submission_id: p2.sourceSubmissionId },
    updated_by: actor,
    version: p2.row.version + 1
  }).where("tenant_id", "=", tenantId).where("customer_id", "=", p2.customerId).returning(["version", "has_alerts", "reviewed_at", "review_due_at"]).executeTakeFirstOrThrow();
}
var saveHistoryCommand = (0, import_server6.defineCommand)({
  name: "dental.history.save",
  input: import_plugin_sdk6.z.object({
    customerId: import_plugin_sdk6.z.uuid(),
    /** The version you loaded; 0 when the patient has no record yet. */
    expectedVersion: import_plugin_sdk6.z.number().int().min(0),
    document: historyDocumentSchema,
    /** Also confirm the history with the patient today (the review due date moves on by the review period, 12 months by default). */
    markReviewed: import_plugin_sdk6.z.boolean().default(false)
  }),
  authorize: (0, import_server6.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    await assertCustomer(tx, tenantId, input.customerId);
    const row = await loadRow(tx, tenantId, input.customerId, true);
    if ((row?.version ?? 0) !== input.expectedVersion) {
      throw new import_server6.AppError("VERSION_CONFLICT", "This history was changed by someone else", { currentVersion: row?.version ?? 0 });
    }
    const before = row ? await openDocument(scope, input.customerId, row, "diff") : emptyHistory();
    const saved = await persist(tx, scope, {
      customerId: input.customerId,
      row,
      document: input.document,
      markReviewed: input.markReviewed
    });
    await scope.audit({
      action: "dental.history.save",
      targetType: "customer",
      targetId: input.customerId,
      targetVersion: saved.version,
      changes: { fields: changedSections(before, input.document), reviewed: input.markReviewed }
    });
    return {
      customerId: input.customerId,
      version: saved.version,
      hasAlerts: saved.has_alerts,
      reviewedAt: saved.reviewed_at?.toISOString() ?? null,
      reviewDueAt: saved.review_due_at?.toISOString() ?? null
    };
  }
});
function saveHistory(ctx, input) {
  return saveHistoryCommand.run(ctx, input);
}
var importCommand = (0, import_server6.defineCommand)({
  name: "dental.history.import",
  input: import_plugin_sdk6.z.object({ customerId: import_plugin_sdk6.z.uuid(), submissionId: import_plugin_sdk6.z.uuid() }),
  authorize: (0, import_server6.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    await assertCustomer(tx, tenantId, input.customerId);
    const submission = await tx.selectFrom("form_submission").innerJoin("form", (j) => j.onRef("form.tenant_id", "=", "form_submission.tenant_id").onRef("form.id", "=", "form_submission.form_id")).select(["form_submission.answers as answers", "form_submission.answers_enc as answersEnc", "form_submission.form_id as formId", "form_submission.form_version as formVersion", "form.purpose as purpose"]).where("form_submission.tenant_id", "=", tenantId).where("form_submission.id", "=", input.submissionId).where("form_submission.customer_id", "=", input.customerId).where("form_submission.status", "=", "complete").executeTakeFirst();
    if (!submission || submission.purpose !== "intake") throw new import_server6.AppError("NOT_FOUND", "Intake submission not found for this patient");
    const version = await tx.selectFrom("form_version").select("doc").where("tenant_id", "=", tenantId).where("form_id", "=", submission.formId).where("version", "=", submission.formVersion).executeTakeFirst();
    const doc = version?.doc ?? {};
    const fields = Array.isArray(doc.fields) ? doc.fields.filter((f) => typeof f === "object" && f !== null && typeof f.id === "string") : [];
    let answers = typeof submission.answers === "object" && submission.answers !== null && !Array.isArray(submission.answers) ? submission.answers : {};
    if (submission.answersEnc !== null) {
      await scope.audit({ action: "health.read", targetType: "form_submission", targetId: input.submissionId, changes: { resource: "form.submission", why: "import" } });
      answers = (0, import_server6.openAnswers)(tenantId, input.submissionId, submission.answersEnc);
    }
    const imported = mapIntakeAnswers(fields, answers);
    const row = await loadRow(tx, tenantId, input.customerId, true);
    const before = row ? await openDocument(scope, input.customerId, row, "import") : emptyHistory();
    const merged = mergeImported(before, imported.document);
    const saved = await persist(tx, scope, {
      customerId: input.customerId,
      row,
      document: merged,
      markReviewed: false,
      sourceSubmissionId: input.submissionId
    });
    await scope.audit({
      action: "dental.history.import",
      targetType: "customer",
      targetId: input.customerId,
      targetVersion: saved.version,
      changes: { fields: changedSections(before, merged), submissionId: input.submissionId, unmapped: imported.unmapped }
    });
    return {
      customerId: input.customerId,
      version: saved.version,
      hasAlerts: saved.has_alerts,
      importedSections: imported.mappedSections,
      unmapped: imported.unmapped
    };
  }
});
function importFromSubmission(ctx, input) {
  return importCommand.run(ctx, input);
}
async function listIntakeSubmissions(ctx, customerId) {
  (0, import_server6.requirePermission)("health.read")(ctx);
  const z_ = import_plugin_sdk6.z.uuid().safeParse(customerId);
  if (!z_.success) throw new import_server6.AppError("INVALID_INPUT", "Invalid patient id");
  const rows = await (0, import_server6.withTenantTx)(
    ctx.tenantId,
    (tx) => tx.selectFrom("form_submission").innerJoin("form", (j) => j.onRef("form.tenant_id", "=", "form_submission.tenant_id").onRef("form.id", "=", "form_submission.form_id")).select(["form_submission.id as id", "form.id as formId", "form.name as formName", "form_submission.created_at as createdAt"]).where("form_submission.tenant_id", "=", ctx.tenantId).where("form_submission.customer_id", "=", customerId).where("form_submission.status", "=", "complete").where("form.purpose", "=", "intake").orderBy("form_submission.created_at", "desc").orderBy("form_submission.id", "desc").limit(50).execute()
  );
  return rows.map((r) => ({ id: r.id, formId: r.formId, formName: r.formName, createdAt: r.createdAt.toISOString() }));
}
var listAlertsCommand = (0, import_server6.defineCommand)({
  name: "dental.alerts.list",
  input: import_plugin_sdk6.z.object({ customerIds: import_plugin_sdk6.z.array(import_plugin_sdk6.z.uuid()).max(200) }),
  authorize: (0, import_server6.requirePermission)("bookings.read"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const ids = [...new Set(input.customerIds)];
    if (ids.length === 0) return [];
    const canRead2 = scope.ctx.permissions?.has("health.read") === true;
    const rows = await dentalDb(tx).selectFrom("plg_dental_medical_history").select(["customer_id", "has_alerts", "alerts_enc", "review_due_at"]).where("tenant_id", "=", tenantId).where("customer_id", "in", ids).execute();
    const byId = new Map(rows.map((r) => [r.customer_id, r]));
    const out = [];
    for (const customerId of ids) {
      const row = byId.get(customerId);
      if (!row) {
        out.push({ customerId, hasAlerts: false, historyMissing: true, reviewDueAt: null });
        continue;
      }
      const review = { historyMissing: false, reviewDueAt: row.review_due_at?.toISOString() ?? null };
      if (!row.has_alerts) {
        out.push({ customerId, hasAlerts: false, ...review });
        continue;
      }
      if (!canRead2 || !row.alerts_enc) {
        out.push({ customerId, hasAlerts: true, ...review });
        continue;
      }
      await scope.audit({ action: "health.read", targetType: "customer", targetId: customerId, changes: { resource: "dental.alerts" } });
      const alerts = JSON.parse((0, import_server6.decryptField)(row.alerts_enc, alertsContext(tenantId, customerId)));
      out.push({ customerId, hasAlerts: true, labels: alerts.map((a) => a.label), ...review });
    }
    return out;
  }
});
function listAlerts(ctx, customerIds) {
  return listAlertsCommand.run(withoutIdempotency(ctx), { customerIds });
}

// src/server/history/insurance.ts
var import_server7 = require("@appointit/plugin-sdk/server");
var import_plugin_sdk7 = require("@appointit/plugin-sdk");
var INSURANCE_RELATIONSHIPS = ["self", "spouse", "child", "parent", "other"];
var memberContext = (tenantId, id) => ({ tenantId, field: `plg_dental_insurance.member_id:${id}` });
var optionalText = (max) => import_plugin_sdk7.z.string().trim().max(max).nullish();
var fieldsShape = {
  carrier: import_plugin_sdk7.z.string().trim().min(1).max(200),
  /** Plain text in, encrypted at rest. Empty or null clears it. */
  memberId: optionalText(100),
  groupNumber: optionalText(100),
  subscriberName: optionalText(200),
  subscriberRelationship: import_plugin_sdk7.z.enum(INSURANCE_RELATIONSHIPS).nullish(),
  isPrimary: import_plugin_sdk7.z.boolean().optional(),
  validTo: import_plugin_sdk7.z.iso.date().nullish()
};
var blankToNull = (v) => v === void 0 || v === null || v.trim() === "" ? null : v.trim();
var listCommand = (0, import_server7.defineCommand)({
  name: "dental.insurance.list",
  input: import_plugin_sdk7.z.object({ customerId: import_plugin_sdk7.z.uuid() }),
  authorize: (0, import_server7.requirePermission)("health.read"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const rows = await dentalDb(tx).selectFrom("plg_dental_insurance").select([
      "id",
      "customer_id",
      "carrier",
      "member_id_enc",
      "group_number",
      "subscriber_name",
      "subscriber_relationship",
      "is_primary",
      import_server7.sql`to_char(valid_to, 'YYYY-MM-DD')`.as("valid_to"),
      "version"
    ]).where("tenant_id", "=", tenantId).where("customer_id", "=", input.customerId).orderBy("is_primary", "desc").orderBy("created_at").orderBy("id").execute();
    const withMember = rows.filter((r) => r.member_id_enc !== null).length;
    if (withMember > 0) {
      await scope.audit({
        action: "health.read",
        targetType: "customer",
        targetId: input.customerId,
        changes: { resource: "dental.insurance", count: withMember }
      });
    }
    return rows.map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      carrier: r.carrier,
      memberId: r.member_id_enc ? (0, import_server7.decryptField)(r.member_id_enc, memberContext(tenantId, r.id)) : null,
      groupNumber: r.group_number,
      subscriberName: r.subscriber_name,
      subscriberRelationship: r.subscriber_relationship,
      isPrimary: r.is_primary,
      validTo: r.valid_to,
      version: r.version
    }));
  }
});
function listInsurance(ctx, customerId) {
  const { idempotencyKey: _dropped, ...plain } = ctx;
  return listCommand.run(plain, { customerId });
}
async function clearOtherPrimaries(tx, tenantId, customerId, keepId) {
  await dentalDb(tx).updateTable("plg_dental_insurance").set({ is_primary: false }).where("tenant_id", "=", tenantId).where("customer_id", "=", customerId).where("id", "!=", keepId).where("is_primary", "=", true).execute();
}
var createInsuranceCommand = (0, import_server7.defineCommand)({
  name: "dental.insurance.create",
  input: import_plugin_sdk7.z.object({ customerId: import_plugin_sdk7.z.uuid(), ...fieldsShape }),
  authorize: (0, import_server7.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const customer = await tx.selectFrom("customer").select("id").where("tenant_id", "=", tenantId).where("id", "=", input.customerId).executeTakeFirst();
    if (!customer) throw new import_server7.AppError("NOT_FOUND", "Patient not found");
    const existing = await dentalDb(tx).selectFrom("plg_dental_insurance").select("id").where("tenant_id", "=", tenantId).where("customer_id", "=", input.customerId).limit(1).executeTakeFirst();
    const id = (0, import_server7.uuidv7)();
    const memberId = blankToNull(input.memberId);
    const isPrimary = input.isPrimary ?? existing === void 0;
    const row = await dentalDb(tx).insertInto("plg_dental_insurance").values({
      tenant_id: tenantId,
      id,
      customer_id: input.customerId,
      carrier: input.carrier,
      member_id_enc: memberId === null ? null : (0, import_server7.encryptField)(memberId, memberContext(tenantId, id)),
      group_number: blankToNull(input.groupNumber),
      subscriber_name: blankToNull(input.subscriberName),
      subscriber_relationship: input.subscriberRelationship ?? null,
      is_primary: isPrimary,
      valid_to: input.validTo ?? null
    }).returning(["id", "version"]).executeTakeFirstOrThrow();
    if (isPrimary) await clearOtherPrimaries(tx, tenantId, input.customerId, id);
    await scope.audit({
      action: "dental.insurance.create",
      targetType: "customer",
      targetId: input.customerId,
      changes: { insuranceId: id, fields: ["carrier", ...memberId !== null ? ["memberId"] : []] }
    });
    return row;
  }
});
var updateInsuranceCommand = (0, import_server7.defineCommand)({
  name: "dental.insurance.update",
  input: import_plugin_sdk7.z.object({
    id: import_plugin_sdk7.z.uuid(),
    expectedVersion: import_plugin_sdk7.z.number().int().min(1),
    carrier: fieldsShape.carrier.optional(),
    memberId: fieldsShape.memberId,
    groupNumber: fieldsShape.groupNumber,
    subscriberName: fieldsShape.subscriberName,
    subscriberRelationship: fieldsShape.subscriberRelationship,
    isPrimary: fieldsShape.isPrimary,
    validTo: fieldsShape.validTo
  }),
  authorize: (0, import_server7.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const row = await dentalDb(tx).selectFrom("plg_dental_insurance").select(["customer_id", "version"]).where("tenant_id", "=", tenantId).where("id", "=", input.id).forUpdate().executeTakeFirst();
    if (!row) throw new import_server7.AppError("NOT_FOUND", "Insurance policy not found");
    if (row.version !== input.expectedVersion) {
      throw new import_server7.AppError("VERSION_CONFLICT", "This policy was changed by someone else", { currentVersion: row.version });
    }
    const memberId = input.memberId === void 0 ? void 0 : blankToNull(input.memberId);
    const changes = {
      ...input.carrier !== void 0 && { carrier: input.carrier },
      ...memberId !== void 0 && { member_id_enc: memberId === null ? null : (0, import_server7.encryptField)(memberId, memberContext(tenantId, input.id)) },
      ...input.groupNumber !== void 0 && { group_number: blankToNull(input.groupNumber) },
      ...input.subscriberName !== void 0 && { subscriber_name: blankToNull(input.subscriberName) },
      ...input.subscriberRelationship !== void 0 && { subscriber_relationship: input.subscriberRelationship },
      ...input.isPrimary !== void 0 && { is_primary: input.isPrimary },
      ...input.validTo !== void 0 && { valid_to: input.validTo }
    };
    const fields = Object.keys(changes).map((column) => column === "member_id_enc" ? "memberId" : column.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
    const updated = await dentalDb(tx).updateTable("plg_dental_insurance").set({ ...changes, version: row.version + 1 }).where("tenant_id", "=", tenantId).where("id", "=", input.id).returning(["id", "version"]).executeTakeFirstOrThrow();
    if (input.isPrimary === true) await clearOtherPrimaries(tx, tenantId, row.customer_id, input.id);
    await scope.audit({
      action: "dental.insurance.update",
      targetType: "customer",
      targetId: row.customer_id,
      changes: { insuranceId: input.id, fields }
    });
    return updated;
  }
});
var deleteInsuranceCommand = (0, import_server7.defineCommand)({
  name: "dental.insurance.delete",
  input: import_plugin_sdk7.z.object({ id: import_plugin_sdk7.z.uuid() }),
  authorize: (0, import_server7.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const row = await dentalDb(tx).deleteFrom("plg_dental_insurance").where("tenant_id", "=", tenantId).where("id", "=", input.id).returning("customer_id").executeTakeFirst();
    if (!row) throw new import_server7.AppError("NOT_FOUND", "Insurance policy not found");
    await scope.audit({
      action: "dental.insurance.delete",
      targetType: "customer",
      targetId: row.customer_id,
      changes: { insuranceId: input.id }
    });
    return { id: input.id };
  }
});
var createInsurance = (ctx, input) => createInsuranceCommand.run(ctx, input);
var updateInsurance = (ctx, input) => updateInsuranceCommand.run(ctx, input);
var deleteInsurance = (ctx, input) => deleteInsuranceCommand.run(ctx, input);

// src/server/history/index.ts
function registerHistory(api) {
  api.registerTask(HISTORY_REVIEW_TASK, async () => {
    await runHistoryReviewDaily();
  });
}

// src/server/plans/plans.ts
var import_node_crypto = require("node:crypto");
var import_plugin_sdk8 = require("@appointit/plugin-sdk");
var import_server8 = require("@appointit/plugin-sdk/server");

// src/server/plans/pdf.ts
var PAGE_W = 595;
var PAGE_H = 842;
var MARGIN = 48;
var LEADING = 14;
var WRAP = 88;
function latin1(text2) {
  let out = "";
  for (const ch of text2) {
    const c = ch.codePointAt(0) ?? 63;
    if (c < 32) out += " ";
    else if (c > 255 || c >= 127 && c <= 159) out += "?";
    else out += ch;
  }
  return out;
}
var pdfText = (text2) => latin1(text2).replace(/[\\()]/g, (m) => `\\${m}`);
function wrap(text2) {
  const words = latin1(text2).split(/\s+/).filter((w) => w !== "");
  const lines = [];
  let line = "";
  for (const word of words) {
    const piece = word.length > WRAP ? word.slice(0, WRAP) : word;
    if (line !== "" && line.length + 1 + piece.length > WRAP) {
      lines.push(line);
      line = piece;
    } else line = line === "" ? piece : `${line} ${piece}`;
  }
  if (line !== "") lines.push(line);
  return lines.length > 0 ? lines : [""];
}
function buildAcceptancePdf(input) {
  const pages = [[]];
  let y = PAGE_H - MARGIN;
  const room = (needed) => {
    if (y - needed >= MARGIN) return;
    pages.push([]);
    y = PAGE_H - MARGIN;
  };
  const put = (op) => {
    pages[pages.length - 1].push(op);
  };
  const line = (text2, o = {}) => {
    const size = o.size ?? 10;
    room(size + 4);
    put(`BT /${o.bold ? "F2" : "F1"} ${size} Tf ${o.x ?? MARGIN} ${y} Td (${pdfText(text2)}) Tj ET`);
    y -= size + 4;
  };
  const para = (text2, o = {}) => {
    for (const part of wrap(text2)) line(part, o);
  };
  const gap = (n = LEADING) => {
    y -= n;
  };
  line(input.businessName, { bold: true, size: 16 });
  line("Treatment plan acceptance", { size: 12 });
  gap();
  line(`Patient: ${input.patientName}`);
  line(`Plan: ${input.planTitle}`, { bold: true });
  line(`Plan reference: ${input.planId}`, { size: 8 });
  gap();
  line("Planned treatment", { bold: true });
  input.rows.forEach((row, i) => {
    const parts = wrap(`${i + 1}. ${row.text}`);
    room(parts.length * LEADING);
    const top = y;
    parts.forEach((p2) => line(p2));
    put(`BT /F1 10 Tf ${PAGE_W - MARGIN - 90} ${top} Td (${pdfText(row.amount)}) Tj ET`);
  });
  gap(6);
  line(`Estimated total: ${input.estimate}`, { bold: true });
  line(`Insurance estimate: ${input.insurance}`);
  line(`Patient share: ${input.patientShare}`);
  gap();
  para("I have read the treatment plan above, I understand the proposed treatment and its estimated cost, and I accept it. The estimate may change if the treatment needs to change.");
  gap();
  line(`Accepted by: ${input.signerName}`, { bold: true });
  line(`Accepted at: ${input.acceptedAt}`);
  line(input.typed ? "Signature: typed name" : "Signature: drawn (below)");
  if (input.signatureFileId) line(`Signature image file: ${input.signatureFileId}`, { size: 8 });
  line(`Plan content SHA-256: ${input.hash}`, { size: 8 });
  if (!input.typed && input.strokes.length > 0) {
    const boxW = 240;
    const boxH = 80;
    gap(6);
    room(boxH + 8);
    const x0 = MARGIN;
    const y0 = y - boxH;
    const clamp = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
    put(`0.6 G ${x0} ${y0} ${boxW} ${boxH} re S 0 G 1.2 w 1 J 1 j`);
    for (const stroke of input.strokes) {
      const points = stroke.filter((p2) => p2.length >= 2);
      if (points.length === 0) continue;
      const at = (p2) => `${(x0 + clamp(p2[0] ?? 0) * boxW).toFixed(1)} ${(y0 + (1 - clamp(p2[1] ?? 0)) * boxH).toFixed(1)}`;
      const [first, ...rest] = points;
      put(rest.length === 0 ? `${at(first)} m ${at(first)} l S` : `${at(first)} m ${rest.map((p2) => `${at(p2)} l`).join(" ")} S`);
    }
    y = y0 - 8;
  }
  let out = "%PDF-1.4\n";
  const offsets = [];
  const add = (n, body) => {
    offsets[n] = out.length;
    out += `${n} 0 obj
${body}
endobj
`;
  };
  const pageObj = (i) => 5 + i * 2;
  add(1, "<< /Type /Catalog /Pages 2 0 R >>");
  add(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((ops, i) => {
    const content = ops.join("\n");
    add(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`);
    add(pageObj(i) + 1, `<< /Length ${content.length} >>
stream
${content}
endstream`);
  });
  const count = 5 + pages.length * 2;
  const xref = out.length;
  out += `xref
0 ${count}
0000000000 65535 f 
`;
  for (let n = 1; n < count; n++) out += `${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n 
`;
  out += `trailer
<< /Size ${count} /Root 1 0 R >>
startxref
${xref}
%%EOF
`;
  return Buffer.from(out, "latin1");
}

// src/server/plans/plans.ts
var NOTES_FIELD2 = "plg_dental_treatment_plan.notes";
var OPEN_STATUSES = ["draft", "proposed", "accepted", "in_progress"];
var iso = (value) => (value instanceof Date ? value : new Date(value)).toISOString();
function invalid(path, message) {
  return new import_server8.AppError("INVALID_INPUT", "Invalid input", { issues: [{ path, message, code: "custom" }] });
}
async function loadPlans(tx, tenantId, filter) {
  let query = dentalDb(tx).selectFrom("plg_dental_treatment_plan").selectAll().where("tenant_id", "=", tenantId);
  if (filter.customerId !== void 0) query = query.where("customer_id", "=", filter.customerId);
  if (filter.id !== void 0) query = query.where("id", "=", filter.id);
  const plans = await query.orderBy("created_at", "desc").orderBy("id", "desc").execute();
  if (plans.length === 0) return [];
  const items = await dentalDb(tx).selectFrom("plg_dental_plan_item as i").leftJoin("plg_dental_procedure as p", (join) => join.onRef("p.tenant_id", "=", "i.tenant_id").onRef("p.id", "=", "i.procedure_id")).leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "i.tenant_id").onRef("s.id", "=", "i.service_id")).leftJoin("booking as b", (join) => join.onRef("b.tenant_id", "=", "i.tenant_id").onRef("b.id", "=", "i.booking_id")).select([
    "i.id",
    "i.plan_id",
    "i.seq",
    "i.procedure_id",
    "p.name as procedure_name",
    "i.service_id",
    "s.name as service_name",
    "i.tooth",
    "i.surfaces",
    "i.min_gap_days",
    "i.max_gap_days",
    "i.price_minor",
    "i.booking_id",
    "i.status",
    "b.starts_at as booking_start"
  ]).where("i.tenant_id", "=", tenantId).where("i.plan_id", "in", plans.map((p2) => p2.id)).orderBy("i.seq").execute();
  const byPlan = /* @__PURE__ */ new Map();
  for (const i of items) {
    const list2 = byPlan.get(i.plan_id) ?? [];
    list2.push({
      id: i.id,
      seq: i.seq,
      procedureId: i.procedure_id,
      procedureName: i.procedure_name,
      serviceId: i.service_id,
      serviceName: i.service_name,
      tooth: i.tooth,
      surfaces: i.surfaces,
      minGapDays: i.min_gap_days,
      maxGapDays: i.max_gap_days,
      priceMinor: Number(i.price_minor),
      bookingId: i.booking_id,
      bookingStart: i.booking_start === null ? null : iso(i.booking_start),
      status: i.status
    });
    byPlan.set(i.plan_id, list2);
  }
  return plans.map((p2) => {
    const estimate = Number(p2.estimate_minor);
    const insurance = Number(p2.insurance_estimate_minor);
    return {
      id: p2.id,
      customerId: p2.customer_id,
      title: p2.title,
      status: p2.status,
      currency: p2.currency,
      estimateMinor: estimate,
      insuranceEstimateMinor: insurance,
      patientShareMinor: Math.max(0, estimate - insurance),
      notes: p2.notes_enc === null ? null : (0, import_server8.decryptField)(p2.notes_enc, { tenantId, field: NOTES_FIELD2 }),
      acceptedAt: p2.accepted_at === null ? null : iso(p2.accepted_at),
      acceptanceFileId: p2.acceptance_file_id,
      acceptanceUrl: p2.acceptance_file_id === null ? null : (0, import_server8.fileUrl)(p2.acceptance_file_id, "private"),
      seriesId: p2.series_id,
      version: p2.version,
      createdAt: iso(p2.created_at),
      items: byPlan.get(p2.id) ?? []
    };
  });
}
function listPlans(tenantId, customerId) {
  return (0, import_server8.withTenantTx)(tenantId, (tx) => loadPlans(tx, tenantId, { customerId }));
}
async function getPlan(tenantId, id) {
  const plan = (await (0, import_server8.withTenantTx)(tenantId, (tx) => loadPlans(tx, tenantId, { id })))[0];
  if (!plan) throw new import_server8.AppError("NOT_FOUND", "Treatment plan not found");
  return plan;
}
async function getPlanOptions(tenantId) {
  return (0, import_server8.withTenantTx)(tenantId, async (tx) => {
    const rows = await dentalDb(tx).selectFrom("plg_dental_procedure as p").leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "p.tenant_id").onRef("s.id", "=", "p.service_id")).select(["p.id", "p.code", "p.name", "p.category", "p.default_price_minor", "p.currency", "p.service_id", "s.name as service_name"]).where("p.tenant_id", "=", tenantId).where("p.active", "=", true).orderBy("p.sort").orderBy("p.name").execute();
    return {
      currency: await defaultCurrency(tx, tenantId),
      procedures: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        category: r.category,
        defaultPriceMinor: r.default_price_minor === null ? null : Number(r.default_price_minor),
        currency: r.currency,
        serviceId: r.service_id,
        serviceName: r.service_name
      }))
    };
  });
}
async function defaultCurrency(tx, tenantId) {
  const row = await tx.selectFrom("location").select("currency").where("tenant_id", "=", tenantId).where("status", "=", "active").orderBy("created_at").limit(1).executeTakeFirst();
  return row?.currency ?? null;
}
var planItemInput = import_plugin_sdk8.z.object({
  /** The existing item to keep (its booking link and chart references stay); omit for a new one. */
  id: import_plugin_sdk8.z.uuid().optional(),
  procedureId: import_plugin_sdk8.z.uuid().nullish(),
  /** Needed only for a procedure without a linked service. */
  serviceId: import_plugin_sdk8.z.uuid().nullish(),
  tooth: import_plugin_sdk8.z.string().trim().max(10).nullish(),
  surfaces: import_plugin_sdk8.z.array(import_plugin_sdk8.z.string().trim().min(1).max(4)).max(6).default([]),
  /** Minor units; left out = the procedure's default price. */
  priceMinor: import_plugin_sdk8.z.number().int().min(0).max(1e12).optional(),
  minGapDays: import_plugin_sdk8.z.number().int().min(0).max(730).default(0),
  maxGapDays: import_plugin_sdk8.z.number().int().min(0).max(1460).nullish()
});
var itemsInput = import_plugin_sdk8.z.array(planItemInput).max(30);
var notesInput = import_plugin_sdk8.z.string().max(5e3);
var money = import_plugin_sdk8.z.number().int().min(0).max(1e12);
async function prepareItems(tx, tenantId, items) {
  const procedureIds = [...new Set(items.flatMap((i) => i.procedureId ? [i.procedureId] : []))];
  const procedures = procedureIds.length ? await dentalDb(tx).selectFrom("plg_dental_procedure").select(["id", "service_id", "default_price_minor"]).where("tenant_id", "=", tenantId).where("id", "in", procedureIds).execute() : [];
  const procedureById = new Map(procedures.map((p2) => [p2.id, p2]));
  const prepared = items.map((item, index) => {
    const procedure = item.procedureId ? procedureById.get(item.procedureId) : void 0;
    if (item.procedureId && !procedure) throw invalid(`items.${index}.procedureId`, "This procedure does not exist");
    if (item.maxGapDays != null && item.maxGapDays < item.minGapDays) {
      throw invalid(`items.${index}.maxGapDays`, "The longest gap cannot be shorter than the shortest gap");
    }
    return {
      id: item.id,
      procedureId: item.procedureId ?? null,
      serviceId: item.serviceId ?? procedure?.service_id ?? null,
      tooth: item.tooth && item.tooth !== "" ? item.tooth : null,
      surfaces: item.surfaces,
      priceMinor: item.priceMinor ?? (procedure?.default_price_minor != null ? Number(procedure.default_price_minor) : 0),
      minGapDays: item.minGapDays,
      maxGapDays: item.maxGapDays ?? null
    };
  });
  const serviceIds = [...new Set(prepared.flatMap((i) => i.serviceId ? [i.serviceId] : []))];
  if (serviceIds.length > 0) {
    const found = await tx.selectFrom("service").select("id").where("tenant_id", "=", tenantId).where("id", "in", serviceIds).execute();
    const known = new Set(found.map((s) => s.id));
    prepared.forEach((item, index) => {
      if (item.serviceId && !known.has(item.serviceId)) throw invalid(`items.${index}.serviceId`, "This service does not exist");
    });
  }
  return prepared;
}
async function writeItems(tx, tenantId, planId, items) {
  const existing = await dentalDb(tx).selectFrom("plg_dental_plan_item").select("id").where("tenant_id", "=", tenantId).where("plan_id", "=", planId).execute();
  const known = new Set(existing.map((e) => e.id));
  const keep = new Set(items.flatMap((i) => i.id && known.has(i.id) ? [i.id] : []));
  const drop = existing.map((e) => e.id).filter((id) => !keep.has(id));
  if (drop.length > 0) await dentalDb(tx).deleteFrom("plg_dental_plan_item").where("tenant_id", "=", tenantId).where("id", "in", drop).execute();
  for (const [index, item] of items.entries()) {
    const fields = {
      seq: index + 1,
      procedure_id: item.procedureId,
      service_id: item.serviceId,
      tooth: item.tooth,
      surfaces: item.surfaces,
      min_gap_days: item.minGapDays,
      max_gap_days: item.maxGapDays,
      price_minor: item.priceMinor
    };
    if (item.id && known.has(item.id)) {
      await dentalDb(tx).updateTable("plg_dental_plan_item").set(fields).where("tenant_id", "=", tenantId).where("id", "=", item.id).execute();
    } else {
      await dentalDb(tx).insertInto("plg_dental_plan_item").values({ tenant_id: tenantId, id: (0, import_server8.uuidv7)(), plan_id: planId, ...fields }).execute();
    }
  }
  return items.reduce((sum, i) => sum + i.priceMinor, 0);
}
async function lockPlan(tx, tenantId, planId, expectedVersion) {
  const plan = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").selectAll().where("tenant_id", "=", tenantId).where("id", "=", planId).forUpdate().executeTakeFirst();
  if (!plan) throw new import_server8.AppError("NOT_FOUND", "Treatment plan not found");
  if (expectedVersion !== void 0 && plan.version !== expectedVersion) {
    throw new import_server8.AppError("VERSION_CONFLICT", "This plan was changed by someone else", { currentVersion: plan.version });
  }
  return plan;
}
async function setStatus(tx, tenantId, plan, status, extra = {}) {
  const row = await dentalDb(tx).updateTable("plg_dental_treatment_plan").set({ status, version: import_server8.sql`version + 1`, ...extra }).where("tenant_id", "=", tenantId).where("id", "=", plan.id).returning("version").executeTakeFirstOrThrow();
  return row.version;
}
var AGGREGATE = "dental_treatment_plan";
var createInput = import_plugin_sdk8.z.object({
  customerId: import_plugin_sdk8.z.uuid(),
  title: import_plugin_sdk8.z.string().trim().min(1).max(200),
  currency: import_plugin_sdk8.z.string().length(3).optional(),
  insuranceEstimateMinor: money.default(0),
  notes: notesInput.nullish(),
  items: itemsInput.default([])
});
var createPlan = (0, import_server8.defineCommand)({
  name: "dental.plan.create",
  input: createInput,
  authorize: (0, import_server8.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const customer = await tx.selectFrom("customer").select("id").where("tenant_id", "=", tenantId).where("id", "=", input.customerId).executeTakeFirst();
    if (!customer) throw new import_server8.AppError("NOT_FOUND", "Patient not found");
    const items = await prepareItems(tx, tenantId, input.items);
    const planId = (0, import_server8.uuidv7)();
    await dentalDb(tx).insertInto("plg_dental_treatment_plan").values({
      tenant_id: tenantId,
      id: planId,
      customer_id: input.customerId,
      title: input.title,
      currency: input.currency?.toUpperCase() ?? await defaultCurrency(tx, tenantId),
      insurance_estimate_minor: input.insuranceEstimateMinor,
      notes_enc: input.notes ? (0, import_server8.encryptField)(input.notes, { tenantId, field: NOTES_FIELD2 }) : null,
      created_by: scope.ctx.actor.id ?? null
    }).execute();
    const estimate = await writeItems(tx, tenantId, planId, items);
    await dentalDb(tx).updateTable("plg_dental_treatment_plan").set({ estimate_minor: estimate }).where("tenant_id", "=", tenantId).where("id", "=", planId).execute();
    await scope.audit({
      action: "dental.plan.create",
      targetType: AGGREGATE,
      targetId: planId,
      targetVersion: 1,
      changes: { customerId: input.customerId, title: input.title, items: items.length, estimateMinor: estimate }
    });
    return { id: planId, version: 1, status: "draft" };
  }
});
var updateInput = import_plugin_sdk8.z.object({
  planId: import_plugin_sdk8.z.uuid(),
  expectedVersion: import_plugin_sdk8.z.number().int().min(1),
  title: import_plugin_sdk8.z.string().trim().min(1).max(200).optional(),
  insuranceEstimateMinor: money.optional(),
  notes: notesInput.nullish(),
  /** Replaces the item list; only while the plan is a draft or proposed. */
  items: itemsInput.optional()
});
var updatePlan = (0, import_server8.defineCommand)({
  name: "dental.plan.update",
  input: updateInput,
  authorize: (0, import_server8.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await lockPlan(tx, tenantId, input.planId, input.expectedVersion);
    if (!OPEN_STATUSES.includes(plan.status)) throw new import_server8.AppError("CONFLICT", `A ${plan.status} plan cannot be changed`);
    const set = {};
    if (input.title !== void 0) set.title = input.title;
    if (input.insuranceEstimateMinor !== void 0) set.insurance_estimate_minor = input.insuranceEstimateMinor;
    if (input.notes !== void 0) set.notes_enc = input.notes ? (0, import_server8.encryptField)(input.notes, { tenantId, field: NOTES_FIELD2 }) : null;
    let status = plan.status;
    if (input.items !== void 0) {
      if (plan.status !== "draft" && plan.status !== "proposed") {
        throw new import_server8.AppError("CONFLICT", "The treatment items can only be changed before the patient accepts the plan");
      }
      set.estimate_minor = await writeItems(tx, tenantId, plan.id, await prepareItems(tx, tenantId, input.items));
      if (plan.status === "proposed") status = "draft";
    }
    const version = await setStatus(tx, tenantId, plan, status, set);
    await scope.audit({
      action: "dental.plan.update",
      targetType: AGGREGATE,
      targetId: plan.id,
      targetVersion: version,
      changes: { fields: Object.keys(set).filter((k) => k !== "notes_enc"), notesChanged: "notes_enc" in set, ...status !== plan.status && { status: { from: plan.status, to: status } } }
    });
    return { id: plan.id, version, status };
  }
});
var transitionInput = import_plugin_sdk8.z.object({ planId: import_plugin_sdk8.z.uuid(), expectedVersion: import_plugin_sdk8.z.number().int().min(1) });
var proposePlan = (0, import_server8.defineCommand)({
  name: "dental.plan.propose",
  input: transitionInput,
  authorize: (0, import_server8.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await lockPlan(tx, tenantId, input.planId, input.expectedVersion);
    if (plan.status !== "draft") throw new import_server8.AppError("CONFLICT", `A ${plan.status} plan cannot be proposed`);
    const count = await dentalDb(tx).selectFrom("plg_dental_plan_item").select(import_server8.sql`count(*)::int`.as("n")).where("tenant_id", "=", tenantId).where("plan_id", "=", plan.id).executeTakeFirstOrThrow();
    if (count.n === 0) throw invalid("items", "Add at least one treatment before proposing the plan");
    const version = await setStatus(tx, tenantId, plan, "proposed");
    await scope.emit({ type: "dental.plan.proposed", aggregateType: AGGREGATE, aggregateId: plan.id, aggregateVersion: version, payload: { planId: plan.id, customerId: plan.customer_id } });
    await scope.audit({ action: "dental.plan.propose", targetType: AGGREGATE, targetId: plan.id, targetVersion: version, changes: { status: { from: "draft", to: "proposed" } } });
    return { id: plan.id, version, status: "proposed" };
  }
});
var cancelInput = transitionInput.extend({ reason: import_plugin_sdk8.z.string().trim().max(500).optional() });
var cancelPlan = (0, import_server8.defineCommand)({
  name: "dental.plan.cancel",
  input: cancelInput,
  authorize: (0, import_server8.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await lockPlan(tx, tenantId, input.planId, input.expectedVersion);
    if (!OPEN_STATUSES.includes(plan.status)) throw new import_server8.AppError("CONFLICT", `A ${plan.status} plan cannot be cancelled`);
    await dentalDb(tx).updateTable("plg_dental_plan_item").set({ status: "cancelled" }).where("tenant_id", "=", tenantId).where("plan_id", "=", plan.id).where("status", "=", "planned").execute();
    const version = await setStatus(tx, tenantId, plan, "cancelled");
    await scope.audit({ action: "dental.plan.cancel", targetType: AGGREGATE, targetId: plan.id, targetVersion: version, changes: { status: { from: plan.status, to: "cancelled" } }, ...input.reason && { reason: input.reason } });
    return { id: plan.id, version, status: "cancelled" };
  }
});
var MAX_SIGNATURE_BYTES = 4e5;
var PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
var acceptInput = transitionInput.extend({
  signerName: import_plugin_sdk8.z.string().trim().min(1).max(200),
  /** A drawn signature as a PNG data URL; leave out when the patient typed their name instead. */
  signatureDataUrl: import_plugin_sdk8.z.string().max(6e5).optional(),
  /** The pen strokes of the drawing (each point 0..1), added to the PDF as lines. */
  strokes: import_plugin_sdk8.z.array(import_plugin_sdk8.z.array(import_plugin_sdk8.z.tuple([import_plugin_sdk8.z.number(), import_plugin_sdk8.z.number()])).max(1500)).max(100).optional()
});
function moneyText(minor, currency) {
  const code = currency ?? "";
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency: code || "USD" }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  return `${(minor / 10 ** digits).toFixed(digits)} ${code}`.trim();
}
var acceptPlan = (0, import_server8.defineCommand)({
  name: "dental.plan.accept",
  input: acceptInput,
  authorize: (0, import_server8.requirePermission)("health.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await lockPlan(tx, tenantId, input.planId, input.expectedVersion);
    if (plan.status !== "proposed") throw new import_server8.AppError("CONFLICT", plan.status === "draft" ? "Propose the plan to the patient first" : `A ${plan.status} plan cannot be accepted`);
    const dto = (await loadPlans(tx, tenantId, { id: plan.id }))[0];
    const customer = await tx.selectFrom("customer").select("display_name").where("tenant_id", "=", tenantId).where("id", "=", plan.customer_id).executeTakeFirstOrThrow();
    const tenant = await tx.selectFrom("tenant").select("name").where("id", "=", tenantId).executeTakeFirstOrThrow();
    let signatureFileId = null;
    if (input.signatureDataUrl !== void 0) {
      const match = PNG_DATA_URL.exec(input.signatureDataUrl);
      if (!match) throw invalid("signatureDataUrl", "The signature must be a PNG image");
      const png = Buffer.from(match[1], "base64");
      if (png.length > MAX_SIGNATURE_BYTES) throw invalid("signatureDataUrl", "The signature image is too large");
      const stored = await (0, import_server8.storeFile)(tenantId, {
        data: png,
        filename: "treatment-plan-signature.png",
        purpose: "dental_plan_signature",
        visibility: "private",
        ...scope.ctx.actor.id !== void 0 && { createdBy: scope.ctx.actor.id }
      });
      signatureFileId = stored.id;
    }
    const acceptedAt = /* @__PURE__ */ new Date();
    const active = dto.items.filter((i) => i.status !== "cancelled");
    const planHash = (0, import_node_crypto.createHash)("sha256").update(JSON.stringify({ id: dto.id, title: dto.title, estimate: dto.estimateMinor, insurance: dto.insuranceEstimateMinor, items: active.map((i) => [i.procedureId, i.serviceId, i.tooth, i.surfaces, i.priceMinor, i.minGapDays, i.maxGapDays]) })).digest("hex");
    const pdf = buildAcceptancePdf({
      businessName: tenant.name,
      patientName: customer.display_name,
      planTitle: dto.title,
      planId: dto.id,
      rows: active.map((i) => ({
        text: [i.procedureName ?? i.serviceName ?? "Treatment", i.tooth ? `tooth ${i.tooth}${i.surfaces.length ? ` (${i.surfaces.join("")})` : ""}` : null].filter(Boolean).join(" - "),
        amount: moneyText(i.priceMinor, dto.currency)
      })),
      estimate: moneyText(dto.estimateMinor, dto.currency),
      insurance: moneyText(dto.insuranceEstimateMinor, dto.currency),
      patientShare: moneyText(dto.patientShareMinor, dto.currency),
      signerName: input.signerName,
      acceptedAt: acceptedAt.toISOString(),
      typed: signatureFileId === null,
      signatureFileId,
      strokes: input.strokes ?? [],
      hash: planHash
    });
    const file = await (0, import_server8.storeFile)(tenantId, {
      data: pdf,
      filename: "treatment-plan-acceptance.pdf",
      purpose: "dental_plan_acceptance",
      visibility: "private",
      ...scope.ctx.actor.id !== void 0 && { createdBy: scope.ctx.actor.id }
    });
    const version = await setStatus(tx, tenantId, plan, "accepted", { accepted_at: acceptedAt, acceptance_file_id: file.id });
    await scope.emit({ type: "dental.plan.accepted", aggregateType: AGGREGATE, aggregateId: plan.id, aggregateVersion: version, payload: { planId: plan.id, customerId: plan.customer_id } });
    await scope.audit({
      action: "dental.plan.accept",
      targetType: AGGREGATE,
      targetId: plan.id,
      targetVersion: version,
      changes: { status: { from: "proposed", to: "accepted" }, signerName: input.signerName, signature: signatureFileId ? "drawn" : "typed", signatureFileId, acceptanceFileId: file.id, planSha256: planHash }
    });
    return { id: plan.id, version, status: "accepted", acceptanceFileId: file.id, acceptanceUrl: file.url };
  }
});
async function onPlanBookingEvent(tx, event, ctx) {
  const { tenantId } = ctx;
  const bookingId = event.aggregate_id;
  if (event.type === "booking.completed") {
    const done = await dentalDb(tx).updateTable("plg_dental_plan_item").set({ status: "done" }).where("tenant_id", "=", tenantId).where("booking_id", "=", bookingId).where("status", "in", ["booked", "planned"]).returning("plan_id").execute();
    for (const planId of new Set(done.map((d) => d.plan_id))) {
      const plan = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").select(["status", "version"]).where("tenant_id", "=", tenantId).where("id", "=", planId).forUpdate().executeTakeFirst();
      if (!plan || plan.status !== "accepted" && plan.status !== "in_progress") continue;
      const left = await dentalDb(tx).selectFrom("plg_dental_plan_item").select(import_server8.sql`count(*)::int`.as("n")).where("tenant_id", "=", tenantId).where("plan_id", "=", planId).where("status", "not in", ["done", "cancelled"]).executeTakeFirstOrThrow();
      const next = left.n === 0 ? "completed" : "in_progress";
      if (next !== plan.status) {
        await dentalDb(tx).updateTable("plg_dental_treatment_plan").set({ status: next, version: import_server8.sql`version + 1` }).where("tenant_id", "=", tenantId).where("id", "=", planId).execute();
      }
    }
    return;
  }
  const freed = await dentalDb(tx).updateTable("plg_dental_plan_item").set({ status: "planned", booking_id: null }).where("tenant_id", "=", tenantId).where("booking_id", "=", bookingId).where("status", "=", "booked").returning("plan_id").execute();
  for (const planId of new Set(freed.map((f) => f.plan_id))) {
    const active = await dentalDb(tx).selectFrom("plg_dental_plan_item").select(import_server8.sql`count(*)::int`.as("n")).where("tenant_id", "=", tenantId).where("plan_id", "=", planId).where("status", "in", ["booked", "done"]).executeTakeFirstOrThrow();
    if (active.n === 0) {
      await dentalDb(tx).updateTable("plg_dental_treatment_plan").set({ status: "accepted", version: import_server8.sql`version + 1` }).where("tenant_id", "=", tenantId).where("id", "=", planId).where("status", "=", "in_progress").execute();
    }
  }
}

// src/server/plans/recall.ts
var import_plugin_sdk9 = require("@appointit/plugin-sdk");
var import_server9 = require("@appointit/plugin-sdk/server");

// src/server/plans/dates.ts
var DAY_MS = 864e5;
function localDateOf(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const pick = (type) => parts.find((p2) => p2.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
var isPlainDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

// src/server/plans/recall.ts
var RECALL_DAILY_TASK = "dental_recall_daily";
var TEMPLATE2 = "recall.due";
var BATCH2 = 100;
var MAX_BATCHES2 = 50;
async function listRecallRules(tenantId) {
  return (0, import_server9.withTenantTx)(tenantId, async (tx) => {
    const rows = await dentalDb(tx).selectFrom("plg_dental_recall_rule as r").leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "r.tenant_id").onRef("s.id", "=", "r.service_id")).select(["r.id", "r.name", "r.service_id", "s.name as service_name", "r.interval_months", "r.lead_days", "r.active", "r.version"]).where("r.tenant_id", "=", tenantId).orderBy("r.name").execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      serviceId: r.service_id,
      serviceName: r.service_name,
      intervalMonths: r.interval_months,
      leadDays: r.lead_days,
      active: r.active,
      version: r.version
    }));
  });
}
var ruleInput = import_plugin_sdk9.z.object({
  /** Omit to create a rule. */
  id: import_plugin_sdk9.z.uuid().optional(),
  expectedVersion: import_plugin_sdk9.z.number().int().min(1).optional(),
  name: import_plugin_sdk9.z.string().trim().min(1).max(120),
  serviceId: import_plugin_sdk9.z.uuid(),
  intervalMonths: import_plugin_sdk9.z.number().int().min(1).max(60),
  leadDays: import_plugin_sdk9.z.number().int().min(0).max(365).default(14),
  active: import_plugin_sdk9.z.boolean().default(true)
});
var saveRecallRule = (0, import_server9.defineCommand)({
  name: "dental.recall.saveRule",
  input: ruleInput,
  authorize: (0, import_server9.requirePermission)("services.manage"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const service = await tx.selectFrom("service").select("id").where("tenant_id", "=", tenantId).where("id", "=", input.serviceId).executeTakeFirst();
    if (!service) throw new import_server9.AppError("INVALID_INPUT", "Invalid input", { issues: [{ path: "serviceId", message: "This service does not exist", code: "custom" }] });
    const fields = { name: input.name, service_id: input.serviceId, interval_months: input.intervalMonths, lead_days: input.leadDays, active: input.active };
    if (input.id === void 0) {
      const id = (0, import_server9.uuidv7)();
      await dentalDb(tx).insertInto("plg_dental_recall_rule").values({ tenant_id: tenantId, id, ...fields }).execute();
      await scope.audit({ action: "dental.recall_rule.create", targetType: "dental_recall_rule", targetId: id, targetVersion: 1, changes: fields });
      return { id, version: 1 };
    }
    const row = await dentalDb(tx).updateTable("plg_dental_recall_rule").set({ ...fields, version: import_server9.sql`version + 1` }).where("tenant_id", "=", tenantId).where("id", "=", input.id).$if(input.expectedVersion !== void 0, (qb) => qb.where("version", "=", input.expectedVersion)).returning("version").executeTakeFirst();
    if (!row) {
      const current = await dentalDb(tx).selectFrom("plg_dental_recall_rule").select("version").where("tenant_id", "=", tenantId).where("id", "=", input.id).executeTakeFirst();
      if (!current) throw new import_server9.AppError("NOT_FOUND", "Recall rule not found");
      throw new import_server9.AppError("VERSION_CONFLICT", "This rule was changed by someone else", { currentVersion: current.version });
    }
    await scope.audit({ action: "dental.recall_rule.update", targetType: "dental_recall_rule", targetId: input.id, targetVersion: row.version, changes: fields });
    return { id: input.id, version: row.version };
  }
});
var RECALL_STATUSES = ["upcoming", "due", "reminded", "scheduled", "snoozed", "done"];
var listInput = import_plugin_sdk9.z.object({
  status: import_plugin_sdk9.z.array(import_plugin_sdk9.z.enum(RECALL_STATUSES)).optional(),
  dueFrom: import_plugin_sdk9.z.string().refine(isPlainDate, "Use YYYY-MM-DD").optional(),
  dueTo: import_plugin_sdk9.z.string().refine(isPlainDate, "Use YYYY-MM-DD").optional(),
  customerId: import_plugin_sdk9.z.uuid().optional(),
  limit: import_plugin_sdk9.z.number().int().min(1).max(500).default(100),
  offset: import_plugin_sdk9.z.number().int().min(0).default(0)
});
async function listRecalls(tenantId, rawInput = {}) {
  const parsed = listInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new import_server9.AppError("INVALID_INPUT", "Invalid input", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })) });
  }
  const input = parsed.data;
  return (0, import_server9.withTenantTx)(tenantId, async (tx) => {
    let query = dentalDb(tx).selectFrom("plg_dental_recall as r").innerJoin("plg_dental_recall_rule as u", (join) => join.onRef("u.tenant_id", "=", "r.tenant_id").onRef("u.id", "=", "r.rule_id")).innerJoin("customer as c", (join) => join.onRef("c.tenant_id", "=", "r.tenant_id").onRef("c.id", "=", "r.customer_id")).leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "u.tenant_id").onRef("s.id", "=", "u.service_id")).select([
      "r.customer_id",
      "c.display_name",
      "r.rule_id",
      "u.name as rule_name",
      "u.service_id",
      "s.name as service_name",
      import_server9.sql`to_char(r.due_on, 'YYYY-MM-DD')`.as("due_on"),
      "r.last_visit_at",
      "r.status",
      "r.booking_id",
      "r.last_reminded_at"
    ]).where("r.tenant_id", "=", tenantId);
    if (input.status && input.status.length > 0) query = query.where("r.status", "in", input.status);
    if (input.dueFrom) query = query.where(import_server9.sql`r.due_on >= ${input.dueFrom}::date`);
    if (input.dueTo) query = query.where(import_server9.sql`r.due_on <= ${input.dueTo}::date`);
    if (input.customerId) query = query.where("r.customer_id", "=", input.customerId);
    const rows = await query.orderBy("r.due_on").orderBy("c.display_name").orderBy("r.customer_id").limit(input.limit + 1).offset(input.offset).execute();
    return {
      hasMore: rows.length > input.limit,
      rows: rows.slice(0, input.limit).map((r) => ({
        customerId: r.customer_id,
        customerName: r.display_name,
        ruleId: r.rule_id,
        ruleName: r.rule_name,
        serviceId: r.service_id,
        serviceName: r.service_name,
        dueOn: r.due_on,
        lastVisitAt: r.last_visit_at === null ? null : r.last_visit_at.toISOString(),
        status: r.status,
        bookingId: r.booking_id,
        lastRemindedAt: r.last_reminded_at === null ? null : r.last_reminded_at.toISOString()
      }))
    };
  });
}
var appUrlConfig2 = import_plugin_sdk9.z.object({ APP_URL: import_plugin_sdk9.z.url().default("http://localhost:3000") });
async function bookLink(tx, tenantId, serviceId) {
  const base2 = (0, import_server9.readConfig)(appUrlConfig2).APP_URL.replace(/\/+$/, "");
  const site = await tx.selectFrom("site").select("settings").where("tenant_id", "=", tenantId).executeTakeFirst();
  const chosen = site?.settings?.bookingFormSlug;
  const forms = await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).where("status", "=", "published").where("purpose", "=", "booking").orderBy("created_at").execute();
  const slug = forms.find((f) => f.slug === chosen)?.slug ?? forms[0]?.slug;
  return slug ? `${base2}/f/${encodeURIComponent(slug)}?service=${encodeURIComponent(serviceId)}` : `${base2}/book?service=${encodeURIComponent(serviceId)}`;
}
async function queueReminders2(tx, tenantId, r, keySuffix) {
  const bookUrl = await bookLink(tx, tenantId, r.serviceId);
  const vars = { customer: { name: r.name, firstName: r.name.split(/\s+/)[0] ?? r.name }, bookUrl };
  const base2 = `dental.recall:${r.customerId}:${r.ruleId}:${r.dueOn}`;
  let queued = 0;
  for (const [channel, to] of [["email", r.email], ["sms", r.phone]]) {
    if (!to || to.trim() === "") continue;
    const result = await (0, import_server9.queueMessage)(tx, { template: TEMPLATE2, channel, to: to.trim(), vars, customerId: r.customerId, idempotencyKey: `${base2}:${channel}${keySuffix}` });
    if (result.status === "queued") queued += 1;
  }
  return queued;
}
async function tenantToday(tx, tenantId) {
  const loc = await tx.selectFrom("location").select("time_zone").where("tenant_id", "=", tenantId).orderBy("created_at").limit(1).executeTakeFirst();
  return localDateOf(Date.now(), loc?.time_zone ?? "UTC");
}
async function processTenantRecalls(tenantId) {
  const totals = { due: 0, reminded: 0, messages: 0 };
  let after = null;
  for (let batch = 0; batch < MAX_BATCHES2; batch++) {
    const cursor = after;
    const rows = await (0, import_server9.withTenantTx)(tenantId, async (tx) => {
      const today = await tenantToday(tx, tenantId);
      const found = await import_server9.sql`
        select r.customer_id, r.rule_id, u.service_id, to_char(r.due_on, 'YYYY-MM-DD') as due_on, c.display_name, c.email, c.phone
        from plg_dental_recall r
        join plg_dental_recall_rule u on u.tenant_id = r.tenant_id and u.id = r.rule_id and u.active
        join customer c on c.tenant_id = r.tenant_id and c.id = r.customer_id
        where r.tenant_id = ${tenantId} and r.status in ('upcoming', 'snoozed')
          and r.due_on - u.lead_days <= ${today}::date
          ${cursor ? import_server9.sql`and (r.due_on, r.customer_id, r.rule_id) > (${cursor.dueOn}::date, ${cursor.customerId}::uuid, ${cursor.ruleId}::uuid)` : import_server9.sql``}
        order by r.due_on, r.customer_id, r.rule_id
        limit ${BATCH2}
        for update of r skip locked`.execute(tx);
      for (const row of found.rows) {
        const queued = await queueReminders2(
          tx,
          tenantId,
          { customerId: row.customer_id, ruleId: row.rule_id, serviceId: row.service_id, dueOn: row.due_on, name: row.display_name, email: row.email, phone: row.phone },
          ""
        );
        await dentalDb(tx).updateTable("plg_dental_recall").set(queued > 0 ? { status: "reminded", last_reminded_at: /* @__PURE__ */ new Date() } : { status: "due" }).where("tenant_id", "=", tenantId).where("customer_id", "=", row.customer_id).where("rule_id", "=", row.rule_id).execute();
        totals.due += 1;
        if (queued > 0) totals.reminded += 1;
        totals.messages += queued;
      }
      return found.rows;
    });
    const last = rows[rows.length - 1];
    if (!last || rows.length < BATCH2) break;
    after = { dueOn: last.due_on, customerId: last.customer_id, ruleId: last.rule_id };
  }
  return totals;
}
async function runRecallDaily() {
  const tenants = await (0, import_server9.withPlatformTx)(async (tx) => {
    const found = await import_server9.sql`
      select distinct r.tenant_id
      from plg_dental_recall r
      join plg_dental_recall_rule u on u.tenant_id = r.tenant_id and u.id = r.rule_id and u.active
      where r.status in ('upcoming', 'snoozed') and r.due_on - u.lead_days <= current_date + 1`.execute(tx);
    return found.rows.map((row) => row.tenant_id);
  });
  let reminded = 0;
  let checked = 0;
  for (const tenantId of tenants) {
    try {
      if (!await isDentalEnabled(tenantId)) continue;
      checked += 1;
      reminded += (await processTenantRecalls(tenantId)).reminded;
    } catch (err) {
      console.error(`[dental] recall run failed for tenant ${tenantId}`, err);
    }
  }
  return { tenants: checked, reminded };
}
async function recallCounts(tenantId) {
  return (0, import_server9.withTenantTx)(tenantId, async (tx) => {
    const row = await dentalDb(tx).selectFrom("plg_dental_recall").select([
      import_server9.sql`(count(*) filter (where status = 'due'))::int`.as("due"),
      import_server9.sql`(count(*) filter (where status = 'reminded'))::int`.as("reminded")
    ]).where("tenant_id", "=", tenantId).executeTakeFirstOrThrow();
    return { due: row.due, reminded: row.reminded };
  });
}
var recallRef = import_plugin_sdk9.z.object({ customerId: import_plugin_sdk9.z.uuid(), ruleId: import_plugin_sdk9.z.uuid() });
async function lockRecall(tx, tenantId, customerId, ruleId) {
  const row = await import_server9.sql`
    select r.status, to_char(r.due_on, 'YYYY-MM-DD') as due_on, u.service_id, c.display_name, c.email, c.phone
    from plg_dental_recall r
    join plg_dental_recall_rule u on u.tenant_id = r.tenant_id and u.id = r.rule_id
    join customer c on c.tenant_id = r.tenant_id and c.id = r.customer_id
    where r.tenant_id = ${tenantId} and r.customer_id = ${customerId} and r.rule_id = ${ruleId}
    for update of r`.execute(tx);
  const recall = row.rows[0];
  if (!recall) throw new import_server9.AppError("NOT_FOUND", "Recall not found");
  return recall;
}
var remindRecall = (0, import_server9.defineCommand)({
  name: "dental.recall.remind",
  input: recallRef,
  authorize: (0, import_server9.requirePermission)("bookings.create"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const recall = await lockRecall(tx, tenantId, input.customerId, input.ruleId);
    if (recall.status === "done" || recall.status === "scheduled") throw new import_server9.AppError("CONFLICT", `A ${recall.status} recall needs no reminder`);
    const queued = await queueReminders2(
      tx,
      tenantId,
      { customerId: input.customerId, ruleId: input.ruleId, serviceId: recall.service_id, dueOn: recall.due_on, name: recall.display_name, email: recall.email, phone: recall.phone },
      `:manual:${(0, import_server9.uuidv7)()}`
    );
    if (queued === 0) throw new import_server9.AppError("CONFLICT", "No reminder could be sent: the patient has no email or phone number, or opted out");
    await dentalDb(tx).updateTable("plg_dental_recall").set({ status: "reminded", last_reminded_at: /* @__PURE__ */ new Date() }).where("tenant_id", "=", tenantId).where("customer_id", "=", input.customerId).where("rule_id", "=", input.ruleId).execute();
    await scope.audit({ action: "dental.recall.remind", targetType: "dental_recall", targetId: input.customerId, changes: { ruleId: input.ruleId, messages: queued } });
    return { messages: queued };
  }
});
var snoozeInput = recallRef.extend({ days: import_plugin_sdk9.z.union([import_plugin_sdk9.z.literal(30), import_plugin_sdk9.z.literal(60), import_plugin_sdk9.z.literal(90)]) });
var snoozeRecall = (0, import_server9.defineCommand)({
  name: "dental.recall.snooze",
  input: snoozeInput,
  authorize: (0, import_server9.requirePermission)("bookings.create"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const recall = await lockRecall(tx, tenantId, input.customerId, input.ruleId);
    if (recall.status === "done" || recall.status === "scheduled") throw new import_server9.AppError("CONFLICT", `A ${recall.status} recall cannot be snoozed`);
    const today = await tenantToday(tx, tenantId);
    const from = recall.due_on > today ? recall.due_on : today;
    const dueOn = addDays(from, input.days);
    await import_server9.sql`update plg_dental_recall set status = 'snoozed', due_on = ${dueOn}::date
      where tenant_id = ${tenantId} and customer_id = ${input.customerId} and rule_id = ${input.ruleId}`.execute(tx);
    await scope.audit({ action: "dental.recall.snooze", targetType: "dental_recall", targetId: input.customerId, changes: { ruleId: input.ruleId, days: input.days, dueOn } });
    return { dueOn };
  }
});
async function onRecallBookingEvent(tx, event, ctx) {
  const { tenantId } = ctx;
  const bookingId = event.aggregate_id;
  if (event.type === "booking.cancelled" || event.type === "booking.no_show") {
    await dentalDb(tx).updateTable("plg_dental_recall").set({ status: "upcoming", booking_id: null }).where("tenant_id", "=", tenantId).where("booking_id", "=", bookingId).where("status", "=", "scheduled").execute();
    return;
  }
  const booking = await tx.selectFrom("booking as b").innerJoin("location as l", (join) => join.onRef("l.tenant_id", "=", "b.tenant_id").onRef("l.id", "=", "b.location_id")).select(["b.customer_id", "b.starts_at", "l.time_zone"]).where("b.tenant_id", "=", tenantId).where("b.id", "=", bookingId).executeTakeFirst();
  if (!booking || booking.customer_id === null) return;
  const services = await tx.selectFrom("booking_item").select("service_id").where("tenant_id", "=", tenantId).where("booking_id", "=", bookingId).execute();
  if (services.length === 0) return;
  const rules = await dentalDb(tx).selectFrom("plg_dental_recall_rule").select(["id", "interval_months", "active"]).where("tenant_id", "=", tenantId).where("service_id", "in", services.map((s) => s.service_id)).execute();
  for (const rule of rules) {
    if (event.type === "booking.created") {
      if (!rule.active) continue;
      await dentalDb(tx).updateTable("plg_dental_recall").set({ status: "scheduled", booking_id: bookingId }).where("tenant_id", "=", tenantId).where("customer_id", "=", booking.customer_id).where("rule_id", "=", rule.id).where("status", "in", ["upcoming", "due", "reminded", "snoozed"]).execute();
    } else if (event.type === "booking.completed") {
      if (!rule.active) {
        await dentalDb(tx).updateTable("plg_dental_recall").set({ status: "done", booking_id: bookingId }).where("tenant_id", "=", tenantId).where("customer_id", "=", booking.customer_id).where("rule_id", "=", rule.id).execute();
        continue;
      }
      const completedOn = localDateOf(event.occurred_at.getTime(), booking.time_zone);
      await import_server9.sql`
        insert into plg_dental_recall (tenant_id, customer_id, rule_id, due_on, last_visit_at, status)
        values (${tenantId}, ${booking.customer_id}, ${rule.id}, (${completedOn}::date + make_interval(months => ${rule.interval_months}::int))::date, ${booking.starts_at}, 'upcoming')
        on conflict (tenant_id, customer_id, rule_id) do update
          set due_on = excluded.due_on, last_visit_at = excluded.last_visit_at, status = 'upcoming', booking_id = null, last_reminded_at = null`.execute(tx);
    }
  }
}

// src/server/plans/schedule.ts
var import_plugin_sdk10 = require("@appointit/plugin-sdk");
var import_server10 = require("@appointit/plugin-sdk/server");
var WINDOW_DAYS2 = 7;
var SEARCH_DAYS = 90;
var MAX_VISITS = 12;
var BOOKABLE = ["accepted", "in_progress"];
async function loadItems(tx, tenantId, planId) {
  return dentalDb(tx).selectFrom("plg_dental_plan_item as i").leftJoin("plg_dental_procedure as p", (join) => join.onRef("p.tenant_id", "=", "i.tenant_id").onRef("p.id", "=", "i.procedure_id")).leftJoin("service as s", (join) => join.onRef("s.tenant_id", "=", "i.tenant_id").onRef("s.id", "=", "i.service_id")).leftJoin("booking as b", (join) => join.onRef("b.tenant_id", "=", "i.tenant_id").onRef("b.id", "=", "i.booking_id")).select([
    "i.id",
    "i.seq",
    "i.service_id",
    "p.name as procedure_name",
    "s.name as service_name",
    "i.tooth",
    "i.min_gap_days",
    "i.max_gap_days",
    "i.status",
    "b.starts_at as booking_start",
    "b.ends_at as booking_end"
  ]).where("i.tenant_id", "=", tenantId).where("i.plan_id", "=", planId).where("i.status", "!=", "cancelled").orderBy("i.seq").execute();
}
function invalid2(path, message, extra = {}) {
  return new import_server10.AppError("INVALID_INPUT", message, { issues: [{ path, message, code: "custom" }], ...extra });
}
async function zoneOf(tx, tenantId, locationId) {
  const row = await tx.selectFrom("location").select("time_zone").where("tenant_id", "=", tenantId).where("id", "=", locationId).executeTakeFirst();
  if (!row) throw new import_server10.AppError("NOT_FOUND", "Location not found");
  return row.time_zone;
}
var preferencesInput = import_plugin_sdk10.z.record(import_plugin_sdk10.z.string().min(1).max(120), import_plugin_sdk10.z.uuid());
var findInput = import_plugin_sdk10.z.object({
  planId: import_plugin_sdk10.z.uuid(),
  locationId: import_plugin_sdk10.z.uuid(),
  /** First day to look at (YYYY-MM-DD, location time); default today. */
  from: import_plugin_sdk10.z.string().refine(isPlainDate, "Use YYYY-MM-DD").optional(),
  preferences: preferencesInput.optional()
});
async function firstSlot(tenantId, a) {
  let from = a.fromDate;
  let scanned = 0;
  while (scanned < SEARCH_DAYS) {
    const days = Math.min(WINDOW_DAYS2, SEARCH_DAYS - scanned);
    const result = await (0, import_server10.searchAvailability)(tenantId, {
      locationId: a.locationId,
      items: [{ serviceId: a.serviceId }],
      from,
      days,
      ...a.preferences !== void 0 && { preferences: a.preferences }
    });
    const slot = result.slots.filter((s) => Date.parse(s.start) >= a.minStartMs).sort((x, y) => Date.parse(x.start) - Date.parse(y.start))[0];
    if (slot) return { start: slot.start, end: slot.end };
    let next = addDays(from, days);
    if (result.limited && result.cursor !== void 0) {
      const cursorDate = localDateOf(Date.parse(result.cursor), result.timeZone);
      if (cursorDate > from && cursorDate < next) next = cursorDate;
      else if (cursorDate <= from) next = addDays(from, 1);
    }
    scanned += Math.max(1, daysBetween(from, next));
    from = next;
  }
  return null;
}
async function findPlanTimes(tenantId, rawInput) {
  const parsed = findInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new import_server10.AppError("INVALID_INPUT", "Invalid input", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })) });
  }
  const input = parsed.data;
  const { plan, items, timeZone } = await (0, import_server10.withTenantTx)(tenantId, async (tx) => {
    const plan2 = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").select(["id", "status"]).where("tenant_id", "=", tenantId).where("id", "=", input.planId).executeTakeFirst();
    if (!plan2) throw new import_server10.AppError("NOT_FOUND", "Treatment plan not found");
    return { plan: plan2, items: await loadItems(tx, tenantId, input.planId), timeZone: await zoneOf(tx, tenantId, input.locationId) };
  });
  if (plan.status === "cancelled" || plan.status === "completed") throw new import_server10.AppError("CONFLICT", `A ${plan.status} plan cannot be scheduled`);
  const today = localDateOf(Date.now(), timeZone);
  const startDate = input.from !== void 0 && input.from > today ? input.from : today;
  let prev = null;
  let broken = false;
  const visits = [];
  for (const item of items) {
    if (item.status !== "planned") {
      if (item.booking_start && item.booking_end) prev = { startMs: item.booking_start.getTime(), endMs: item.booking_end.getTime() };
      continue;
    }
    const base2 = {
      itemId: item.id,
      seq: item.seq,
      title: [item.procedure_name ?? item.service_name ?? "", item.tooth ? `#${item.tooth}` : ""].filter(Boolean).join(" "),
      serviceId: item.service_id,
      serviceName: item.service_name,
      start: null,
      end: null,
      gapDays: null,
      minGapDays: item.min_gap_days,
      maxGapDays: item.max_gap_days,
      gapExceeded: false,
      problem: null
    };
    if (!item.service_id) {
      visits.push({ ...base2, problem: "no_service" });
      broken = true;
      continue;
    }
    if (broken) {
      visits.push({ ...base2, problem: "after_unscheduled" });
      continue;
    }
    const prevDate = prev ? localDateOf(prev.startMs, timeZone) : null;
    let fromDate = prevDate ? addDays(prevDate, item.min_gap_days) : startDate;
    if (fromDate < startDate) fromDate = startDate;
    const minStartMs = prev && item.min_gap_days === 0 ? prev.endMs : 0;
    const slot = await firstSlot(tenantId, { locationId: input.locationId, serviceId: item.service_id, fromDate, minStartMs, preferences: input.preferences });
    if (!slot) {
      visits.push({ ...base2, problem: "no_slot" });
      broken = true;
      continue;
    }
    const slotDate = localDateOf(Date.parse(slot.start), timeZone);
    visits.push({
      ...base2,
      start: slot.start,
      end: slot.end,
      gapDays: prevDate ? daysBetween(prevDate, slotDate) : null,
      gapExceeded: prevDate !== null && item.max_gap_days !== null && daysBetween(prevDate, slotDate) > item.max_gap_days
    });
    prev = { startMs: Date.parse(slot.start), endMs: Date.parse(slot.end) };
  }
  return { timeZone, visits, complete: visits.every((v) => v.problem === null && !v.gapExceeded) };
}
var bookInput = import_plugin_sdk10.z.object({
  planId: import_plugin_sdk10.z.uuid(),
  expectedVersion: import_plugin_sdk10.z.number().int().min(1),
  locationId: import_plugin_sdk10.z.uuid(),
  /** One entry for every visit still to be booked, with the chosen start (ISO). */
  visits: import_plugin_sdk10.z.array(import_plugin_sdk10.z.object({ itemId: import_plugin_sdk10.z.uuid(), start: import_plugin_sdk10.z.string().min(10).max(40) })).min(1).max(MAX_VISITS),
  preferences: preferencesInput.optional(),
  /** Book even when a visit is later than its maximum gap. */
  allowLateGaps: import_plugin_sdk10.z.boolean().optional()
});
var bookPlan = (0, import_server10.defineCommand)({
  name: "dental.plan.book",
  input: bookInput,
  authorize: (0, import_server10.requirePermission)("bookings.create"),
  handler: async (tx, input, scope) => {
    const tenantId = scope.ctx.tenantId;
    const plan = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").selectAll().where("tenant_id", "=", tenantId).where("id", "=", input.planId).forUpdate().executeTakeFirst();
    if (!plan) throw new import_server10.AppError("NOT_FOUND", "Treatment plan not found");
    if (plan.version !== input.expectedVersion) throw new import_server10.AppError("VERSION_CONFLICT", "This plan was changed by someone else", { currentVersion: plan.version });
    if (!BOOKABLE.includes(plan.status)) throw new import_server10.AppError("CONFLICT", plan.status === "completed" || plan.status === "cancelled" ? `A ${plan.status} plan cannot be booked` : "The patient has to accept the plan before its visits are booked");
    const timeZone = await zoneOf(tx, tenantId, input.locationId);
    const items = await loadItems(tx, tenantId, plan.id);
    const planned = items.filter((i) => i.status === "planned");
    const chosen = new Map(input.visits.map((v) => [v.itemId, v.start]));
    if (chosen.size !== input.visits.length) throw invalid2("visits", "A visit is listed twice");
    if (planned.length === 0) throw new import_server10.AppError("CONFLICT", "Every visit of this plan is already booked");
    for (const v of input.visits) {
      if (!planned.some((i) => i.id === v.itemId)) throw invalid2("visits", "A listed visit is not part of this plan or is already booked");
    }
    for (const item of planned) {
      if (!chosen.has(item.id)) throw invalid2("visits", "Choose a time for every visit of the plan");
      if (!item.service_id) throw invalid2("visits", `"${item.procedure_name ?? "A treatment"}" has no service to book`);
    }
    if (planned.length > MAX_VISITS) throw invalid2("visits", `At most ${MAX_VISITS} visits can be booked at once`);
    let prev = null;
    for (const item of items) {
      const startText = item.status === "planned" ? chosen.get(item.id) : item.booking_start?.toISOString() ?? null;
      const startMs = startText === null || startText === void 0 ? Number.NaN : Date.parse(startText);
      if (item.status !== "planned") {
        if (!Number.isNaN(startMs)) prev = { startMs, date: localDateOf(startMs, timeZone) };
        continue;
      }
      const index = input.visits.findIndex((v) => v.itemId === item.id);
      if (Number.isNaN(startMs)) throw invalid2(`visits.${index}.start`, "This is not a valid time");
      const date = localDateOf(startMs, timeZone);
      if (prev) {
        if (startMs <= prev.startMs) throw invalid2(`visits.${index}.start`, "Visits must follow each other in the planned order", { visit: index });
        const gap = daysBetween(prev.date, date);
        if (gap < item.min_gap_days) throw invalid2(`visits.${index}.start`, `This visit needs at least ${item.min_gap_days} day(s) after the previous one`, { visit: index });
        if (item.max_gap_days !== null && gap > item.max_gap_days && input.allowLateGaps !== true) {
          throw invalid2(`visits.${index}.start`, `This visit is more than ${item.max_gap_days} day(s) after the previous one`, { visit: index, gapExceeded: true });
        }
      }
      prev = { startMs, date };
    }
    const series = await import_server10.createSeries.runInTx(tx, scope.ctx, {
      locationId: input.locationId,
      kind: "treatment_plan",
      customer: { id: plan.customer_id },
      visits: planned.map((item) => ({
        items: [{ serviceId: item.service_id }],
        start: chosen.get(item.id),
        ...input.preferences !== void 0 && { preferences: input.preferences }
      })),
      source: "admin"
    });
    for (let i = 1; i < series.bookings.length; i++) {
      const before = series.bookings[i - 1];
      const now = series.bookings[i];
      if (before && now && Date.parse(now.start) < Date.parse(before.end)) {
        throw invalid2(`visits.${i}.start`, "This visit starts before the previous one ends", { visit: i });
      }
    }
    for (const [i, item] of planned.entries()) {
      await dentalDb(tx).updateTable("plg_dental_plan_item").set({ status: "booked", booking_id: series.bookings[i]?.bookingId ?? null }).where("tenant_id", "=", tenantId).where("id", "=", item.id).execute();
    }
    const updated = await dentalDb(tx).updateTable("plg_dental_treatment_plan").set({ series_id: series.seriesId, status: "in_progress", version: import_server10.sql`version + 1` }).where("tenant_id", "=", tenantId).where("id", "=", plan.id).returning("version").executeTakeFirstOrThrow();
    await scope.audit({
      action: "dental.plan.book",
      targetType: "dental_treatment_plan",
      targetId: plan.id,
      targetVersion: updated.version,
      changes: { seriesId: series.seriesId, bookingIds: series.bookings.map((b) => b.bookingId), starts: series.bookings.map((b) => b.start) }
    });
    return { planId: plan.id, version: updated.version, seriesId: series.seriesId, bookings: series.bookings };
  }
});

// src/server/plans/index.ts
function registerPlans(api) {
  api.registerSubscriber("dental.plans.bookings", {
    events: ["booking.completed", "booking.cancelled", "booking.no_show"],
    handle: onPlanBookingEvent
  });
  api.registerSubscriber("dental.recall.bookings", {
    events: ["booking.created", "booking.completed", "booking.cancelled", "booking.no_show"],
    handle: onRecallBookingEvent
  });
  api.registerTask(RECALL_DAILY_TASK, async () => {
    await runRecallDaily();
  });
}

// src/server/privacy.ts
var import_server11 = require("@appointit/plugin-sdk/server");
var CHART_NOTES_FIELD = "dental.chart.notes";
var PLAN_NOTES_FIELD = "plg_dental_treatment_plan.notes";
var iso2 = (d) => d ? d.toISOString() : null;
var parse = (json) => JSON.parse(json);
function registerPrivacy(_api) {
  (0, import_server11.registerPrivacyHandler)({
    id: "dental",
    async export({ tx, tenantId, customerIds, logRead }) {
      const ids = [...customerIds];
      const historyRows = await dentalDb(tx).selectFrom("plg_dental_medical_history").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "in", ids).execute();
      const medicalHistory = [];
      for (const h of historyRows) {
        await logRead("dental.medical_history", h.customer_id);
        medicalHistory.push({
          customerId: h.customer_id,
          document: parse((0, import_server11.decryptField)(h.data_enc, { tenantId, field: `plg_dental_medical_history.data:${h.customer_id}` })),
          alerts: h.alerts_enc ? parse((0, import_server11.decryptField)(h.alerts_enc, { tenantId, field: `plg_dental_medical_history.alerts:${h.customer_id}` })) : [],
          reviewedAt: iso2(h.reviewed_at),
          reviewDueAt: iso2(h.review_due_at),
          updatedAt: iso2(h.updated_at)
        });
      }
      const insuranceRows = await dentalDb(tx).selectFrom("plg_dental_insurance").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "in", ids).execute();
      const insurance = [];
      for (const i of insuranceRows) {
        if (i.member_id_enc) await logRead("dental.insurance", i.customer_id);
        insurance.push({
          customerId: i.customer_id,
          carrier: i.carrier,
          memberId: i.member_id_enc ? (0, import_server11.decryptField)(i.member_id_enc, { tenantId, field: `plg_dental_insurance.member_id:${i.id}` }) : null,
          groupNumber: i.group_number,
          subscriberName: i.subscriber_name,
          subscriberRelationship: i.subscriber_relationship,
          isPrimary: i.is_primary,
          validTo: i.valid_to
        });
      }
      const chartRows = await dentalDb(tx).selectFrom("plg_dental_chart_entry").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "in", ids).orderBy("recorded_at").execute();
      const withNotes = new Set(chartRows.filter((e) => e.notes_enc !== null).map((e) => e.customer_id));
      for (const customerId of withNotes) await logRead("dental.chart", customerId);
      const chart = chartRows.map((e) => ({
        customerId: e.customer_id,
        tooth: e.tooth,
        surfaces: e.surfaces,
        kind: e.kind,
        condition: e.condition,
        status: e.status,
        notes: e.notes_enc ? (0, import_server11.decryptField)(e.notes_enc, { tenantId, field: CHART_NOTES_FIELD }) : null,
        recordedAt: iso2(e.recorded_at)
      }));
      const planRows = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "in", ids).orderBy("created_at").execute();
      const planIds = planRows.map((p2) => p2.id);
      const itemRows = planIds.length ? await dentalDb(tx).selectFrom("plg_dental_plan_item").selectAll().where("tenant_id", "=", tenantId).where("plan_id", "in", planIds).orderBy("seq").execute() : [];
      const plans = [];
      for (const p2 of planRows) {
        if (p2.notes_enc) await logRead("dental.treatment_plan", p2.customer_id);
        plans.push({
          customerId: p2.customer_id,
          title: p2.title,
          status: p2.status,
          currency: p2.currency,
          estimateMinor: p2.estimate_minor,
          insuranceEstimateMinor: p2.insurance_estimate_minor,
          notes: p2.notes_enc ? (0, import_server11.decryptField)(p2.notes_enc, { tenantId, field: PLAN_NOTES_FIELD }) : null,
          acceptedAt: iso2(p2.accepted_at),
          createdAt: iso2(p2.created_at),
          items: itemRows.filter((i) => i.plan_id === p2.id).map((i) => ({ seq: i.seq, tooth: i.tooth, surfaces: i.surfaces, priceMinor: i.price_minor, status: i.status }))
        });
      }
      const recallRows = await dentalDb(tx).selectFrom("plg_dental_recall").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "in", ids).execute();
      const recalls = recallRows.map((r) => ({ customerId: r.customer_id, dueOn: r.due_on, status: r.status, lastVisitAt: iso2(r.last_visit_at) }));
      return { medicalHistory, insurance, chart, treatmentPlans: plans, recalls };
    },
    async erase({ tx, tenantId, customerIds }) {
      const ids = [...customerIds];
      const history = await dentalDb(tx).deleteFrom("plg_dental_medical_history").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).returning("customer_id").execute();
      const insurance = await dentalDb(tx).deleteFrom("plg_dental_insurance").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).returning("id").execute();
      const chartNotes = await dentalDb(tx).updateTable("plg_dental_chart_entry").set({ notes_enc: null, version: import_server11.sql`version + 1` }).where("tenant_id", "=", tenantId).where("customer_id", "in", ids).where("notes_enc", "is not", null).returning("id").execute();
      const acceptance = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").select("acceptance_file_id").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).where("acceptance_file_id", "is not", null).execute();
      const planNotes = await dentalDb(tx).updateTable("plg_dental_treatment_plan").set({ notes_enc: null, acceptance_file_id: null, version: import_server11.sql`version + 1` }).where("tenant_id", "=", tenantId).where("customer_id", "in", ids).where((eb) => eb.or([eb("notes_enc", "is not", null), eb("acceptance_file_id", "is not", null)])).returning("id").execute();
      const recalls = await dentalDb(tx).deleteFrom("plg_dental_recall").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).returning("customer_id").execute();
      return {
        counts: {
          history: history.length,
          insurance: insurance.length,
          chartNotes: chartNotes.length,
          planNotes: planNotes.length,
          recalls: recalls.length
        },
        fileIds: acceptance.map((a) => a.acceptance_file_id)
      };
    }
  });
}

// src/server/routes.ts
var import_server13 = require("@appointit/plugin-sdk/server");

// src/setup/apply.ts
var import_plugin_sdk11 = require("@appointit/plugin-sdk");
var import_server12 = require("@appointit/plugin-sdk/server");

// src/setup/data/pages.ts
function builder(prefix) {
  let n = 0;
  const id = () => `${prefix}${++n}`;
  const N = (type, props = {}, base2 = {}, children, mobile) => ({
    id: id(),
    type,
    props,
    style: { base: base2, ...mobile ? { mobile } : {} },
    ...children ? { children } : {}
  });
  const heading = (tag, text3, base2 = {}) => N("heading", { text: text3, tag }, base2);
  const text2 = (html, base2 = {}) => N("text", { html }, base2);
  const button = (label, o = {}) => N("button", { text: label, action: o.action ?? "link", link: o.link ?? "", variant: o.variant ?? "primary", size: "md" });
  const row = (kids, base2 = {}) => N("row", {}, base2, kids);
  const cell = (kids) => N("cell", {}, {}, kids);
  const columns = (kids, base2 = {}) => N("columns", {}, { cols: String(kids.length), gap: "48px", ...base2 }, kids, { cols: "1" });
  const section = (name, kids, base2 = {}, mobile) => ({
    id: id(),
    type: "section",
    props: { name, anchor: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") },
    style: { base: base2, ...mobile ? { mobile } : {} },
    children: kids
  });
  return { N, heading, text: text2, button, row, cell, columns, section };
}
var HOURS = "Monday to Friday 9:00 to 17:00\nSaturday 9:00 to 13:00\nSunday closed";
function homePage() {
  const b = builder("dh");
  return {
    slug: "home",
    title: "Home",
    home: true,
    seo: { title: "Dental care for the whole family", desc: "Check-ups, cleaning, fillings and more. Book your visit online." },
    nodes: [
      b.section(
        "Hero",
        [
          b.heading("h1", "Gentle dental care for the whole family", { align: "center" }),
          b.text("<p>Check-ups, cleaning, fillings and more. Book your visit online in a minute.</p>", { align: "center", color: "muted", fs: "L" }),
          b.row([b.button("Book an appointment", { action: "booking" }), b.button("New patients", { link: "/new-patients", variant: "outline" })], { justify: "center" })
        ],
        { pad: "112px 24px", align: "center" },
        { pad: "64px 16px" }
      ),
      b.section("Services", [
        b.heading("h2", "Our services", { align: "center" }),
        b.text("<p>What we can do for you.</p>", { align: "center", color: "muted" }),
        b.N("services", { count: "6", card: "bordered" })
      ]),
      b.section(
        "Book a visit",
        [
          b.heading("h2", "Ready for your next visit?", { align: "center" }),
          b.text("<p>Pick a time that suits you. We confirm by message.</p>", { align: "center" }),
          b.row([b.button("Book an appointment", { action: "booking", variant: "outline" })], { justify: "center" })
        ],
        { bg: "brand", align: "center" }
      ),
      contactSection(b)
    ]
  };
}
function newPatientsPage() {
  const b = builder("dn");
  return {
    slug: "new-patients",
    title: "New patients",
    seo: { title: "New patients", desc: "What to expect at your first visit and how to book it." },
    nodes: [
      b.section(
        "Hero",
        [
          b.heading("h1", "New patients are welcome", { align: "center" }),
          b.text("<p>Here is how your first visit works.</p>", { align: "center", color: "muted", fs: "L" }),
          b.row([b.button("Book your first visit", { action: "booking" })], { justify: "center" })
        ],
        { pad: "112px 24px", align: "center" },
        { pad: "64px 16px" }
      ),
      b.section("Your first visit", [
        b.heading("h2", "Your first visit"),
        b.N("list", {
          items: [
            "Fill in the short new patient form online before you come",
            "Arrive a few minutes early and bring your ID and insurance card if you have one",
            "Meet your dentist and tell us what you would like",
            "Leave with a clear plan and price before any treatment starts"
          ].join("\n")
        }),
        b.row([b.button("Fill in the new patient form", { link: `/f/${INTAKE_FORM_SLUG}`, variant: "outline" })])
      ]),
      b.section("Services", [
        b.heading("h2", "Our services", { align: "center" }),
        b.N("services", { count: "6", card: "bordered" })
      ]),
      b.section(
        "Book a visit",
        [
          b.heading("h2", "Book your first visit", { align: "center" }),
          b.row([b.button("Book an appointment", { action: "booking", variant: "outline" })], { justify: "center" })
        ],
        { bg: "brand", align: "center" }
      ),
      contactSection(b)
    ]
  };
}
function contactSection(b) {
  return b.section("Contact", [
    b.columns([
      b.cell([b.heading("h2", "Opening hours"), b.N("list", { items: HOURS })]),
      b.cell([
        b.heading("h2", "Find us"),
        b.text("<p>Your clinic address<br>Your city</p>", { color: "muted" }),
        b.button("Call us", { link: "tel:", variant: "outline" })
      ])
    ])
  ]);
}
var PAGES_PACK = [homePage(), newPatientsPage()];

// src/setup/data/procedures.ts
var p = (code, name, category, priceMinor, service) => ({
  code,
  name,
  category,
  priceMinor,
  service
});
var PROCEDURES_PACK = [
  p("EXAM-NP", "New patient exam", "Diagnostic", 9500, "new-patient-exam"),
  p("EXAM-PD", "Periodic check-up", "Diagnostic", 6e3, "cleaning-and-check-up"),
  p("XRAY-BW", "Bitewing X-rays", "Diagnostic", 4500, "new-patient-exam"),
  p("XRAY-PAN", "Panoramic X-ray", "Diagnostic", 9e3, "new-patient-exam"),
  p("CLEAN", "Cleaning", "Preventive", 8500, "cleaning-and-check-up"),
  p("FLUOR", "Fluoride treatment", "Preventive", 3e3, "cleaning-and-check-up"),
  p("SEAL", "Sealant", "Preventive", 4e3, "filling"),
  p("FILL-1", "Filling, one surface", "Restorative", 18e3, "filling"),
  p("FILL-2", "Filling, two surfaces", "Restorative", 24e3, "filling"),
  p("FILL-3", "Filling, three surfaces", "Restorative", 3e4, "filling"),
  p("ROOT-1", "Root canal, front tooth", "Endodontics", 65e3, "root-canal-visit"),
  p("ROOT-2", "Root canal, back tooth", "Endodontics", 95e3, "root-canal-visit"),
  p("ROOT-TEMP", "Temporary filling", "Endodontics", 7e3, "root-canal-visit"),
  p("WHITE", "Whitening", "Cosmetic", 3e4, "whitening"),
  p("WHITE-TU", "Whitening touch-up", "Cosmetic", 15e3, "whitening"),
  p("EMERG-EX", "Emergency exam", "Emergency", 15e3, "emergency-visit"),
  p("EMERG-REL", "Emergency relief visit", "Emergency", 2e4, "emergency-visit")
];

// src/setup/data/recall.ts
var RECALL_PACK = [
  { name: "Cleaning every 6 months", service: "cleaning-and-check-up", intervalMonths: 6, leadDays: 14 }
];

// src/setup/data/resource-types.ts
var RESOURCE_TYPES_PACK = [
  { key: "dentist", name: "Dentist", kind: "person" },
  { key: "hygienist", name: "Hygienist", kind: "person" },
  { key: "assistant", name: "Dental assistant", kind: "person" },
  { key: "operatory", name: "Operatory", kind: "space" },
  { key: "imaging", name: "Imaging equipment", kind: "equipment" }
];

// src/setup/data/services.ts
var operatory = { key: "operatory", typeKey: "operatory", bufferAfterMin: 10 };
var SERVICES_PACK = [
  {
    slug: "new-patient-exam",
    name: "New patient exam",
    category: "Check-ups",
    description: "Your first visit: we get to know you, look after your teeth and plan your care.",
    durationMin: 60,
    startStepMin: 15,
    priceMinor: 9500,
    priceType: "fixed",
    needs: [{ key: "dentist", typeKey: "dentist" }, operatory],
    form: INTAKE_FORM_SLUG
  },
  {
    slug: "cleaning-and-check-up",
    name: "Cleaning and check-up",
    category: "Check-ups",
    description: "A regular cleaning with a short check by the dentist at the end.",
    durationMin: 60,
    startStepMin: 15,
    priceMinor: 12e3,
    priceType: "fixed",
    // The hygienist is with the patient the whole visit; the dentist joins for the last 15 minutes.
    needs: [
      { key: "hygienist", typeKey: "hygienist" },
      { key: "dentist", typeKey: "dentist", offsetMin: 45, lengthMin: 15 },
      operatory
    ]
  },
  {
    slug: "filling",
    name: "Filling",
    category: "Treatments",
    description: "Repair a tooth in one visit.",
    durationMin: 45,
    startStepMin: 15,
    priceMinor: 18e3,
    priceType: "from",
    needs: [{ key: "dentist", typeKey: "dentist" }, { key: "assistant", typeKey: "assistant" }, operatory],
    form: CONSENT_FORM_SLUG
  },
  {
    slug: "root-canal-visit",
    name: "Root canal visit",
    category: "Treatments",
    description: "One visit of a longer treatment. Your dentist tells you how many visits you need.",
    durationMin: 90,
    startStepMin: 30,
    priceMinor: 65e3,
    priceType: "from",
    needs: [{ key: "dentist", typeKey: "dentist" }, { key: "assistant", typeKey: "assistant" }, operatory],
    form: CONSENT_FORM_SLUG
  },
  {
    slug: "whitening",
    name: "Whitening",
    category: "Cosmetic",
    description: "A professional whitening visit.",
    durationMin: 60,
    startStepMin: 30,
    priceMinor: 3e4,
    priceType: "fixed",
    needs: [{ key: "hygienist", typeKey: "hygienist" }, operatory],
    form: CONSENT_FORM_SLUG
  },
  {
    slug: "emergency-visit",
    name: "Emergency visit",
    category: "Emergency",
    description: "A short visit for something that cannot wait. Same-day times can be booked.",
    durationMin: 30,
    startStepMin: 15,
    priceMinor: 15e3,
    priceType: "fixed",
    needs: [{ key: "dentist", typeKey: "dentist" }, operatory],
    // Short notice allowed: it can be booked right away.
    policy: { noticeMin: 0 }
  }
];

// src/setup/data/vocabulary.ts
var VOCABULARY_PACK = {
  "term.customer": "patient",
  "term.customers": "patients",
  "nav.team": "Dental team",
  "nav.resources": "Dentists and operatories"
};

// src/setup/types.ts
var SETUP_PARTS = ["vocabulary", "resourceTypes", "services", "procedures", "recall", "forms", "pages"];

// src/setup/apply.ts
var lower = (s) => s.trim().toLowerCase();
var zeros = () => ({ vocabulary: 0, resourceTypes: 0, services: 0, procedures: 0, recall: 0, forms: 0, pages: 0 });
function findService(rows, pack) {
  return rows.find((r) => r.slug === pack.slug) ?? rows.find((r) => lower(r.name) === lower(pack.name));
}
function serviceOf(rows, slug) {
  const pack = SERVICES_PACK.find((s) => s.slug === slug);
  return { pack, row: pack ? findService(rows, pack) : void 0 };
}
async function loadServices(tx, tenantId) {
  return tx.selectFrom("service").select(["id", "name", "slug", "current_version", "status"]).where("tenant_id", "=", tenantId).execute();
}
async function vocabularyOf(tx, tenantId) {
  const row = await tx.selectFrom("tenant").select(["settings", "version"]).where("id", "=", tenantId).executeTakeFirst();
  const raw = row?.settings?.vocabulary;
  const words = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [key, label] of Object.entries(raw)) if (typeof label === "string" && label.trim() !== "") words[key] = label.trim();
  }
  return { version: row?.version ?? 1, words };
}
async function locationsOf(tx, tenantId) {
  return tx.selectFrom("location").select(["id", "currency"]).where("tenant_id", "=", tenantId).orderBy("created_at").execute();
}
async function missingTeam(tx, tenantId, locationId, pack) {
  const missing = [];
  for (const need of pack.needs) {
    const found = await tx.selectFrom("resource").innerJoin("resource_type", (join) => join.onRef("resource_type.tenant_id", "=", "resource.tenant_id").onRef("resource_type.id", "=", "resource.type_id")).select(import_server12.sql`count(*)::int`.as("n")).where("resource.tenant_id", "=", tenantId).where("resource.status", "=", "active").where("resource_type.key", "=", need.typeKey).$if(locationId !== null, (qb) => qb.where("resource.location_id", "=", locationId)).executeTakeFirstOrThrow();
    if (found.n < 1 && !missing.includes(need.typeKey)) missing.push(need.typeKey);
  }
  return missing;
}
var typeName = (key) => RESOURCE_TYPES_PACK.find((t) => t.key === key)?.name ?? key;
async function consentMap(tx, tenantId) {
  const row = await tx.selectFrom("plugin_setting").select("settings").where("tenant_id", "=", tenantId).where("plugin_id", "=", DENTAL_PLUGIN_ID2).executeTakeFirst();
  const raw = row?.settings?.consentForms;
  const out = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [serviceId, slug] of Object.entries(raw)) if (typeof slug === "string" && slug !== "") out[serviceId] = slug;
  }
  return out;
}
var applySetupCommand = (0, import_server12.defineCommand)({
  name: "dental.applySetup",
  input: import_plugin_sdk11.z.object({ parts: import_plugin_sdk11.z.array(import_plugin_sdk11.z.enum(SETUP_PARTS)).min(1).max(SETUP_PARTS.length).optional() }),
  authorize: (0, import_server12.requirePermission)("settings.manage"),
  handler: async (tx, input, scope) => {
    const ctx = scope.ctx;
    const tenantId = ctx.tenantId;
    const wanted = new Set(input.parts ?? SETUP_PARTS);
    const result = { created: zeros(), skipped: zeros(), warnings: [] };
    const locations = await locationsOf(tx, tenantId);
    const currency = locations[0]?.currency ?? null;
    const serviceLocationId = locations.length === 1 ? locations[0]?.id ?? null : null;
    const newServiceSlugs = /* @__PURE__ */ new Set();
    const newFormSlugs = /* @__PURE__ */ new Set();
    if (wanted.has("vocabulary")) {
      const { version, words } = await vocabularyOf(tx, tenantId);
      const added = {};
      for (const [key, label] of Object.entries(VOCABULARY_PACK)) {
        if (words[key] !== void 0) result.skipped.vocabulary += 1;
        else {
          added[key] = label;
          result.created.vocabulary += 1;
        }
      }
      if (Object.keys(added).length > 0) await import_server12.setVocabulary.runInTx(tx, ctx, { expectedVersion: version, vocabulary: { ...words, ...added } });
    }
    if (wanted.has("resourceTypes")) {
      const have = new Set((await tx.selectFrom("resource_type").select("key").where("tenant_id", "=", tenantId).execute()).map((r) => r.key));
      for (const type of RESOURCE_TYPES_PACK) {
        if (have.has(type.key)) result.skipped.resourceTypes += 1;
        else {
          await import_server12.createResourceType.runInTx(tx, ctx, type);
          result.created.resourceTypes += 1;
        }
      }
    }
    if (wanted.has("services")) {
      if (locations.length === 0) result.warnings.push("Add a location first: services belong to a location.");
      else {
        const rows = await loadServices(tx, tenantId);
        for (const pack of SERVICES_PACK) {
          let serviceId;
          const existing = findService(rows, pack);
          if (existing) {
            if (existing.current_version !== null || existing.status === "archived") {
              result.skipped.services += 1;
              continue;
            }
            serviceId = existing.id;
          } else {
            const created2 = await import_server12.createService.runInTx(tx, ctx, {
              name: pack.name,
              slug: pack.slug,
              category: pack.category,
              description: pack.description,
              ...serviceLocationId !== null && { locationId: serviceLocationId }
            });
            serviceId = created2.id;
            newServiceSlugs.add(pack.slug);
          }
          const missing = await missingTeam(tx, tenantId, serviceLocationId, pack);
          if (missing.length > 0) {
            result.warnings.push(`${pack.name} was added as a draft. Add ${missing.map(typeName).join(" and ")} under Resources, then add the missing items again to publish it.`);
            if (existing === void 0) result.created.services += 1;
            continue;
          }
          await import_server12.publishServiceVersion.runInTx(tx, ctx, {
            serviceId,
            durationMin: pack.durationMin,
            startStepMin: pack.startStepMin,
            priceMinor: pack.priceMinor,
            ...currency !== null && { currency },
            priceType: pack.priceType,
            needs: pack.needs.map((n) => ({
              key: n.key,
              selector: { typeKey: n.typeKey },
              ...n.offsetMin !== void 0 && { offsetMin: n.offsetMin },
              ...n.lengthMin !== void 0 && { lengthMin: n.lengthMin },
              ...n.bufferAfterMin !== void 0 && { bufferAfterMin: n.bufferAfterMin },
              ...n.pick !== void 0 && { pick: n.pick }
            })),
            ...pack.policy && { policy: pack.policy }
          });
          result.created.services += 1;
        }
      }
    }
    if (wanted.has("procedures")) {
      const rows = await dentalDb(tx).selectFrom("plg_dental_procedure").select(["code", "name"]).where("tenant_id", "=", tenantId).execute();
      const codes = new Set(rows.flatMap((r) => r.code === null ? [] : [lower(r.code)]));
      const names = new Set(rows.map((r) => lower(r.name)));
      const services = await loadServices(tx, tenantId);
      for (const pack of PROCEDURES_PACK) {
        if (pack.code !== null && codes.has(lower(pack.code)) || names.has(lower(pack.name))) {
          result.skipped.procedures += 1;
          continue;
        }
        const { row } = serviceOf(services, pack.service);
        await createProcedure.runInTx(tx, ctx, {
          code: pack.code,
          name: pack.name,
          category: pack.category,
          ...currency !== null && { defaultPriceMinor: pack.priceMinor, currency },
          ...row && { serviceId: row.id }
        });
        result.created.procedures += 1;
      }
    }
    if (wanted.has("recall")) {
      const have = new Set((await dentalDb(tx).selectFrom("plg_dental_recall_rule").select("name").where("tenant_id", "=", tenantId).execute()).map((r) => lower(r.name)));
      const services = await loadServices(tx, tenantId);
      for (const pack of RECALL_PACK) {
        if (have.has(lower(pack.name))) {
          result.skipped.recall += 1;
          continue;
        }
        const { pack: service, row } = serviceOf(services, pack.service);
        if (!row) {
          result.warnings.push(`The recall "${pack.name}" needs the service "${service?.name ?? pack.service}". Add the services first.`);
          continue;
        }
        await saveRecallRule.runInTx(tx, ctx, { name: pack.name, serviceId: row.id, intervalMonths: pack.intervalMonths, leadDays: pack.leadDays, active: true });
        result.created.recall += 1;
      }
    }
    if (wanted.has("forms")) {
      const have = new Set((await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).execute()).map((r) => r.slug));
      for (const pack of FORMS_PACK) {
        if (have.has(pack.slug)) {
          result.skipped.forms += 1;
          continue;
        }
        const form = await import_server12.createForm.runInTx(tx, ctx, { name: pack.name, purpose: pack.purpose, slug: pack.slug, draft: pack.content });
        await import_server12.publishForm.runInTx(tx, ctx, { id: form.id, expectedVersion: form.version });
        newFormSlugs.add(pack.slug);
        result.created.forms += 1;
      }
    }
    if (wanted.has("forms") && newFormSlugs.has(BOOKING_FORM_SLUG)) {
      const site = await tx.selectFrom("site").select(["settings", "version"]).where("tenant_id", "=", tenantId).executeTakeFirst();
      const chosen = site?.settings?.bookingFormSlug;
      if (typeof chosen !== "string" || chosen === "") {
        await import_server12.updateSite.runInTx(tx, ctx, { expectedVersion: site?.version ?? 0, bookingFormSlug: BOOKING_FORM_SLUG });
      }
    }
    if (wanted.has("services") || wanted.has("forms")) {
      const services = await loadServices(tx, tenantId);
      const forms = new Set((await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).execute()).map((r) => r.slug));
      const map = await consentMap(tx, tenantId);
      const added = {};
      for (const pack of SERVICES_PACK) {
        const row = findService(services, pack);
        if (!pack.form || !row || !forms.has(pack.form) || map[row.id] !== void 0) continue;
        if (newServiceSlugs.has(pack.slug) || newFormSlugs.has(pack.form)) added[row.id] = pack.form;
      }
      if (Object.keys(added).length > 0) await setConsentFormsCommand.runInTx(tx, ctx, { consentForms: { ...map, ...added } });
    }
    if (wanted.has("pages")) {
      const rows = await tx.selectFrom("page").select(["id", "slug", "status"]).where("tenant_id", "=", tenantId).execute();
      const site = await tx.selectFrom("site").select("settings").where("tenant_id", "=", tenantId).executeTakeFirst();
      const hasHome = typeof site?.settings?.homePageId === "string";
      for (const pack of PAGES_PACK) {
        const existing = rows.find((r) => r.slug === pack.slug);
        let pageId;
        let published;
        if (existing) {
          result.skipped.pages += 1;
          pageId = existing.id;
          published = existing.status === "published";
        } else {
          const page = await import_server12.createPage.runInTx(tx, ctx, { title: pack.title, slug: pack.slug, draft: { nodes: pack.nodes }, seo: pack.seo });
          await import_server12.publishPage.runInTx(tx, ctx, { id: page.id, expectedVersion: page.version });
          pageId = page.id;
          published = true;
          result.created.pages += 1;
        }
        if (pack.home && !hasHome && published) await import_server12.setHomePage.runInTx(tx, ctx, { id: pageId });
      }
    }
    await scope.audit({
      action: "dental.applySetup",
      targetType: "plugin_setting",
      targetId: DENTAL_PLUGIN_ID2,
      changes: { parts: [...wanted], created: result.created, skipped: result.skipped }
    });
    return result;
  }
});
function applyDentalSetup(ctx, input = {}) {
  return applySetupCommand.run(ctx, input);
}
async function getDentalSetupStatus(ctx) {
  (0, import_server12.requirePermission)("settings.manage")(ctx);
  const tenantId = ctx.tenantId;
  return (0, import_server12.withTenantTx)(tenantId, async (tx) => {
    const { words } = await vocabularyOf(tx, tenantId);
    const typeKeys = new Set((await tx.selectFrom("resource_type").select("key").where("tenant_id", "=", tenantId).execute()).map((r) => r.key));
    const services = await loadServices(tx, tenantId);
    const procedures = await dentalDb(tx).selectFrom("plg_dental_procedure").select(["code", "name"]).where("tenant_id", "=", tenantId).execute();
    const rules = new Set((await dentalDb(tx).selectFrom("plg_dental_recall_rule").select("name").where("tenant_id", "=", tenantId).execute()).map((r) => lower(r.name)));
    const forms = new Set((await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).execute()).map((r) => r.slug));
    const pages = new Set((await tx.selectFrom("page").select("slug").where("tenant_id", "=", tenantId).execute()).map((r) => r.slug));
    const codes = new Set(procedures.flatMap((r) => r.code === null ? [] : [lower(r.code)]));
    const names = new Set(procedures.map((r) => lower(r.name)));
    const count = (items, has) => ({ total: items.length, present: items.filter(has).length });
    const parts = {
      vocabulary: count(Object.keys(VOCABULARY_PACK), (key) => words[key] !== void 0),
      resourceTypes: count(RESOURCE_TYPES_PACK, (t) => typeKeys.has(t.key)),
      // A service counts once it has a published version (an unpublished one is finished by the next run).
      services: count(SERVICES_PACK, (s) => {
        const row = findService(services, s);
        return row !== void 0 && (row.current_version !== null || row.status === "archived");
      }),
      procedures: count(PROCEDURES_PACK, (p2) => p2.code !== null && codes.has(lower(p2.code)) || names.has(lower(p2.name))),
      recall: count(RECALL_PACK, (r) => rules.has(lower(r.name))),
      forms: count(FORMS_PACK, (f) => forms.has(f.slug)),
      pages: count(PAGES_PACK, (p2) => pages.has(p2.slug))
    };
    return { parts: SETUP_PARTS.map((part) => ({ part, ...parts[part] })) };
  });
}

// src/server/routes.ts
var admin = (method, path, permission, handler) => ({ method, path, auth: "admin", permission, handler });
function param({ params }, name) {
  const value = params[name];
  if (value === void 0) throw new import_server13.AppError("NOT_FOUND", "Not found");
  return value;
}
var DENTAL_ROUTES = [
  // ---- Alerts and consent ----
  // The service -> consent form slug mapping ({ [serviceId]: slug }) behind the admin picker.
  admin("GET", "/alerts/consent/forms", "plugins.manage", ({ tenantId }) => getConsentForms(tenantId)),
  // Body: { consentForms: { [serviceId]: slug } } replaces the mapping (plugins.manage). Other plugin settings are kept.
  admin("PUT", "/alerts/consent/forms", "plugins.manage", async ({ ctx, body }) => setConsentForms(ctx, (await body()).consentForms)),
  // ?bookingId=... -> { needed, customerId, forms: [{ slug, name, serviceId, signed, link }] }. Needs bookings.read.
  admin("GET", "/alerts/consent", "bookings.read", ({ ctx, query }) => getConsentStatus(ctx, query.required("bookingId"))),
  // ?customerIds=a,b,c (up to 200) -> [{ customerId, hasAlerts, labels? }]. Needs bookings.read; labels (decrypted and
  // logged) only come back for members who also hold health.read.
  admin("GET", "/alerts", "bookings.read", ({ ctx, query }) => listAlerts(ctx, query.list("customerIds"))),
  // ---- Dental chart ----
  // What happened on the chart, newest first. Optional ?tooth=16 (FDI). Needs health.read; the read is audited.
  admin("GET", "/chart/:customerId/history", "health.read", (args) => chartHistory(args.ctx, param(args, "customerId"), args.query.text("tooth"))),
  // The patient's chart (needs health.read; the read is audited) with the clinic's tooth numbering setting.
  admin("GET", "/chart/:customerId", "health.read", async (args) => {
    const [entries, toothNumbering] = await Promise.all([listChart(args.ctx, param(args, "customerId")), chartToothNumbering(args.tenantId)]);
    return { entries, toothNumbering };
  }),
  // Body: { tooth, surfaces?, kind, condition?, procedureId?, notes? }. Needs health.manage.
  admin(
    "POST",
    "/chart/:customerId",
    "health.manage",
    async (args) => (0, import_server13.created)(await addEntry.run(args.ctx, { ...await args.body(), customerId: param(args, "customerId") }))
  ),
  // Body: { expectedVersion, status?: "active" | "resolved" | "void", surfaces?, condition?, procedureId?, notes? }. Needs health.manage.
  admin("PATCH", "/chart/entries/:id", "health.manage", async (args) => updateEntry.run(args.ctx, { ...await args.body(), id: param(args, "id") })),
  // ---- Medical history ----
  // Body: { submissionId }. Merges one of the patient's intake form submissions into their history (health.manage).
  admin("POST", "/history/:customerId/import", "health.manage", async (args) => {
    const body = await args.body();
    return importFromSubmission(args.ctx, { submissionId: body.submissionId, customerId: param(args, "customerId") });
  }),
  // Medical history of a patient (health data). GET needs health.read and writes a health.read audit row.
  admin("GET", "/history/:customerId", "health.read", (args) => getHistory(args.ctx, param(args, "customerId"))),
  // Body: { expectedVersion, document, markReviewed? }. Needs health.manage. 0 = no record yet; a stale version -> 409.
  // The answer carries versions and flags only, never the document.
  admin("PUT", "/history/:customerId", "health.manage", async (args) => saveHistory(args.ctx, { ...await args.body(), customerId: param(args, "customerId") })),
  // The patient's completed intake form submissions (no answers), for "Import from intake form". Needs health.read.
  admin("GET", "/history/:customerId/submissions", "health.read", (args) => listIntakeSubmissions(args.ctx, param(args, "customerId"))),
  // ---- Insurance ----
  // Body: { expectedVersion, ...fields to change } (health.manage). memberId: null or "" clears it.
  admin("PATCH", "/insurance/:id", "health.manage", async (args) => updateInsurance(args.ctx, { ...await args.body(), id: param(args, "id") })),
  admin("DELETE", "/insurance/:id", "health.manage", (args) => deleteInsurance(args.ctx, { id: param(args, "id") })),
  // ?customerId=... : the patient's policies; member ids are decrypted (health.read, logged).
  admin("GET", "/insurance", "health.read", ({ ctx, query }) => listInsurance(ctx, query.required("customerId"))),
  // Body: { customerId, carrier, memberId?, groupNumber?, subscriberName?, subscriberRelationship?, isPrimary?, validTo? } (health.manage).
  admin("POST", "/insurance", "health.manage", async ({ ctx, body }) => (0, import_server13.created)(await createInsurance(ctx, await body()))),
  // ---- Treatment plans ----
  admin("POST", "/plans/:id/accept", "health.manage", async (args) => {
    await acceptPlan.run(args.ctx, { ...await args.body(), planId: param(args, "id") });
    return getPlan(args.tenantId, param(args, "id"));
  }),
  // Books all remaining visits as one series, all or nothing.
  admin("POST", "/plans/:id/book", "bookings.create", async (args) => {
    const result = await bookPlan.run(args.ctx, { ...await args.body(), planId: param(args, "id") });
    return (0, import_server13.created)({ ...result, plan: await getPlan(args.tenantId, param(args, "id")) });
  }),
  admin("POST", "/plans/:id/cancel", "health.manage", async (args) => {
    await cancelPlan.run(args.ctx, { ...await args.body(), planId: param(args, "id") });
    return getPlan(args.tenantId, param(args, "id"));
  }),
  // Proposes a time for every visit that is not booked yet (nothing is created).
  admin("POST", "/plans/:id/find-times", "bookings.create", async (args) => findPlanTimes(args.tenantId, { ...await args.body(), planId: param(args, "id") })),
  admin("POST", "/plans/:id/propose", "health.manage", async (args) => {
    await proposePlan.run(args.ctx, { ...await args.body(), planId: param(args, "id") });
    return getPlan(args.tenantId, param(args, "id"));
  }),
  admin("GET", "/plans/:id", "health.read", (args) => getPlan(args.tenantId, param(args, "id"))),
  admin("PATCH", "/plans/:id", "health.manage", async (args) => {
    await updatePlan.run(args.ctx, { ...await args.body(), planId: param(args, "id") });
    return getPlan(args.tenantId, param(args, "id"));
  }),
  // What the plan editor offers: active procedures (with their linked service) and the default currency.
  admin("GET", "/plans/options", "health.read", ({ tenantId }) => getPlanOptions(tenantId)),
  // A patient's treatment plans: ?customerId=.
  admin("GET", "/plans", "health.read", ({ tenantId, query }) => listPlans(tenantId, query.required("customerId"))),
  admin("POST", "/plans", "health.manage", async ({ ctx, tenantId, body }) => {
    const result = await createPlan.run(ctx, await body());
    return (0, import_server13.created)(await getPlan(tenantId, result.id));
  }),
  // ---- Procedure catalog ----
  // Body: { expectedVersion, name?, code?, category?, defaultPriceMinor?, currency?, serviceId?, active? }.
  admin("PATCH", "/procedures/:id", "services.manage", async (args) => updateProcedure.run(args.ctx, { ...await args.body(), id: param(args, "id") })),
  // Archives the procedure (it stays on old plans and chart entries).
  admin("DELETE", "/procedures/:id", "services.manage", (args) => archiveProcedure.run(args.ctx, { id: param(args, "id") })),
  // Body: { ids: string[] } in the new order.
  admin("POST", "/procedures/reorder", "services.manage", async ({ ctx, body }) => reorderProcedures.run(ctx, await body())),
  // Members with services.manage or health.read may list; archived ones (?includeArchived=true) only for services.manage.
  admin("GET", "/procedures", null, ({ ctx, query }) => {
    const includeArchived = query.bool("includeArchived");
    return listProcedures(ctx, includeArchived === void 0 ? {} : { includeArchived });
  }),
  admin("POST", "/procedures", "services.manage", async ({ ctx, body }) => (0, import_server13.created)(await createProcedure.run(ctx, await body()))),
  // ---- Recall ----
  // Sends the recall reminder now: { customerId, ruleId }.
  admin("POST", "/recall/remind", "bookings.create", async ({ ctx, body }) => remindRecall.run(ctx, await body())),
  // The recall list: ?status=due,reminded&dueFrom=&dueTo=&customerId=&limit=&offset=.
  admin("GET", "/recall", "bookings.read", ({ tenantId, query }) => {
    const status = query.list("status");
    const dueFrom = query.text("dueFrom");
    const dueTo = query.text("dueTo");
    const customerId = query.text("customerId");
    const limit = query.int("limit");
    const offset = query.int("offset");
    return listRecalls(tenantId, {
      ...status.length > 0 && { status },
      ...dueFrom !== void 0 && { dueFrom },
      ...dueTo !== void 0 && { dueTo },
      ...customerId !== void 0 && { customerId },
      ...limit !== void 0 && { limit },
      ...offset !== void 0 && { offset }
    });
  }),
  // Changes a rule: the full rule plus expectedVersion.
  admin("PATCH", "/recall/rules/:id", "services.manage", async (args) => saveRecallRule.run(args.ctx, { ...await args.body(), id: param(args, "id") })),
  admin("GET", "/recall/rules", "bookings.read", ({ tenantId }) => listRecallRules(tenantId)),
  admin("POST", "/recall/rules", "services.manage", async ({ ctx, body }) => (0, import_server13.created)(await saveRecallRule.run(ctx, { ...await body(), id: void 0 }))),
  // Pushes a recall back: { customerId, ruleId, days: 30 | 60 | 90 }.
  admin("POST", "/recall/snooze", "bookings.create", async ({ ctx, body }) => snoozeRecall.run(ctx, await body())),
  // ---- Reports ----
  // The recall tile of the reports dashboard: how many patients are due and how many were reminded.
  admin("GET", "/reports/recall", "reports.read", ({ tenantId }) => recallCounts(tenantId)),
  // ---- Setup ----
  // What the dental setup pack has and misses, per part (settings.manage).
  admin("GET", "/setup", "settings.manage", ({ ctx }) => getDentalSetupStatus(ctx)),
  // Adds what is missing; body { parts?: [...] } limits it to some parts. Existing items are never changed. The parts are
  // built with the owner's own permissions (services, resources, forms, pages, plugins), so all of them are needed.
  admin("POST", "/setup", "settings.manage", async ({ ctx, body }) => applyDentalSetup(ctx, await body()))
];
function registerRoutes(api) {
  for (const route of DENTAL_ROUTES) api.registerRoute(route);
}

// src/setup/demo.ts
var import_server14 = require("@appointit/plugin-sdk/server");
var DEMO_CLINIC_NAME = "Smile Dental Clinic";
var TEAM = [
  ["dentist", "Dr. Ava Patel"],
  ["dentist", "Dr. Ben Ortiz"],
  ["hygienist", "Hygienist Cara Lee"],
  ["hygienist", "Hygienist Dan Kim"],
  ["assistant", "Assistant Eva Brown"],
  ["assistant", "Assistant Finn Walker"],
  ["operatory", "Operatory 1"],
  ["operatory", "Operatory 2"],
  ["operatory", "Operatory 3"],
  ["imaging", "Panoramic X-ray"]
];
var BOOKINGS = [
  { day: 0, time: "09:00", service: "cleaning-and-check-up", name: "Maria Gomez", email: "maria.gomez@example.com", phone: "+12025550101" },
  { day: 0, time: "10:30", service: "new-patient-exam", name: "James Carter", email: "james.carter@example.com", phone: "+12025550102" },
  { day: 1, time: "09:00", service: "filling", name: "Priya Nair", email: "priya.nair@example.com", phone: "+12025550103" },
  { day: 2, time: "14:00", service: "whitening", name: "Liam Murphy", email: "liam.murphy@example.com", phone: "+12025550104" },
  { day: 3, time: "11:00", service: "cleaning-and-check-up", name: "Sofia Rossi", email: "sofia.rossi@example.com", phone: "+12025550105" }
];
async function applyDentalDemo(ctx, info) {
  const tenantId = ctx.tenantId;
  const locationId = info.locationId;
  const tenant = await (0, import_server14.getTenant)(tenantId);
  if (tenant.name !== DEMO_CLINIC_NAME) await import_server14.updateTenant.run(ctx, { expectedVersion: tenant.version, name: DEMO_CLINIC_NAME });
  const timeZone = (await (0, import_server14.listLocations)(tenantId)).find((location) => location.id === locationId)?.timeZone;
  if (timeZone === void 0) throw new Error("The demo location was not found");
  const types = new Map((await (0, import_server14.listResourceTypes)(tenantId)).map((type) => [type.key, type.id]));
  for (const [typeKey, name] of TEAM) {
    const typeId = types.get(typeKey);
    if (!typeId) throw new Error(`The dental setup did not create the resource type "${typeKey}"`);
    await import_server14.createResource.run(ctx, { locationId, typeId, name });
  }
  const morning = { start: "09:00", end: "13:00" };
  const afternoon = { start: "14:00", end: "17:00" };
  const today = (0, import_server14.epochMsToLocal)(Date.now(), timeZone).date;
  await import_server14.publishSchedule.run(ctx, {
    locationId,
    effectiveFrom: today,
    rules: [
      ...[1, 2, 3, 4, 5].map((day) => ({ day, ranges: [morning, afternoon] })),
      { day: 6, ranges: [morning] }
    ]
  });
  await applyDentalSetup(ctx);
  const serviceIds = new Map(
    (await (0, import_server14.withTenantTx)(tenantId, (tx) => tx.selectFrom("service").select(["id", "slug"]).where("tenant_id", "=", tenantId).execute())).map((row) => [row.slug, row.id])
  );
  let monday = (0, import_server14.addDaysLocal)(today, 1);
  while ((0, import_server14.dayOfWeek)(monday) !== 1) monday = (0, import_server14.addDaysLocal)(monday, 1);
  for (const booking of BOOKINGS) {
    const serviceId = serviceIds.get(booking.service);
    if (!serviceId) throw new Error(`Unknown service ${booking.service}`);
    const date = (0, import_server14.addDaysLocal)(monday, booking.day);
    await import_server14.createBooking.run(ctx, {
      locationId,
      items: [{ serviceId }],
      start: (0, import_server14.toIso)((0, import_server14.localToEpochMs)(date, booking.time, timeZone)),
      customer: { displayName: booking.name, email: booking.email, phone: booking.phone },
      source: "admin"
    });
  }
  const patient = async (displayName, email, phone) => (await import_server14.createCustomer.run(ctx, { displayName, email, phone })).id;
  const alertPatient = await patient("Noah Becker", "noah.becker@example.com", "+12025550106");
  await saveHistory(ctx, {
    customerId: alertPatient,
    expectedVersion: 0,
    document: { allergies: { penicillin: true }, medications: ["Vitamin D"] },
    markReviewed: true
  });
  const recallPatient = await patient("Aisha Khan", "aisha.khan@example.com", "+12025550107");
  await (0, import_server14.withTenantTx)(tenantId, async (tx) => {
    const rule = await dentalDb(tx).selectFrom("plg_dental_recall_rule").select("id").where("tenant_id", "=", tenantId).where("name", "=", "Cleaning every 6 months").executeTakeFirstOrThrow();
    await import_server14.sql`
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
      { procedureId: filling1, tooth: "37", surfaces: ["O"], minGapDays: 7 }
    ]
  });
}

// src/index.ts
var index_default = (0, import_plugin_sdk12.definePlugin)({
  id: "appointit.vertical-dental",
  name: "Dental clinic",
  version: "0.2.0",
  engines: { appointit: "^0.2.0" },
  permissions: [],
  register(api) {
    api.declareSettings([
      {
        key: "toothNumbering",
        label: "Tooth numbering",
        type: "text",
        options: [
          { value: "fdi", label: "FDI (11 to 48)" },
          { value: "universal", label: "Universal (1 to 32)" }
        ],
        default: "fdi",
        help: "How tooth numbers are shown in the dental chart."
      },
      {
        key: "historyReviewMonths",
        label: "Medical history review (months)",
        type: "number",
        default: 12,
        min: 1,
        max: 120,
        help: "A patient's medical history is due for review this many months after the last review."
      }
    ]);
    registerHistory(api);
    registerChart(api);
    registerPlans(api);
    registerPrivacy(api);
    registerRoutes(api);
    api.registerCron("0 6 * * *", RECALL_DAILY_TASK);
    api.registerCron("10 6 * * *", HISTORY_REVIEW_TASK);
    api.registerMessageTemplate(HISTORY_REVIEW_TEMPLATE, { scheduled: true });
    api.registerBusinessType({
      key: "dental",
      label: "dental.businessTypeLabel",
      help: "dental.businessTypeHelp",
      setup: async (ctx) => {
        await applyDentalSetup(ctx);
      },
      demo: applyDentalDemo
    });
  }
});
