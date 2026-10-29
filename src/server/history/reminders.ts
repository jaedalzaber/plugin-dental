// Medical-history review reminders: a daily task asks patients with a visit in the next three days to review their
// medical history when it has never been reviewed or its review date falls on or before the visit.
//
// Health data rules: this reads dates only (review_due_at, or no history row at all). It decrypts nothing, so it writes
// no health.read audit row, and the message holds a greeting, the visit date and a link to the clinic's intake form:
// never a condition, an allergy or any other history content.
import { queueMessage, readConfig, sql, withPlatformTx, withTenantTx } from "@appointit/plugin-sdk/server";
import type { Tx } from "@appointit/plugin-sdk/server";
import { z } from "@appointit/plugin-sdk";
import type { PluginApi } from "@appointit/plugin-sdk";
import { dentalDb } from "../db-types";
import { isDentalEnabled } from "../enabled";
import { INTAKE_FORM_SLUG } from "../../setup/data/forms";

export const HISTORY_REVIEW_TASK = "dental_history_review";
const TEMPLATE = "dental.history_review";
const HELLO = "{{#if customer.name}}Hello {{customer.name}},\n\n{{/if}}";

/** The message the reminder queues (registered by the plugin as a scheduled template; the owner can edit its text under Messages). */
export const HISTORY_REVIEW_TEMPLATE: Parameters<PluginApi["registerMessageTemplate"]>[0] = {
  key: TEMPLATE,
  label: "Medical history review",
  description: "Sent to a patient a few days before a visit when their medical history needs to be reviewed. It only carries the visit date and a link to the form, never any health details.",
  variables: ["customer.name", "business.name", "visit.date", "formUrl"],
  channels: {
    email: {
      subject: "Please review your medical history before your visit",
      body: `${HELLO}Please review your medical history before your visit on {{visit.date}}.{{#if formUrl}}\n\nOpen the form: {{formUrl}}{{/if}}`,
    },
    sms: {
      body: "{{business.name}}: please review your medical history before your visit on {{visit.date}}.{{#if formUrl}} Form: {{formUrl}}{{/if}}",
    },
  },
};
/** Visits starting within this many days are looked at. */
const WINDOW_DAYS = 3;
const BATCH = 100;
const MAX_BATCHES = 50;

const appUrlConfig = z.object({ APP_URL: z.url().default("http://localhost:3000") });

/**
 * The public intake form the message links to: the clinic's published "new patient" form from the starter pack, else
 * (for a dental clinic) its first published intake form. Null when there is none: nothing is sent then.
 * The public form page has no patient prefill, so this is the plain form address.
 */
async function intakeLink(tx: Tx, tenantId: string): Promise<string | null> {
  const forms = await tx
    .selectFrom("form")
    .select("slug")
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "published")
    .where("purpose", "=", "intake")
    .orderBy("created_at")
    .execute();
  if (forms.length === 0) return null;
  let slug = forms.find((f) => f.slug === INTAKE_FORM_SLUG)?.slug;
  if (slug === undefined) {
    // A generic intake form of some other kind of business is not a medical history form.
    const tenant = await tx.selectFrom("tenant").select("settings").where("id", "=", tenantId).executeTakeFirst();
    const settings = tenant?.settings as { businessType?: unknown } | null | undefined;
    const hasHistory = await dentalDb(tx).selectFrom("plg_dental_medical_history").select("customer_id").where("tenant_id", "=", tenantId).limit(1).executeTakeFirst();
    if (settings?.businessType === "dental" || hasHistory) slug = forms[0]?.slug;
  }
  if (slug === undefined) return null;
  return `${readConfig(appUrlConfig).APP_URL.replace(/\/+$/, "")}/f/${encodeURIComponent(slug)}`;
}

/** "Friday, October 31, 2026" in the location's time zone. */
function visitDate(ms: number, timeZone: string, locale: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone };
  try {
    return new Intl.DateTimeFormat(locale, options).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(ms);
  }
}

interface VisitRow {
  booking_id: string;
  customer_id: string;
  location_id: string;
  starts_at: Date;
  /** The exact start (microseconds kept) for the paging cursor. */
  starts_at_raw: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  time_zone: string;
  locale: string;
}

interface Cursor {
  startsAt: string;
  bookingId: string;
}

/** Queues the message by email and, when the patient has a phone number, by SMS. The key makes it once per patient and booking. */
async function queueReminders(tx: Tx, row: VisitRow, formUrl: string): Promise<number> {
  const vars = {
    customer: { name: row.display_name, firstName: row.display_name.split(/\s+/)[0] ?? row.display_name },
    visit: { date: visitDate(row.starts_at.getTime(), row.time_zone, row.locale) },
    formUrl,
  };
  let queued = 0;
  for (const [channel, to] of [["email", row.email], ["sms", row.phone]] as const) {
    if (!to || to.trim() === "") continue;
    const result = await queueMessage(tx, {
      template: TEMPLATE,
      channel,
      to: to.trim(),
      vars,
      customerId: row.customer_id,
      bookingId: row.booking_id,
      locationId: row.location_id,
      idempotencyKey: `dental.history_review:${row.customer_id}:${row.booking_id}:${channel}`,
    });
    if (result.status === "queued") queued += 1;
  }
  return queued;
}

/**
 * Reminds the tenant's patients whose requested or confirmed visit starts in the next three days and whose history is
 * missing or due for review by then. Safe to run again: a patient who got the message for a booking gets nothing more.
 */
export async function processTenantHistoryReviews(tenantId: string): Promise<{ visits: number; messages: number }> {
  const totals = { visits: 0, messages: 0 };
  const formUrl = await withTenantTx(tenantId, (tx) => intakeLink(tx, tenantId));
  if (formUrl === null) return totals;

  let after: Cursor | null = null;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const cursor: Cursor | null = after;
    const rows: VisitRow[] = await withTenantTx(tenantId, async (tx) => {
      const found = await sql<VisitRow>`
        select b.id as booking_id, b.customer_id, b.location_id, b.starts_at, b.starts_at::text as starts_at_raw,
          c.display_name, c.email, c.phone, l.time_zone, coalesce(c.locale, l.locale) as locale
        from booking b
        join customer c on c.tenant_id = b.tenant_id and c.id = b.customer_id
        join location l on l.tenant_id = b.tenant_id and l.id = b.location_id
        left join plg_dental_medical_history h on h.tenant_id = b.tenant_id and h.customer_id = b.customer_id
        where b.tenant_id = ${tenantId} and b.customer_id is not null and b.status in ('requested', 'confirmed')
          and b.starts_at > now() and b.starts_at <= now() + make_interval(days => ${WINDOW_DAYS}::int)
          and (h.customer_id is null or h.review_due_at is null or h.review_due_at <= b.starts_at)
          ${cursor ? sql`and (b.starts_at, b.id) > (${cursor.startsAt}::timestamptz, ${cursor.bookingId}::uuid)` : sql``}
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

/** The daily task: every tenant that switched the plugin on, has a published intake form and a visit in the next three days is checked. */
export async function runHistoryReviewDaily(): Promise<{ tenants: number; messages: number }> {
  const tenants = await withPlatformTx(async (tx) => {
    const found = await sql<{ tenant_id: string }>`
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
      if (!(await isDentalEnabled(tenantId))) continue;
      checked += 1;
      messages += (await processTenantHistoryReviews(tenantId)).messages;
    } catch (err) {
      console.error(`[dental] history review reminders failed for tenant ${tenantId}`, err);
    }
  }
  return { tenants: checked, messages };
}
