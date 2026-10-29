import type { StatusTone } from "@appointit/ui";

export const PLAN_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  proposed: "info",
  accepted: "success",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
};

export const RECALL_TONE: Record<string, StatusTone> = {
  upcoming: "neutral",
  due: "warning",
  reminded: "info",
  scheduled: "success",
  snoozed: "neutral",
  done: "success",
};
