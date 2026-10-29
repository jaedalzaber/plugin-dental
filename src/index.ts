import { definePlugin } from "@appointit/plugin-sdk";
import { registerChart } from "./server/chart";
import { HISTORY_REVIEW_TASK, HISTORY_REVIEW_TEMPLATE, registerHistory } from "./server/history";
import { RECALL_DAILY_TASK, registerPlans } from "./server/plans";
import { registerPrivacy } from "./server/privacy";
import { registerRoutes } from "./server/routes";
import { applyDentalSetup } from "./setup";
import { applyDentalDemo } from "./setup/demo";

export default definePlugin({
  id: "appointit.vertical-dental",
  name: "Dental clinic",
  version: "0.2.0",
  engines: { appointit: "^0.2.0" },
  permissions: [],
  register(api) {
    // Edited under Settings > Plugins. The consent form mapping (settings.consentForms) is kept by its own screen and is not listed here.
    api.declareSettings([
      {
        key: "toothNumbering",
        label: "Tooth numbering",
        type: "text",
        options: [
          { value: "fdi", label: "FDI (11 to 48)" },
          { value: "universal", label: "Universal (1 to 32)" },
        ],
        default: "fdi",
        help: "How tooth numbers are shown in the dental chart.",
      },
      {
        key: "historyReviewMonths",
        label: "Medical history review (months)",
        type: "number",
        default: 12,
        min: 1,
        max: 120,
        help: "A patient's medical history is due for review this many months after the last review.",
      },
    ]);
    registerHistory(api);
    registerChart(api);
    registerPlans(api);
    registerPrivacy(api);
    registerRoutes(api);

    // The two daily tasks above; each one skips a business that has not switched the plugin on.
    api.registerCron("0 6 * * *", RECALL_DAILY_TASK);
    api.registerCron("10 6 * * *", HISTORY_REVIEW_TASK);
    // The review reminder is a timed message: it waits for the end of quiet hours.
    api.registerMessageTemplate(HISTORY_REVIEW_TEMPLATE, { scheduled: true });

    // Choosing "Dental clinic" in the setup wizard (or on the plugin's page) switches the plugin on and adds the starter pack.
    api.registerBusinessType({
      key: "dental",
      label: "dental.businessTypeLabel",
      help: "dental.businessTypeHelp",
      setup: async (ctx) => {
        await applyDentalSetup(ctx);
      },
      demo: applyDentalDemo,
    });
  },
});
