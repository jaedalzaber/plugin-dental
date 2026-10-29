// Reports > one more KPI tile: patients due for a recall (or already reminded) right now. Looks like the host's own tiles.
import { useQuery } from "@tanstack/react-query";
import { Card } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { api } from "@appointit/plugin-sdk/client";

interface RecallCounts {
  due: number;
  reminded: number;
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function RecallTile() {
  const t = useT();
  const recall = useQuery<RecallCounts>({
    queryKey: ["dental", "reports", "recall"],
    queryFn: ({ signal }) => api<RecallCounts>("/ext/dental/reports/recall", { signal }),
  });
  const data = recall.data;
  if (!data) return null;
  return (
    <Card className="min-w-0 gap-1 py-4">
      <div className="px-4">
        <p className="text-sm text-muted-foreground">{t("dental.reportRecallDue")}</p>
        <div className="mt-1 break-words text-2xl font-semibold">{numberFormat.format(data.due)}</div>
        {data.reminded > 0 ? <p className="mt-1 text-xs text-muted-foreground">{t("dental.reportRecallHint", { count: data.reminded })}</p> : null}
      </div>
    </Card>
  );
}
