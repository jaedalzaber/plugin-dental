// Consent per procedure. The clinic maps a service to a consent form (settings.consentForms of the
// appointit.vertical-dental plugin_setting row: { [serviceId]: formSlug }). A booking "needs consent" while one of
// its services is mapped and the patient has no complete submission of that form made since the booking was created.
import { AppError, defineCommand, requirePermission, sql, withTenantTx } from "@appointit/plugin-sdk/server";
import type { CommandContext } from "@appointit/plugin-sdk/server";
import { z } from "@appointit/plugin-sdk";

export const DENTAL_PLUGIN_ID = "appointit.vertical-dental";

/** Booking statuses where asking for consent still makes sense. */
const ACTIVE_STATUSES = new Set(["requested", "confirmed", "checked_in", "in_progress"]);

function readMap(settings: unknown): Record<string, string> {
  const raw = typeof settings === "object" && settings !== null ? (settings as Record<string, unknown>).consentForms : undefined;
  const out: Record<string, string> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [serviceId, slug] of Object.entries(raw)) if (typeof slug === "string" && slug !== "") out[serviceId] = slug;
  }
  return out;
}

/** service id -> consent form slug. Needs bookings.read or plugins.manage (the picker) -- the route checks it. */
export async function getConsentForms(tenantId: string): Promise<Record<string, string>> {
  const row = await withTenantTx(tenantId, (tx) =>
    tx.selectFrom("plugin_setting").select("settings").where("tenant_id", "=", tenantId).where("plugin_id", "=", DENTAL_PLUGIN_ID).executeTakeFirst(),
  );
  return readMap(row?.settings);
}

export const setConsentFormsCommand = defineCommand({
  name: "dental.consent.setForms",
  input: z.object({
    /** Replaces the whole mapping; a service left out has no consent form. */
    consentForms: z.record(z.uuid(), z.string().trim().min(1).max(200)),
  }),
  authorize: requirePermission("plugins.manage"),
  handler: async (tx, input, scope): Promise<{ count: number }> => {
    const tenantId = scope.ctx.tenantId;
    const slugs = [...new Set(Object.values(input.consentForms))];
    if (slugs.length > 0) {
      const found = await tx.selectFrom("form").select("slug").where("tenant_id", "=", tenantId).where("slug", "in", slugs).execute();
      const have = new Set(found.map((f) => f.slug));
      const missing = slugs.filter((s) => !have.has(s));
      if (missing.length > 0) throw new AppError("INVALID_INPUT", "Unknown consent form", { issues: [{ path: "consentForms", message: `Unknown form: ${missing[0]}`, code: "custom" }] });
    }
    const patch = JSON.stringify({ consentForms: input.consentForms });
    const row = await tx
      .selectFrom("plugin_setting")
      .select("version")
      .where("tenant_id", "=", tenantId)
      .where("plugin_id", "=", DENTAL_PLUGIN_ID)
      .forUpdate()
      .executeTakeFirst();
    if (row) {
      await tx
        .updateTable("plugin_setting")
        .set({ settings: sql`settings || ${patch}::jsonb`, version: row.version + 1 })
        .where("tenant_id", "=", tenantId)
        .where("plugin_id", "=", DENTAL_PLUGIN_ID)
        .execute();
    } else {
      await tx.insertInto("plugin_setting").values({ tenant_id: tenantId, plugin_id: DENTAL_PLUGIN_ID, settings: patch }).execute();
    }
    await scope.audit({
      action: "dental.consent.setForms",
      targetType: "plugin_setting",
      targetId: DENTAL_PLUGIN_ID,
      changes: { services: Object.keys(input.consentForms).length },
    });
    return { count: Object.keys(input.consentForms).length };
  },
});

/** Saves the service -> consent form mapping (plugins.manage). Other settings of the plugin are kept. */
export function setConsentForms(ctx: CommandContext, consentForms: unknown): Promise<{ count: number }> {
  return setConsentFormsCommand.run(ctx, { consentForms });
}

export interface ConsentFormStatus {
  slug: string;
  name: string;
  serviceId: string;
  signed: boolean;
  /** Where to send or open the form: /f/<slug>?customer=<id>. */
  link: string;
}

export interface ConsentStatus {
  bookingId: string;
  customerId: string | null;
  /** True while at least one mapped consent form has no complete submission since the booking was made. */
  needed: boolean;
  forms: ConsentFormStatus[];
}

/** Consent state of one booking. Needs bookings.read. */
export async function getConsentStatus(ctx: CommandContext, bookingId: string): Promise<ConsentStatus> {
  requirePermission("bookings.read")(ctx);
  if (!z.uuid().safeParse(bookingId).success) throw new AppError("INVALID_INPUT", "Invalid booking id");
  const tenantId = ctx.tenantId;
  return withTenantTx(tenantId, async (tx) => {
    const booking = await tx
      .selectFrom("booking")
      .select(["customer_id", "status", "created_at"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", bookingId)
      .executeTakeFirst();
    if (!booking) throw new AppError("NOT_FOUND", "Booking not found");
    const none: ConsentStatus = { bookingId, customerId: booking.customer_id, needed: false, forms: [] };
    if (!ACTIVE_STATUSES.has(booking.status)) return none;

    const items = await tx.selectFrom("booking_item").select("service_id").where("tenant_id", "=", tenantId).where("booking_id", "=", bookingId).execute();
    const setting = await tx
      .selectFrom("plugin_setting")
      .select("settings")
      .where("tenant_id", "=", tenantId)
      .where("plugin_id", "=", DENTAL_PLUGIN_ID)
      .executeTakeFirst();
    const map = readMap(setting?.settings);
    const wanted = new Map<string, string>(); // slug -> first service that asks for it
    for (const item of items) {
      const slug = map[item.service_id];
      if (slug !== undefined && !wanted.has(slug)) wanted.set(slug, item.service_id);
    }
    if (wanted.size === 0) return none;

    const forms = await tx
      .selectFrom("form")
      .select(["id", "slug", "name"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "published")
      .where("slug", "in", [...wanted.keys()])
      .execute();
    if (forms.length === 0) return none;

    const signedIds = new Set<string>();
    if (booking.customer_id !== null) {
      const subs = await tx
        .selectFrom("form_submission")
        .select("form_id")
        .distinct()
        .where("tenant_id", "=", tenantId)
        .where("customer_id", "=", booking.customer_id)
        .where("status", "=", "complete")
        .where("created_at", ">=", booking.created_at)
        .where("form_id", "in", forms.map((f) => f.id))
        .execute();
      for (const s of subs) signedIds.add(s.form_id);
    }
    const query = booking.customer_id !== null ? `?customer=${encodeURIComponent(booking.customer_id)}` : "";
    const rows: ConsentFormStatus[] = forms.map((f) => ({
      slug: f.slug,
      name: f.name,
      serviceId: wanted.get(f.slug) as string,
      signed: signedIds.has(f.id),
      link: `/f/${encodeURIComponent(f.slug)}${query}`,
    }));
    return { bookingId, customerId: booking.customer_id, needed: rows.some((r) => !r.signed), forms: rows };
  });
}
