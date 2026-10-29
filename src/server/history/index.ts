// Dental medical history, insurance, alerts and consent-per-procedure. Server functions used by the plugin routes
// (/api/v1/ext/dental/history, /insurance, /alerts). Nothing here runs on events: importing an intake form is an
// explicit staff action (health.manage), so unreviewed public answers never reach the chart by themselves.
// The one scheduled job is the review reminder (reminders.ts); it reads dates only.
import type { PluginApi } from "@appointit/plugin-sdk";
import { HISTORY_REVIEW_TASK, runHistoryReviewDaily } from "./reminders";

export function registerHistory(api: PluginApi): void {
  // Run once a day: index.ts registers the cron line "10 6 * * * dental_history_review".
  api.registerTask(HISTORY_REVIEW_TASK, async () => {
    await runHistoryReviewDaily();
  });
}

export { HISTORY_REVIEW_TASK, HISTORY_REVIEW_TEMPLATE, processTenantHistoryReviews, runHistoryReviewDaily } from "./reminders";

export { getHistory, importFromSubmission, listAlerts, listIntakeSubmissions, saveHistory } from "./history";
export type { AlertSummary, HistoryDto, ImportResult, IntakeSubmissionDto, SaveResult } from "./history";
export { createInsurance, deleteInsurance, INSURANCE_RELATIONSHIPS, listInsurance, updateInsurance } from "./insurance";
export type { InsuranceDto } from "./insurance";
export { getConsentForms, getConsentStatus, setConsentForms } from "./consent";
export type { ConsentFormStatus, ConsentStatus } from "./consent";
export { computeAlerts, emptyHistory, historyDocumentSchema } from "./schema";
export type { HistoryAlert, HistoryDocument } from "./schema";
export { mapIntakeAnswers, mergeImported } from "./intake-mapping";
