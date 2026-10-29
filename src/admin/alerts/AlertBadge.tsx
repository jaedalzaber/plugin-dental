// Chips for a patient on the calendar and in the booking panel:
//  - red "Medical alert", only when the patient has alerts. Members with health.read get the labels in a tooltip (and
//    inline with showLabels); everyone else only sees that an alert exists.
//  - neutral "History review due", when the medical history is missing or its review date falls on or before the visit.
//    It is computed from two dates the server sends (no decrypt, no details), so every member who sees bookings sees it.

import { AlertTriangle, ClipboardList } from "@appointit/ui/icons";
import { Badge, Tooltip, TooltipContent, TooltipTrigger, cn } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { useAlert, type AlertSummary } from "./api";

/** Booking statuses where a review before the visit still makes sense (the visit has not finished or been dropped). */
const OPEN_VISIT_STATUSES = new Set(["requested", "confirmed", "checked_in", "in_progress"]);

export interface AlertBadgeProps {
  customerId: string | null | undefined;
  /** Icon only (calendar blocks). */
  compact?: boolean;
  /** Also list the labels under the chip (booking panel: touch screens have no tooltip). */
  showLabels?: boolean;
  /** Start of the visit (ISO). The review is "due" when it falls on or before this moment; without it, when it is due now. */
  visitStart?: string;
  /** Status of the booking. A finished, cancelled or missed visit shows no review chip. */
  visitStatus?: string;
  className?: string;
}

/** True when the history is missing or the review date is not after the visit. */
export function isReviewDue(alert: Pick<AlertSummary, "historyMissing" | "reviewDueAt">, visitStart?: string, visitStatus?: string): boolean {
  if (visitStatus !== undefined && !OPEN_VISIT_STATUSES.has(visitStatus)) return false;
  if (alert.historyMissing || alert.reviewDueAt === null) return true;
  const visitMs = visitStart === undefined ? Number.NaN : Date.parse(visitStart);
  const limit = Number.isNaN(visitMs) ? Date.now() : visitMs;
  return Date.parse(alert.reviewDueAt) <= limit;
}

export function AlertBadge({ customerId, compact, showLabels, visitStart, visitStatus, className }: AlertBadgeProps) {
  const t = useT();
  const alert = useAlert(customerId);
  const data = alert.data;
  const hasAlerts = data?.hasAlerts === true;
  const reviewDue = data !== undefined && isReviewDue(data, visitStart, visitStatus);
  if (!hasAlerts && !reviewDue) return null;
  const labels = data?.labels ?? [];
  const tip = labels.length > 0 ? labels.join("\n") : t("dental.alertSeeHistory");

  const alertChip = compact ? (
    <span role="img" aria-label={t("dental.alertBadge")} className="inline-flex size-4 items-center justify-center rounded-full bg-destructive text-white shadow-sm">
      <AlertTriangle className="size-2.5" aria-hidden="true" />
    </span>
  ) : (
    <Badge variant="destructive">
      <AlertTriangle aria-hidden="true" />
      {t("dental.alertBadge")}
    </Badge>
  );

  const reviewChip = compact ? (
    <span
      role="img"
      aria-label={t("dental.historyReviewDue")}
      className="inline-flex size-4 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-sm ring-1 ring-border"
    >
      <ClipboardList className="size-2.5" aria-hidden="true" />
    </span>
  ) : (
    <Badge variant="secondary">
      <ClipboardList aria-hidden="true" />
      {t("dental.historyReviewDue")}
    </Badge>
  );

  return (
    <div className={cn(showLabels && "grid gap-1.5")}>
      <div className={cn("flex items-center gap-0.5", !compact && "flex-wrap gap-1.5", className)}>
        {hasAlerts ? (
          <Tooltip>
            <TooltipTrigger asChild>{alertChip}</TooltipTrigger>
            <TooltipContent className="whitespace-pre-line">{tip}</TooltipContent>
          </Tooltip>
        ) : null}
        {reviewDue ? (
          <Tooltip>
            <TooltipTrigger asChild>{reviewChip}</TooltipTrigger>
            <TooltipContent>{t("dental.historyReviewDueTip")}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {showLabels && hasAlerts && labels.length > 0 ? (
        <ul className="grid gap-0.5 text-sm font-medium text-destructive">
          {labels.map((label, i) => (
            <li key={`${i}-${label}`}>{label}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
