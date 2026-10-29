// Dental setup pack: builds a clinic's first catalog, forms and pages from the data files in ./data.
// "dental.applySetup" is idempotent. Every item has a stable key (resource type key, service slug or name, procedure
// code or name, rule name, form slug, page slug, vocabulary key); an item that exists is skipped and never changed,
// so what the owner edited stays. It composes the existing commands in one transaction, so a failure adds nothing.
import { z } from "@appointit/plugin-sdk";
import {
  createForm,
  createPage,
  createResourceType,
  createService,
  defineCommand,
  publishForm,
  publishPage,
  publishServiceVersion,
  requirePermission,
  setHomePage,
  setVocabulary,
  sql,
  updateSite,
  withTenantTx,
} from "@appointit/plugin-sdk/server";
import type { CommandContext, Tx } from "@appointit/plugin-sdk/server";
import { dentalDb } from "../server/db-types";
import { createProcedure } from "../server/chart/procedures";
import { DENTAL_PLUGIN_ID, setConsentFormsCommand } from "../server/history/consent";
import { saveRecallRule } from "../server/plans/recall";
import { BOOKING_FORM_SLUG, FORMS_PACK } from "./data/forms";
import { PAGES_PACK } from "./data/pages";
import { PROCEDURES_PACK } from "./data/procedures";
import { RECALL_PACK } from "./data/recall";
import { RESOURCE_TYPES_PACK } from "./data/resource-types";
import { SERVICES_PACK } from "./data/services";
import { VOCABULARY_PACK } from "./data/vocabulary";
import { SETUP_PARTS, type PackService, type SetupPart, type SetupResult, type SetupStatus } from "./types";

const lower = (s: string): string => s.trim().toLowerCase();
const zeros = (): Record<SetupPart, number> => ({ vocabulary: 0, resourceTypes: 0, services: 0, procedures: 0, recall: 0, forms: 0, pages: 0 });

type ServiceRow = { id: string; name: string; slug: string; current_version: number | null; status: string };

/** The existing service a pack service stands for: same slug, else same name. */
function findService(rows: readonly ServiceRow[], pack: PackService): ServiceRow | undefined {
  return rows.find((r) => r.slug === pack.slug) ?? rows.find((r) => lower(r.name) === lower(pack.name));
}

/** The service a pack item points at (by the pack service's slug). */
function serviceOf(rows: readonly ServiceRow[], slug: string): { pack: PackService | undefined; row: ServiceRow | undefined } {
  const pack = SERVICES_PACK.find((s) => s.slug === slug);
  return { pack, row: pack ? findService(rows, pack) : undefined };
}

async function loadServices(tx: Tx, tenantId: string): Promise<ServiceRow[]> {
  return tx.selectFrom("service").select(["id", "name", "slug", "current_version", "status"]).where("tenant_id", "=", tenantId).execute();
}

async function vocabularyOf(tx: Tx, tenantId: string): Promise<{ version: number; words: Record<string, string> }> {
  const row = await tx.selectFrom("tenant").select(["settings", "version"]).where("id", "=", tenantId).executeTakeFirst();
  const raw = (row?.settings as { vocabulary?: unknown } | null | undefined)?.vocabulary;
  const words: Record<string, string> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [key, label] of Object.entries(raw)) if (typeof label === "string" && label.trim() !== "") words[key] = label.trim();
  }
  return { version: row?.version ?? 1, words };
}

async function locationsOf(tx: Tx, tenantId: string): Promise<{ id: string; currency: string | null }[]> {
  return tx.selectFrom("location").select(["id", "currency"]).where("tenant_id", "=", tenantId).orderBy("created_at").execute();
}

/** Resource type keys the service needs that have no active resource (at that location) yet. */
async function missingTeam(tx: Tx, tenantId: string, locationId: string | null, pack: PackService): Promise<string[]> {
  const missing: string[] = [];
  for (const need of pack.needs) {
    const found = await tx
      .selectFrom("resource")
      .innerJoin("resource_type", (join) => join.onRef("resource_type.tenant_id", "=", "resource.tenant_id").onRef("resource_type.id", "=", "resource.type_id"))
      .select(sql<number>`count(*)::int`.as("n"))
      .where("resource.tenant_id", "=", tenantId)
      .where("resource.status", "=", "active")
      .where("resource_type.key", "=", need.typeKey)
      .$if(locationId !== null, (qb) => qb.where("resource.location_id", "=", locationId as string))
      .executeTakeFirstOrThrow();
    if (found.n < 1 && !missing.includes(need.typeKey)) missing.push(need.typeKey);
  }
  return missing;
}

const typeName = (key: string): string => RESOURCE_TYPES_PACK.find((t) => t.key === key)?.name ?? key;

async function consentMap(tx: Tx, tenantId: string): Promise<Record<string, string>> {
  const row = await tx.selectFrom("plugin_setting").select("settings").where("tenant_id", "=", tenantId).where("plugin_id", "=", DENTAL_PLUGIN_ID).executeTakeFirst();
  const raw = (row?.settings as { consentForms?: unknown } | null | undefined)?.consentForms;
  const out: Record<string, string> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [serviceId, slug] of Object.entries(raw)) if (typeof slug === "string" && slug !== "") out[serviceId] = slug;
  }
  return out;
}

export const applySetupCommand = defineCommand({
  name: "dental.applySetup",
  input: z.object({ parts: z.array(z.enum(SETUP_PARTS)).min(1).max(SETUP_PARTS.length).optional() }),
  authorize: requirePermission("settings.manage"),
  handler: async (tx, input, scope): Promise<SetupResult> => {
    const ctx = scope.ctx;
    const tenantId = ctx.tenantId;
    const wanted = new Set<SetupPart>(input.parts ?? SETUP_PARTS);
    const result: SetupResult = { created: zeros(), skipped: zeros(), warnings: [] };
    const locations = await locationsOf(tx, tenantId);
    const currency = locations[0]?.currency ?? null;
    // Services belong to the location when the business has just one; with several they are offered everywhere.
    const serviceLocationId = locations.length === 1 ? (locations[0]?.id ?? null) : null;
    const newServiceSlugs = new Set<string>();
    const newFormSlugs = new Set<string>();

    // ---- vocabulary ----
    if (wanted.has("vocabulary")) {
      const { version, words } = await vocabularyOf(tx, tenantId);
      const added: Record<string, string> = {};
      for (const [key, label] of Object.entries(VOCABULARY_PACK)) {
        if (words[key] !== undefined) result.skipped.vocabulary += 1;
        else {
          added[key] = label;
          result.created.vocabulary += 1;
        }
      }
      if (Object.keys(added).length > 0) await setVocabulary.runInTx(tx, ctx, { expectedVersion: version, vocabulary: { ...words, ...added } });
    }

    // ---- resource types ----
    if (wanted.has("resourceTypes")) {
      const have = new Set((await tx.selectFrom("resource_type").select("key").where("tenant_id", "=", tenantId).execute()).map((r) => r.key));
      for (const type of RESOURCE_TYPES_PACK) {
        if (have.has(type.key)) result.skipped.resourceTypes += 1;
        else {
          await createResourceType.runInTx(tx, ctx, type);
          result.created.resourceTypes += 1;
        }
      }
    }

    // ---- services ----
    if (wanted.has("services")) {
      if (locations.length === 0) result.warnings.push("Add a location first: services belong to a location.");
      else {
        const rows = await loadServices(tx, tenantId);
        for (const pack of SERVICES_PACK) {
          let serviceId: string;
          const existing = findService(rows, pack);
          if (existing) {
            // Already there: only a service that was never published gets its first version; nothing else is touched.
            if (existing.current_version !== null || existing.status === "archived") {
              result.skipped.services += 1;
              continue;
            }
            serviceId = existing.id;
          } else {
            const created = await createService.runInTx(tx, ctx, {
              name: pack.name,
              slug: pack.slug,
              category: pack.category,
              description: pack.description,
              ...(serviceLocationId !== null && { locationId: serviceLocationId }),
            });
            serviceId = created.id;
            newServiceSlugs.add(pack.slug);
          }
          const missing = await missingTeam(tx, tenantId, serviceLocationId, pack);
          if (missing.length > 0) {
            result.warnings.push(`${pack.name} was added as a draft. Add ${missing.map(typeName).join(" and ")} under Resources, then add the missing items again to publish it.`);
            if (existing === undefined) result.created.services += 1;
            continue;
          }
          await publishServiceVersion.runInTx(tx, ctx, {
            serviceId,
            durationMin: pack.durationMin,
            startStepMin: pack.startStepMin,
            priceMinor: pack.priceMinor,
            ...(currency !== null && { currency }),
            priceType: pack.priceType,
            needs: pack.needs.map((n) => ({
              key: n.key,
              selector: { typeKey: n.typeKey },
              ...(n.offsetMin !== undefined && { offsetMin: n.offsetMin }),
              ...(n.lengthMin !== undefined && { lengthMin: n.lengthMin }),
              ...(n.bufferAfterMin !== undefined && { bufferAfterMin: n.bufferAfterMin }),
              ...(n.pick !== undefined && { pick: n.pick }),
            })),
            ...(pack.policy && { policy: pack.policy }),
          });
          result.created.services += 1;
        }
      }
    }

    // ---- procedures ----
    if (wanted.has("procedures")) {
      const rows = await dentalDb(tx).selectFrom("plg_dental_procedure").select(["code", "name"]).where("tenant_id", "=", tenantId).execute();
      const codes = new Set(rows.flatMap((r) => (r.code === null ? [] : [lower(r.code)])));
      const names = new Set(rows.map((r) => lower(r.name)));
      const services = await loadServices(tx, tenantId);
      for (const pack of PROCEDURES_PACK) {
        if ((pack.code !== null && codes.has(lower(pack.code))) || names.has(lower(pack.name))) {
          result.skipped.procedures += 1;
          continue;
        }
        const { row } = serviceOf(services, pack.service);
        await createProcedure.runInTx(tx, ctx, {
          code: pack.code,
          name: pack.name,
          category: pack.category,
          ...(currency !== null && { defaultPriceMinor: pack.priceMinor, currency }),
          ...(row && { serviceId: row.id }),
        });
        result.created.procedures += 1;
      }
    }

    // ---- recall ----
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

    // ---- forms ----
    if (wanted.has("forms")) {
      const have = new Set((await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).execute()).map((r) => r.slug));
      for (const pack of FORMS_PACK) {
        if (have.has(pack.slug)) {
          result.skipped.forms += 1;
          continue;
        }
        const form = await createForm.runInTx(tx, ctx, { name: pack.name, purpose: pack.purpose, slug: pack.slug, draft: pack.content });
        await publishForm.runInTx(tx, ctx, { id: form.id, expectedVersion: form.version });
        newFormSlugs.add(pack.slug);
        result.created.forms += 1;
      }
    }

    // ---- the site's booking form ----
    // The booking form of the pack becomes the site's booking form (the /book page and the booking buttons), but only
    // when this run made it and the site has none: a form the owner already chose, or cleared, is not changed later.
    if (wanted.has("forms") && newFormSlugs.has(BOOKING_FORM_SLUG)) {
      const site = await tx.selectFrom("site").select(["settings", "version"]).where("tenant_id", "=", tenantId).executeTakeFirst();
      const chosen = (site?.settings as { bookingFormSlug?: unknown } | undefined)?.bookingFormSlug;
      if (typeof chosen !== "string" || chosen === "") {
        await updateSite.runInTx(tx, ctx, { expectedVersion: site?.version ?? 0, bookingFormSlug: BOOKING_FORM_SLUG });
      }
    }

    // ---- the form each service asks for (consent per service) ----
    // Only for a service or a form made by this run, so a link the owner removed is not put back later.
    if (wanted.has("services") || wanted.has("forms")) {
      const services = await loadServices(tx, tenantId);
      const forms = new Set((await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).execute()).map((r) => r.slug));
      const map = await consentMap(tx, tenantId);
      const added: Record<string, string> = {};
      for (const pack of SERVICES_PACK) {
        const row = findService(services, pack);
        if (!pack.form || !row || !forms.has(pack.form) || map[row.id] !== undefined) continue;
        if (newServiceSlugs.has(pack.slug) || newFormSlugs.has(pack.form)) added[row.id] = pack.form;
      }
      if (Object.keys(added).length > 0) await setConsentFormsCommand.runInTx(tx, ctx, { consentForms: { ...map, ...added } });
    }

    // ---- pages ----
    if (wanted.has("pages")) {
      const rows = await tx.selectFrom("page").select(["id", "slug", "status"]).where("tenant_id", "=", tenantId).execute();
      const site = await tx.selectFrom("site").select("settings").where("tenant_id", "=", tenantId).executeTakeFirst();
      const hasHome = typeof (site?.settings as { homePageId?: unknown } | undefined)?.homePageId === "string";
      for (const pack of PAGES_PACK) {
        const existing = rows.find((r) => r.slug === pack.slug);
        let pageId: string;
        let published: boolean;
        if (existing) {
          result.skipped.pages += 1;
          pageId = existing.id;
          published = existing.status === "published";
        } else {
          const page = await createPage.runInTx(tx, ctx, { title: pack.title, slug: pack.slug, draft: { nodes: pack.nodes }, seo: pack.seo });
          await publishPage.runInTx(tx, ctx, { id: page.id, expectedVersion: page.version });
          pageId = page.id;
          published = true;
          result.created.pages += 1;
        }
        // The home page of the pack becomes the site's home page, but only for a site that has none.
        if (pack.home && !hasHome && published) await setHomePage.runInTx(tx, ctx, { id: pageId });
      }
    }

    await scope.audit({
      action: "dental.applySetup",
      targetType: "plugin_setting",
      targetId: DENTAL_PLUGIN_ID,
      changes: { parts: [...wanted], created: result.created, skipped: result.skipped },
    });
    return result;
  },
});

/** Adds what the dental pack still misses (settings.manage). Safe to run again: nothing existing is changed. */
export function applyDentalSetup(ctx: CommandContext, input: { parts?: SetupPart[] } = {}): Promise<SetupResult> {
  return applySetupCommand.run(ctx, input);
}

/** What the pack has and what is missing, per part (settings.manage). Read only. */
export async function getDentalSetupStatus(ctx: CommandContext): Promise<SetupStatus> {
  requirePermission("settings.manage")(ctx);
  const tenantId = ctx.tenantId;
  return withTenantTx(tenantId, async (tx): Promise<SetupStatus> => {
    const { words } = await vocabularyOf(tx, tenantId);
    const typeKeys = new Set((await tx.selectFrom("resource_type").select("key").where("tenant_id", "=", tenantId).execute()).map((r) => r.key));
    const services = await loadServices(tx, tenantId);
    const procedures = await dentalDb(tx).selectFrom("plg_dental_procedure").select(["code", "name"]).where("tenant_id", "=", tenantId).execute();
    const rules = new Set((await dentalDb(tx).selectFrom("plg_dental_recall_rule").select("name").where("tenant_id", "=", tenantId).execute()).map((r) => lower(r.name)));
    const forms = new Set((await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).execute()).map((r) => r.slug));
    const pages = new Set((await tx.selectFrom("page").select("slug").where("tenant_id", "=", tenantId).execute()).map((r) => r.slug));
    const codes = new Set(procedures.flatMap((r) => (r.code === null ? [] : [lower(r.code)])));
    const names = new Set(procedures.map((r) => lower(r.name)));
    const count = <T>(items: readonly T[], has: (item: T) => boolean) => ({ total: items.length, present: items.filter(has).length });
    const parts: Record<SetupPart, { total: number; present: number }> = {
      vocabulary: count(Object.keys(VOCABULARY_PACK), (key) => words[key] !== undefined),
      resourceTypes: count(RESOURCE_TYPES_PACK, (t) => typeKeys.has(t.key)),
      // A service counts once it has a published version (an unpublished one is finished by the next run).
      services: count(SERVICES_PACK, (s) => {
        const row = findService(services, s);
        return row !== undefined && (row.current_version !== null || row.status === "archived");
      }),
      procedures: count(PROCEDURES_PACK, (p) => (p.code !== null && codes.has(lower(p.code))) || names.has(lower(p.name))),
      recall: count(RECALL_PACK, (r) => rules.has(lower(r.name))),
      forms: count(FORMS_PACK, (f) => forms.has(f.slug)),
      pages: count(PAGES_PACK, (p) => pages.has(p.slug)),
    };
    return { parts: SETUP_PARTS.map((part) => ({ part, ...parts[part] })) };
  });
}
