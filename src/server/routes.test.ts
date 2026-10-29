import { describe, expect, it } from "vitest";
import type { BusinessTypeDef, PluginApi, PluginRoute } from "@appointit/plugin-sdk";
import plugin from "../index";

// Registers the plugin with a fake api that only records what it is given.
const routes: PluginRoute[] = [];
const cron: string[] = [];
const templates: { key: string; scheduled: boolean }[] = [];
const businessTypes: BusinessTypeDef[] = [];
const tasks: string[] = [];
plugin.register({
  declareSettings: () => {},
  registerSubscriber: () => {},
  registerTask: (name: string) => void tasks.push(name),
  registerRoute: (route: PluginRoute) => void routes.push(route),
  registerCron: (schedule: string, task: string) => void cron.push(`${schedule} ${task}`),
  registerMessageTemplate: (def: { key: string }, opts?: { scheduled?: boolean }) => void templates.push({ key: def.key, scheduled: opts?.scheduled === true }),
  registerBusinessType: (def: BusinessTypeDef) => void businessTypes.push(def),
  logger: console,
} as unknown as PluginApi);

const label = (route: Pick<PluginRoute, "method" | "path">) => `${route.method} ${route.path}`;
/** /a/:x and /a/:y are the same route (the host compares the shape). */
const shape = (route: PluginRoute) => `${route.method} ${route.path.replace(/:[A-Za-z]+/g, ":")}`;

// The routes the web app served under /api/v1/dental before the plugin moved to /api/v1/ext/dental (one per route file export).
const OLD_ROUTES = [
  "GET /alerts",
  "GET /alerts/consent",
  "GET /alerts/consent/forms",
  "PUT /alerts/consent/forms",
  "GET /chart/:customerId",
  "POST /chart/:customerId",
  "GET /chart/:customerId/history",
  "PATCH /chart/entries/:id",
  "GET /history/:customerId",
  "PUT /history/:customerId",
  "POST /history/:customerId/import",
  "GET /history/:customerId/submissions",
  "GET /insurance",
  "POST /insurance",
  "PATCH /insurance/:id",
  "DELETE /insurance/:id",
  "GET /plans",
  "POST /plans",
  "GET /plans/options",
  "GET /plans/:id",
  "PATCH /plans/:id",
  "POST /plans/:id/accept",
  "POST /plans/:id/book",
  "POST /plans/:id/cancel",
  "POST /plans/:id/find-times",
  "POST /plans/:id/propose",
  "GET /procedures",
  "POST /procedures",
  "PATCH /procedures/:id",
  "DELETE /procedures/:id",
  "POST /procedures/reorder",
  "GET /recall",
  "POST /recall/remind",
  "POST /recall/snooze",
  "GET /recall/rules",
  "POST /recall/rules",
  "PATCH /recall/rules/:id",
  "GET /setup",
  "POST /setup",
];

describe("the dental plugin's API routes", () => {
  it("every route is an admin route with an explicit permission; only the procedure list is open to any member", () => {
    for (const route of routes) {
      expect(route.auth, label(route)).toBe("admin");
      expect(route.permission, label(route)).not.toBeUndefined();
      expect(typeof route.handler, label(route)).toBe("function");
    }
    expect(routes.filter((route) => route.permission === null).map(label)).toEqual(["GET /procedures"]);
  });

  it("paths use literal segments of [a-z0-9-] and :params, and none is registered twice", () => {
    for (const route of routes) expect(route.path, label(route)).toMatch(/^\/([a-z0-9-]+|:[A-Za-z]+)(\/([a-z0-9-]+|:[A-Za-z]+))*$/);
    const shapes = routes.map(shape);
    expect(shapes.filter((value, index) => shapes.indexOf(value) !== index)).toEqual([]);
  });

  it("serves every path of the old /api/v1/dental route folders", () => {
    const have = new Set(routes.map(label));
    expect(OLD_ROUTES.filter((old) => !have.has(old))).toEqual([]);
  });

  it("adds the recall tile route for the reports dashboard", () => {
    expect(routes.find((route) => label(route) === "GET /reports/recall")?.permission).toBe("reports.read");
  });
});

describe("the dental plugin's other registrations", () => {
  it("schedules the two daily tasks it registers", () => {
    expect(cron).toEqual(["0 6 * * * dental_recall_daily", "10 6 * * * dental_history_review"]);
    expect(tasks).toEqual(expect.arrayContaining(["dental_recall_daily", "dental_history_review"]));
  });

  it("registers the history review message as a scheduled template", () => {
    expect(templates).toEqual([{ key: "dental.history_review", scheduled: true }]);
  });

  it("registers the dental business type with setup and demo", () => {
    expect(businessTypes).toHaveLength(1);
    expect(businessTypes[0]).toMatchObject({ key: "dental", label: "dental.businessTypeLabel", help: "dental.businessTypeHelp" });
    expect(typeof businessTypes[0]?.setup).toBe("function");
    expect(typeof businessTypes[0]?.demo).toBe("function");
  });
});
