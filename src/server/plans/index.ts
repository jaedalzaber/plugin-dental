// Dental treatment plans (multi-visit, estimate, acceptance, booking all visits) and recall (due list, reminders).
import type { PluginApi } from "@appointit/plugin-sdk";
import { onPlanBookingEvent } from "./plans";
import { onRecallBookingEvent, RECALL_DAILY_TASK, runRecallDaily } from "./recall";

export * from "./plans";
export * from "./schedule";
export * from "./recall";

export function registerPlans(api: PluginApi): void {
  // A completed visit finishes its plan item; a cancelled one frees it.
  api.registerSubscriber("dental.plans.bookings", {
    events: ["booking.completed", "booking.cancelled", "booking.no_show"],
    handle: onPlanBookingEvent,
  });
  // Recall follows the patient's bookings of a rule's service.
  api.registerSubscriber("dental.recall.bookings", {
    events: ["booking.created", "booking.completed", "booking.cancelled", "booking.no_show"],
    handle: onRecallBookingEvent,
  });
  // Run once a day: index.ts registers the cron line "0 6 * * * dental_recall_daily".
  api.registerTask(RECALL_DAILY_TASK, async () => {
    await runRecallDaily();
  });
}
