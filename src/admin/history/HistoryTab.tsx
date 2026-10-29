// Medical history tab on the patient page: alerts summary, review status, the history form, insurance cards and
// (for admins) the consent-form-per-service picker. Health data: shown only to members with health.read; every
// load is written to the audit log by the server.

import { AlertTriangle, Info } from "@appointit/ui/icons";
import { Button, Skeleton } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { formatDate, useAdmin } from "@appointit/plugin-sdk/client";
import { useHistory } from "./api";
import { ConsentFormsSettings } from "./ConsentFormsSettings";
import { HistoryForm } from "./HistoryForm";
import { InsuranceSection } from "./InsuranceSection";

export function HistoryTab({ customerId }: { customerId: string }) {
  const t = useT();
  const { can, locations, currentLocationId } = useAdmin();
  const history = useHistory(customerId);
  const canManage = can("health.manage");
  const timeZone = locations.find((l) => l.id === currentLocationId)?.timeZone ?? locations[0]?.timeZone ?? "UTC";
  const data = history.data;

  return (
    <div className="grid gap-4 pt-4">
      {history.isError ? (
        <div role="alert" className="grid justify-items-start gap-2">
          <p className="text-sm text-destructive">{history.error.message || t("dental.histLoadFailed")}</p>
          <Button size="sm" variant="outline" onClick={() => void history.refetch()} loading={history.isFetching}>
            {t("common.tryAgain")}
          </Button>
        </div>
      ) : !data ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          {data.alerts.length > 0 ? (
            <section
              aria-label={t("dental.histAlertsTitle")}
              className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4" aria-hidden="true" />
                {t("dental.histAlertsTitle")}
              </h3>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
                {data.alerts.map((alert, i) => (
                  <li key={`${i}-${alert.code}`}>{alert.label}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <p
            className={
              data.reviewDue
                ? "flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm"
                : "flex items-start gap-2 text-sm text-muted-foreground"
            }
          >
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {!data.exists
                ? t("dental.histNone")
                : data.reviewDue
                  ? data.reviewedAt
                    ? t("dental.histReviewDueSince", { date: formatDate(data.reviewDueAt ?? data.reviewedAt, timeZone) })
                    : t("dental.histNeverReviewed")
                  : t("dental.histReviewed", { date: formatDate(data.reviewedAt ?? data.updatedAt ?? "", timeZone), due: formatDate(data.reviewDueAt ?? "", timeZone) })}
            </span>
          </p>

          {/* Re-mounted after every save/import so the draft starts from the stored version. */}
          <HistoryForm key={`${customerId}:${data.version}`} customerId={customerId} data={data} canManage={canManage} />
        </>
      )}

      <InsuranceSection customerId={customerId} canManage={canManage} />
      {can("plugins.manage") ? <ConsentFormsSettings /> : null}
    </div>
  );
}
