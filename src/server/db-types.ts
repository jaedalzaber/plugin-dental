// Types of this plugin's own tables (plg_dental_*), moved out of the core generated types in W9. Regenerate with
//   pnpm --filter @appointit/db codegen:plugin dental <this file>
// after a migration changes them (then turn the generated interface into a type named DentalTables: withTables needs an index signature).
// Queries use dentalDb(tx), which adds these tables to the transaction's types.
import type { Generated, Int8, Timestamp, Tx } from "@appointit/plugin-sdk/server";

export interface PlgDentalChartEntry {
  condition: string | null;
  customer_id: string;
  id: Generated<string>;
  kind: string;
  notes_enc: string | null;
  plan_item_id: string | null;
  procedure_id: string | null;
  recorded_at: Generated<Timestamp>;
  recorded_by: string | null;
  status: Generated<string>;
  surfaces: Generated<string[]>;
  tenant_id: string;
  tooth: string;
  version: Generated<number>;
}

export interface PlgDentalInsurance {
  carrier: string;
  created_at: Generated<Timestamp>;
  customer_id: string;
  group_number: string | null;
  id: Generated<string>;
  is_primary: Generated<boolean>;
  member_id_enc: string | null;
  subscriber_name: string | null;
  subscriber_relationship: string | null;
  tenant_id: string;
  updated_at: Generated<Timestamp>;
  valid_to: Timestamp | null;
  version: Generated<number>;
}

export interface PlgDentalMedicalHistory {
  alerts_enc: string | null;
  customer_id: string;
  data_enc: string;
  has_alerts: Generated<boolean>;
  review_due_at: Timestamp | null;
  reviewed_at: Timestamp | null;
  source_submission_id: string | null;
  tenant_id: string;
  updated_at: Generated<Timestamp>;
  updated_by: string | null;
  version: Generated<number>;
}

export interface PlgDentalPlanItem {
  booking_id: string | null;
  id: Generated<string>;
  max_gap_days: number | null;
  min_gap_days: Generated<number>;
  plan_id: string;
  price_minor: Generated<Int8>;
  procedure_id: string | null;
  seq: number;
  service_id: string | null;
  status: Generated<string>;
  surfaces: Generated<string[]>;
  tenant_id: string;
  tooth: string | null;
}

export interface PlgDentalProcedure {
  active: Generated<boolean>;
  category: string | null;
  code: string | null;
  currency: string | null;
  default_price_minor: Int8 | null;
  id: Generated<string>;
  name: string;
  service_id: string | null;
  sort: Generated<number>;
  tenant_id: string;
  version: Generated<number>;
}

export interface PlgDentalRecall {
  booking_id: string | null;
  customer_id: string;
  due_on: Timestamp;
  last_reminded_at: Timestamp | null;
  last_visit_at: Timestamp | null;
  rule_id: string;
  status: Generated<string>;
  tenant_id: string;
  updated_at: Generated<Timestamp>;
}

export interface PlgDentalRecallRule {
  active: Generated<boolean>;
  id: Generated<string>;
  interval_months: number;
  lead_days: Generated<number>;
  name: string;
  service_id: string;
  tenant_id: string;
  version: Generated<number>;
}

export interface PlgDentalTreatmentPlan {
  acceptance_file_id: string | null;
  accepted_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  created_by: string | null;
  currency: string | null;
  customer_id: string;
  estimate_minor: Generated<Int8>;
  id: Generated<string>;
  insurance_estimate_minor: Generated<Int8>;
  notes_enc: string | null;
  series_id: string | null;
  status: Generated<string>;
  tenant_id: string;
  title: string;
  updated_at: Generated<Timestamp>;
  version: Generated<number>;
}

export type DentalTables = {
  plg_dental_chart_entry: PlgDentalChartEntry;
  plg_dental_insurance: PlgDentalInsurance;
  plg_dental_medical_history: PlgDentalMedicalHistory;
  plg_dental_plan_item: PlgDentalPlanItem;
  plg_dental_procedure: PlgDentalProcedure;
  plg_dental_recall: PlgDentalRecall;
  plg_dental_recall_rule: PlgDentalRecallRule;
  plg_dental_treatment_plan: PlgDentalTreatmentPlan;
};

/** The transaction with the dental tables added to its types. */
export function dentalDb(tx: Tx) {
  return tx.withTables<DentalTables>();
}

export type DentalTx = ReturnType<typeof dentalDb>;
