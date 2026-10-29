// The dental API: every route under /api/v1/ext/dental/<path> (these used to be /api/v1/dental/<path> in the web app).
// Each one calls a server function of this plugin and gives its permission explicitly; the host checks it and answers
// 404 while the business has the plugin switched off.
import type { PluginApi, PluginRoute, PluginRouteArgs } from "@appointit/plugin-sdk";
import { AppError, created } from "@appointit/plugin-sdk/server";
import { applyDentalSetup, getDentalSetupStatus } from "../setup";
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
} from "./chart";
import {
  createInsurance,
  deleteInsurance,
  getConsentForms,
  getConsentStatus,
  getHistory,
  importFromSubmission,
  listAlerts,
  listInsurance,
  listIntakeSubmissions,
  saveHistory,
  setConsentForms,
  updateInsurance,
} from "./history";
import {
  acceptPlan,
  bookPlan,
  cancelPlan,
  createPlan,
  findPlanTimes,
  getPlan,
  getPlanOptions,
  listPlans,
  listRecallRules,
  listRecalls,
  proposePlan,
  recallCounts,
  remindRecall,
  saveRecallRule,
  snoozeRecall,
  updatePlan,
} from "./plans";

type Method = PluginRoute["method"];
type Handler = PluginRoute["handler"];

const admin = (method: Method, path: string, permission: string | null, handler: Handler): PluginRoute => ({ method, path, auth: "admin", permission, handler });

/** A path param (the host only calls a handler when every :param of its path is there). */
function param({ params }: PluginRouteArgs, name: string): string {
  const value = params[name];
  if (value === undefined) throw new AppError("NOT_FOUND", "Not found");
  return value;
}

export const DENTAL_ROUTES: readonly PluginRoute[] = [
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
  admin("POST", "/chart/:customerId", "health.manage", async (args) =>
    created(await addEntry.run(args.ctx, { ...(await args.body()), customerId: param(args, "customerId") })),
  ),
  // Body: { expectedVersion, status?: "active" | "resolved" | "void", surfaces?, condition?, procedureId?, notes? }. Needs health.manage.
  admin("PATCH", "/chart/entries/:id", "health.manage", async (args) => updateEntry.run(args.ctx, { ...(await args.body()), id: param(args, "id") })),

  // ---- Medical history ----
  // Body: { submissionId }. Merges one of the patient's intake form submissions into their history (health.manage).
  admin("POST", "/history/:customerId/import", "health.manage", async (args) => {
    const body = await args.body();
    return importFromSubmission(args.ctx, { submissionId: body.submissionId as string, customerId: param(args, "customerId") });
  }),
  // Medical history of a patient (health data). GET needs health.read and writes a health.read audit row.
  admin("GET", "/history/:customerId", "health.read", (args) => getHistory(args.ctx, param(args, "customerId"))),
  // Body: { expectedVersion, document, markReviewed? }. Needs health.manage. 0 = no record yet; a stale version -> 409.
  // The answer carries versions and flags only, never the document.
  admin("PUT", "/history/:customerId", "health.manage", async (args) => saveHistory(args.ctx, { ...(await args.body()), customerId: param(args, "customerId") })),
  // The patient's completed intake form submissions (no answers), for "Import from intake form". Needs health.read.
  admin("GET", "/history/:customerId/submissions", "health.read", (args) => listIntakeSubmissions(args.ctx, param(args, "customerId"))),

  // ---- Insurance ----
  // Body: { expectedVersion, ...fields to change } (health.manage). memberId: null or "" clears it.
  admin("PATCH", "/insurance/:id", "health.manage", async (args) => updateInsurance(args.ctx, { ...(await args.body()), id: param(args, "id") })),
  admin("DELETE", "/insurance/:id", "health.manage", (args) => deleteInsurance(args.ctx, { id: param(args, "id") })),
  // ?customerId=... : the patient's policies; member ids are decrypted (health.read, logged).
  admin("GET", "/insurance", "health.read", ({ ctx, query }) => listInsurance(ctx, query.required("customerId"))),
  // Body: { customerId, carrier, memberId?, groupNumber?, subscriberName?, subscriberRelationship?, isPrimary?, validTo? } (health.manage).
  admin("POST", "/insurance", "health.manage", async ({ ctx, body }) => created(await createInsurance(ctx, await body()))),

  // ---- Treatment plans ----
  admin("POST", "/plans/:id/accept", "health.manage", async (args) => {
    await acceptPlan.run(args.ctx, { ...(await args.body()), planId: param(args, "id") });
    return getPlan(args.tenantId, param(args, "id"));
  }),
  // Books all remaining visits as one series, all or nothing.
  admin("POST", "/plans/:id/book", "bookings.create", async (args) => {
    const result = await bookPlan.run(args.ctx, { ...(await args.body()), planId: param(args, "id") });
    return created({ ...result, plan: await getPlan(args.tenantId, param(args, "id")) });
  }),
  admin("POST", "/plans/:id/cancel", "health.manage", async (args) => {
    await cancelPlan.run(args.ctx, { ...(await args.body()), planId: param(args, "id") });
    return getPlan(args.tenantId, param(args, "id"));
  }),
  // Proposes a time for every visit that is not booked yet (nothing is created).
  admin("POST", "/plans/:id/find-times", "bookings.create", async (args) => findPlanTimes(args.tenantId, { ...(await args.body()), planId: param(args, "id") })),
  admin("POST", "/plans/:id/propose", "health.manage", async (args) => {
    await proposePlan.run(args.ctx, { ...(await args.body()), planId: param(args, "id") });
    return getPlan(args.tenantId, param(args, "id"));
  }),
  admin("GET", "/plans/:id", "health.read", (args) => getPlan(args.tenantId, param(args, "id"))),
  admin("PATCH", "/plans/:id", "health.manage", async (args) => {
    await updatePlan.run(args.ctx, { ...(await args.body()), planId: param(args, "id") });
    return getPlan(args.tenantId, param(args, "id"));
  }),
  // What the plan editor offers: active procedures (with their linked service) and the default currency.
  admin("GET", "/plans/options", "health.read", ({ tenantId }) => getPlanOptions(tenantId)),
  // A patient's treatment plans: ?customerId=.
  admin("GET", "/plans", "health.read", ({ tenantId, query }) => listPlans(tenantId, query.required("customerId"))),
  admin("POST", "/plans", "health.manage", async ({ ctx, tenantId, body }) => {
    const result = await createPlan.run(ctx, await body());
    return created(await getPlan(tenantId, result.id));
  }),

  // ---- Procedure catalog ----
  // Body: { expectedVersion, name?, code?, category?, defaultPriceMinor?, currency?, serviceId?, active? }.
  admin("PATCH", "/procedures/:id", "services.manage", async (args) => updateProcedure.run(args.ctx, { ...(await args.body()), id: param(args, "id") })),
  // Archives the procedure (it stays on old plans and chart entries).
  admin("DELETE", "/procedures/:id", "services.manage", (args) => archiveProcedure.run(args.ctx, { id: param(args, "id") })),
  // Body: { ids: string[] } in the new order.
  admin("POST", "/procedures/reorder", "services.manage", async ({ ctx, body }) => reorderProcedures.run(ctx, await body())),
  // Members with services.manage or health.read may list; archived ones (?includeArchived=true) only for services.manage.
  admin("GET", "/procedures", null, ({ ctx, query }) => {
    const includeArchived = query.bool("includeArchived");
    return listProcedures(ctx, includeArchived === undefined ? {} : { includeArchived });
  }),
  admin("POST", "/procedures", "services.manage", async ({ ctx, body }) => created(await createProcedure.run(ctx, await body()))),

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
      ...(status.length > 0 && { status }),
      ...(dueFrom !== undefined && { dueFrom }),
      ...(dueTo !== undefined && { dueTo }),
      ...(customerId !== undefined && { customerId }),
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset }),
    });
  }),
  // Changes a rule: the full rule plus expectedVersion.
  admin("PATCH", "/recall/rules/:id", "services.manage", async (args) => saveRecallRule.run(args.ctx, { ...(await args.body()), id: param(args, "id") })),
  admin("GET", "/recall/rules", "bookings.read", ({ tenantId }) => listRecallRules(tenantId)),
  admin("POST", "/recall/rules", "services.manage", async ({ ctx, body }) => created(await saveRecallRule.run(ctx, { ...(await body()), id: undefined }))),
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
  admin("POST", "/setup", "settings.manage", async ({ ctx, body }) => applyDentalSetup(ctx, await body())),
];

export function registerRoutes(api: PluginApi): void {
  for (const route of DENTAL_ROUTES) api.registerRoute(route);
}
