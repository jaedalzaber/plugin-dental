// Privacy handlers of the dental vertical: what goes into a patient's data export and what is deleted when the patient
// is erased. Health data here is encrypted (history, insurance member id, chart notes, plan notes); every decrypt for an
// export is logged as "health.read". Erasure deletes the history and insurance rows, clears chart and plan notes and the
// signed acceptance files, and removes recall rows; the chart and plan rows stay but belong to an anonymized patient.
import { decryptField, registerPrivacyHandler, sql } from "@appointit/plugin-sdk/server";
import type { PluginApi } from "@appointit/plugin-sdk";
import { dentalDb } from "./db-types";

const CHART_NOTES_FIELD = "dental.chart.notes";
const PLAN_NOTES_FIELD = "plg_dental_treatment_plan.notes";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const parse = (json: string): unknown => JSON.parse(json) as unknown;

export function registerPrivacy(_api: PluginApi): void {
  registerPrivacyHandler({
    id: "dental",

    async export({ tx, tenantId, customerIds, logRead }) {
      const ids = [...customerIds];

      const historyRows = await dentalDb(tx).selectFrom("plg_dental_medical_history").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "in", ids).execute();
      const medicalHistory = [];
      for (const h of historyRows) {
        await logRead("dental.medical_history", h.customer_id);
        medicalHistory.push({
          customerId: h.customer_id,
          document: parse(decryptField(h.data_enc, { tenantId, field: `plg_dental_medical_history.data:${h.customer_id}` })),
          alerts: h.alerts_enc ? parse(decryptField(h.alerts_enc, { tenantId, field: `plg_dental_medical_history.alerts:${h.customer_id}` })) : [],
          reviewedAt: iso(h.reviewed_at),
          reviewDueAt: iso(h.review_due_at),
          updatedAt: iso(h.updated_at),
        });
      }

      const insuranceRows = await dentalDb(tx).selectFrom("plg_dental_insurance").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "in", ids).execute();
      const insurance = [];
      for (const i of insuranceRows) {
        if (i.member_id_enc) await logRead("dental.insurance", i.customer_id);
        insurance.push({
          customerId: i.customer_id,
          carrier: i.carrier,
          memberId: i.member_id_enc ? decryptField(i.member_id_enc, { tenantId, field: `plg_dental_insurance.member_id:${i.id}` }) : null,
          groupNumber: i.group_number,
          subscriberName: i.subscriber_name,
          subscriberRelationship: i.subscriber_relationship,
          isPrimary: i.is_primary,
          validTo: i.valid_to,
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
        notes: e.notes_enc ? decryptField(e.notes_enc, { tenantId, field: CHART_NOTES_FIELD }) : null,
        recordedAt: iso(e.recorded_at),
      }));

      const planRows = await dentalDb(tx).selectFrom("plg_dental_treatment_plan").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "in", ids).orderBy("created_at").execute();
      const planIds = planRows.map((p) => p.id);
      const itemRows = planIds.length
        ? await dentalDb(tx).selectFrom("plg_dental_plan_item").selectAll().where("tenant_id", "=", tenantId).where("plan_id", "in", planIds).orderBy("seq").execute()
        : [];
      const plans = [];
      for (const p of planRows) {
        if (p.notes_enc) await logRead("dental.treatment_plan", p.customer_id);
        plans.push({
          customerId: p.customer_id,
          title: p.title,
          status: p.status,
          currency: p.currency,
          estimateMinor: p.estimate_minor,
          insuranceEstimateMinor: p.insurance_estimate_minor,
          notes: p.notes_enc ? decryptField(p.notes_enc, { tenantId, field: PLAN_NOTES_FIELD }) : null,
          acceptedAt: iso(p.accepted_at),
          createdAt: iso(p.created_at),
          items: itemRows
            .filter((i) => i.plan_id === p.id)
            .map((i) => ({ seq: i.seq, tooth: i.tooth, surfaces: i.surfaces, priceMinor: i.price_minor, status: i.status })),
        });
      }

      const recallRows = await dentalDb(tx).selectFrom("plg_dental_recall").selectAll().where("tenant_id", "=", tenantId).where("customer_id", "in", ids).execute();
      const recalls = recallRows.map((r) => ({ customerId: r.customer_id, dueOn: r.due_on, status: r.status, lastVisitAt: iso(r.last_visit_at) }));

      return { medicalHistory, insurance, chart, treatmentPlans: plans, recalls };
    },

    async erase({ tx, tenantId, customerIds }) {
      const ids = [...customerIds];
      const history = await dentalDb(tx).deleteFrom("plg_dental_medical_history").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).returning("customer_id").execute();
      const insurance = await dentalDb(tx).deleteFrom("plg_dental_insurance").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).returning("id").execute();
      const chartNotes = await dentalDb(tx)
        .updateTable("plg_dental_chart_entry")
        .set({ notes_enc: null, version: sql<number>`version + 1` })
        .where("tenant_id", "=", tenantId)
        .where("customer_id", "in", ids)
        .where("notes_enc", "is not", null)
        .returning("id")
        .execute();
      const acceptance = await dentalDb(tx)
        .selectFrom("plg_dental_treatment_plan")
        .select("acceptance_file_id")
        .where("tenant_id", "=", tenantId)
        .where("customer_id", "in", ids)
        .where("acceptance_file_id", "is not", null)
        .execute();
      const planNotes = await dentalDb(tx)
        .updateTable("plg_dental_treatment_plan")
        .set({ notes_enc: null, acceptance_file_id: null, version: sql<number>`version + 1` })
        .where("tenant_id", "=", tenantId)
        .where("customer_id", "in", ids)
        .where((eb) => eb.or([eb("notes_enc", "is not", null), eb("acceptance_file_id", "is not", null)]))
        .returning("id")
        .execute();
      const recalls = await dentalDb(tx).deleteFrom("plg_dental_recall").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).returning("customer_id").execute();
      return {
        counts: {
          history: history.length,
          insurance: insurance.length,
          chartNotes: chartNotes.length,
          planNotes: planNotes.length,
          recalls: recalls.length,
        },
        fileIds: acceptance.map((a) => a.acceptance_file_id as string),
      };
    },
  });
}
