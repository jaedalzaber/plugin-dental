
import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Separator, Skeleton, StatusBadge, toast } from "@appointit/ui";
import { History, X } from "@appointit/ui/icons";
import { useT } from "@appointit/i18n/react";
import { dentitionOf, fdiToUniversal, formatTooth } from "../../server/chart/model";
import type { ChartEntryDto, EntryStatus, ToothNumbering } from "../../server/chart/model";
import { formatDateTime } from "@appointit/plugin-sdk/client";
import { KIND_TONE, entryWhat, surfaceText } from "./chart-view";
import { EntryForm } from "./EntryForm";
import { useToothHistory, useUpdateEntry } from "./hooks";

function EntryRow({ customerId, entry, canManage, timeZone }: { customerId: string; entry: ChartEntryDto; canManage: boolean; timeZone: string }) {
  const t = useT();
  const update = useUpdateEntry(customerId);
  const [confirmVoid, setConfirmVoid] = useState(false);

  async function setStatus(status: EntryStatus) {
    try {
      await update.mutateAsync({ id: entry.id, expectedVersion: entry.version, status });
      toast.success(t("dental.chartUpdated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("dental.chartSaveFailed"));
      throw error;
    }
  }

  const resolved = entry.status === "resolved";
  return (
    <li className="grid gap-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={KIND_TONE[entry.kind]}>{t(`dental.kind_${entry.kind}`)}</StatusBadge>
        <span className={resolved ? "font-medium text-muted-foreground line-through" : "font-medium"}>{entryWhat(entry, t)}</span>
        {resolved ? <StatusBadge>{t("dental.entryStatus_resolved")}</StatusBadge> : null}
      </div>
      <p className="text-[13px] text-muted-foreground">
        {entry.surfaces.length === 0 ? t("dental.chartWholeTooth") : t("dental.chartSurfacesLine", { surfaces: surfaceText(entry) })}
        {entry.condition && entry.procedureName ? ` · ${entry.procedureName}` : ""}
      </p>
      {entry.notes ? <p className="text-sm whitespace-pre-wrap">{entry.notes}</p> : null}
      <p className="text-[13px] text-muted-foreground">
        {t("dental.chartRecorded", { who: entry.recordedByName ?? t("dental.chartUnknownUser"), when: formatDateTime(entry.recordedAt, timeZone) })}
      </p>
      {canManage ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" size="sm" variant="outline" disabled={update.isPending} onClick={() => void setStatus(resolved ? "active" : "resolved").catch(() => {})}>
            {resolved ? t("dental.chartReopen") : t("dental.chartResolve")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => setConfirmVoid(true)}>
            {t("dental.chartVoid")}
          </Button>
          <ConfirmDialog
            open={confirmVoid}
            onOpenChange={setConfirmVoid}
            destructive
            title={t("dental.chartVoidTitle")}
            description={t("dental.chartVoidText")}
            confirmLabel={t("dental.chartVoid")}
            onConfirm={() => setStatus("void")}
          />
        </div>
      ) : null}
    </li>
  );
}

function ToothHistory({ customerId, tooth, timeZone }: { customerId: string; tooth: string; timeZone: string }) {
  const t = useT();
  const history = useToothHistory(customerId, tooth, true);
  if (history.isLoading) return <Skeleton className="h-16 w-full" />;
  if (history.isError) return <p className="text-sm text-destructive">{history.error.message}</p>;
  const items = history.data ?? [];
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t("dental.chartHistoryEmpty")}</p>;
  return (
    <ol className="grid gap-1.5 text-[13px]">
      {items.map((item) => (
        <li key={item.id} className="text-muted-foreground">
          <span className="font-medium text-foreground">{t(`dental.chartEvent_${item.event}`)}</span>
          {item.condition ? ` · ${t(`dental.condition_${item.condition}`)}` : item.kind ? ` · ${t(`dental.kind_${item.kind}`)}` : ""}
          {` · ${item.actorName ?? t("dental.chartUnknownUser")}, ${formatDateTime(item.at, timeZone)}`}
        </li>
      ))}
    </ol>
  );
}

/** Side panel of the chart: the entries of the selected tooth, resolve or void actions, history, and the add form. */
export function ToothPanel({
  customerId,
  tooth,
  entries,
  numbering,
  canManage,
  timeZone,
  onClose,
}: {
  customerId: string;
  tooth: string | null;
  entries: ChartEntryDto[];
  numbering: ToothNumbering;
  canManage: boolean;
  timeZone: string;
  onClose: () => void;
}) {
  const t = useT();
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  if (tooth === null) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("dental.chartSelectTooth")}</CardContent>
      </Card>
    );
  }

  const active = entries.filter((e) => e.status === "active");
  const resolved = entries.filter((e) => e.status === "resolved");
  const other = numbering === "fdi" ? fdiToUniversal(tooth) : tooth;
  const showHistory = historyFor === tooth;

  return (
    <Card aria-live="polite">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{t("dental.chartPanelTitle", { tooth: formatTooth(tooth, numbering) })}</CardTitle>
          <p className="text-[13px] text-muted-foreground">
            {t(numbering === "fdi" ? "dental.chartPanelAltUniversal" : "dental.chartPanelAltFdi", { number: other })}
            {` · ${t(dentitionOf(tooth) === "adult" ? "dental.chartAdult" : "dental.chartChild")}`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("dental.chartClosePanel")} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dental.chartNoEntries")}</p>
        ) : (
          <ul className="grid gap-2">
            {[...active, ...resolved].map((entry) => (
              <EntryRow key={entry.id} customerId={customerId} entry={entry} canManage={canManage} timeZone={timeZone} />
            ))}
          </ul>
        )}
        <div className="grid gap-2">
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setHistoryFor(showHistory ? null : tooth)} aria-expanded={showHistory}>
            <History aria-hidden="true" />
            {showHistory ? t("dental.chartHideHistory") : t("dental.chartShowHistory")}
          </Button>
          {showHistory ? <ToothHistory customerId={customerId} tooth={tooth} timeZone={timeZone} /> : null}
        </div>
        {canManage ? (
          <>
            <Separator />
            <EntryForm key={tooth} customerId={customerId} tooth={tooth} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
