// "Find times" for a plan: a proposed time for every visit (each after the previous one plus its minimum gap), which
// the user may change, then "Book all" creates the whole series or nothing.

import { useEffect, useState } from "react";
import { AlertTriangle } from "@appointit/ui/icons";
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Label,
  Skeleton,
  toast,
} from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { formatDateTime, formatTime, isApiError, useAdmin, useAvailability } from "@appointit/plugin-sdk/client";
import { dayGap, dayIn } from "./money";
import { useBookPlan, useFindPlanTimes, type PlanDto, type ScheduleVisit } from "./hooks";

export function ScheduleDialog({ plan, onClose }: { plan: PlanDto; onClose: () => void }) {
  const t = useT();
  const { currentLocationId, locations } = useAdmin();
  const find = useFindPlanTimes();
  const book = useBookPlan();
  const [from, setFrom] = useState<string | null>(null);
  const [starts, setStarts] = useState<Record<string, string | null>>({});
  const [changing, setChanging] = useState<string | null>(null);
  const [allowLate, setAllowLate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const location = locations.find((l) => l.id === currentLocationId);
  const timeZone = find.data?.timeZone ?? location?.timeZone ?? "UTC";

  function search() {
    if (!currentLocationId) return;
    setChanging(null);
    setError(null);
    find.mutate(
      { planId: plan.id, locationId: currentLocationId, ...(from && { from }) },
      { onSuccess: (result) => setStarts(Object.fromEntries(result.visits.map((v) => [v.itemId, v.start]))) },
    );
  }

  // Look once when the dialog opens.
  useEffect(() => {
    search();
  }, []);

  const visits = find.data?.visits ?? [];

  // Gap checks on the (possibly changed) times, against the previous visit in the list.
  const checks = visits.map((visit, index) => {
    const start = starts[visit.itemId] ?? null;
    const before = index > 0 ? (starts[visits[index - 1]?.itemId ?? ""] ?? null) : null;
    const gap = start && before ? dayGap(dayIn(before, timeZone), dayIn(start, timeZone)) : index === 0 && start === visit.start ? visit.gapDays : null;
    const tooSoon = gap !== null && gap < visit.minGapDays;
    const tooLate = gap !== null && visit.maxGapDays !== null && gap > visit.maxGapDays;
    const outOfOrder = start !== null && before !== null && Date.parse(start) <= Date.parse(before);
    return { gap, tooSoon, tooLate, outOfOrder };
  });
  const missing = visits.some((v) => !starts[v.itemId]);
  const blocked = missing || checks.some((c) => c.tooSoon || c.outOfOrder);
  const late = checks.some((c) => c.tooLate);

  async function bookAll() {
    if (!currentLocationId) return;
    setError(null);
    try {
      await book.mutateAsync({
        planId: plan.id,
        expectedVersion: plan.version,
        locationId: currentLocationId,
        visits: visits.map((v) => ({ itemId: v.itemId, start: starts[v.itemId] as string })),
        ...(allowLate && { allowLateGaps: true }),
      });
      toast.success(t("dental.planBooked", { count: visits.length }));
      onClose();
    } catch (err) {
      const visit = isApiError(err) ? (err.details as { visit?: unknown } | undefined)?.visit : undefined;
      const prefix = typeof visit === "number" ? `${t("dental.planRowLabel", { n: visits[visit]?.seq ?? visit + 1 })}: ` : "";
      setError(`${prefix}${err instanceof Error ? err.message : t("dental.planSaveFailed")}`);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("dental.scheduleTitle")}</DialogTitle>
          <DialogDescription>{t("dental.scheduleText", { title: plan.title })}</DialogDescription>
        </DialogHeader>

        {!currentLocationId ? <p className="text-sm text-muted-foreground">{t("dental.scheduleNoLocation")}</p> : null}

        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t("dental.scheduleFrom")} htmlFor="schedule-from" className="w-56">
            <DatePicker id="schedule-from" value={from} onChange={setFrom} clearable />
          </FormField>
          <Button type="button" variant="outline" onClick={search} loading={find.isPending}>
            {t("dental.scheduleSearch")}
          </Button>
        </div>

        {find.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : find.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {find.error.message}
          </p>
        ) : (
          <ol className="grid gap-2">
            {visits.map((visit, index) => (
              <VisitRow
                key={visit.itemId}
                visit={visit}
                start={starts[visit.itemId] ?? null}
                check={checks[index]}
                timeZone={timeZone}
                locationId={currentLocationId}
                changing={changing === visit.itemId}
                onToggle={() => setChanging(changing === visit.itemId ? null : visit.itemId)}
                onPick={(start) => {
                  setStarts((s) => ({ ...s, [visit.itemId]: start }));
                  setChanging(null);
                }}
              />
            ))}
          </ol>
        )}

        {late ? (
          <div className="flex items-start gap-2">
            <Checkbox id="schedule-late" checked={allowLate} onCheckedChange={(v) => setAllowLate(v === true)} />
            <Label htmlFor="schedule-late" className="text-sm font-normal">
              {t("dental.scheduleAllowLate")}
            </Label>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button type="button" disabled={find.isPending || visits.length === 0 || blocked || (late && !allowLate)} loading={book.isPending} onClick={() => void bookAll()}>
            {t("dental.scheduleBookAll", { count: visits.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Check {
  gap: number | null;
  tooSoon: boolean;
  tooLate: boolean;
  outOfOrder: boolean;
}

function VisitRow({
  visit,
  start,
  check,
  timeZone,
  locationId,
  changing,
  onToggle,
  onPick,
}: {
  visit: ScheduleVisit;
  start: string | null;
  check: Check | undefined;
  timeZone: string;
  locationId: string | null;
  changing: boolean;
  onToggle: () => void;
  onPick: (start: string) => void;
}) {
  const t = useT();
  const problem =
    visit.problem === "no_service"
      ? t("dental.scheduleNoService")
      : visit.problem === "no_slot"
        ? t("dental.scheduleNoSlot")
        : visit.problem === "after_unscheduled"
          ? t("dental.scheduleAfterUnscheduled")
          : null;
  const warnings = [
    check?.outOfOrder ? t("dental.scheduleOutOfOrder") : null,
    check?.tooSoon ? t("dental.scheduleTooSoon", { days: visit.minGapDays }) : null,
    check?.tooLate && visit.maxGapDays !== null ? t("dental.scheduleTooLate", { days: visit.maxGapDays }) : null,
  ].filter((w): w is string => w !== null);

  return (
    <li className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-muted-foreground">{t("dental.planRowLabel", { n: visit.seq })}</span>
          <span className="block truncate font-medium">{visit.title || visit.serviceName || "-"}</span>
        </span>
        <span className="text-sm">
          {start ? formatDateTime(start, timeZone) : <span className="text-muted-foreground">{t("dental.scheduleNoTime")}</span>}
          {check?.gap != null ? <span className="ml-2 text-[13px] text-muted-foreground">{t("dental.scheduleGap", { count: check.gap })}</span> : null}
        </span>
        {visit.serviceId ? (
          <Button type="button" variant="outline" size="sm" onClick={onToggle} aria-expanded={changing}>
            {t("dental.scheduleChange")}
          </Button>
        ) : null}
      </div>
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
      {warnings.map((w) => (
        <p key={w} className="flex items-center gap-1.5 text-[13px] text-warning">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          {w}
        </p>
      ))}
      {changing && visit.serviceId ? <SlotPicker serviceId={visit.serviceId} locationId={locationId} timeZone={timeZone} initialDay={start ? dayIn(start, timeZone) : null} onPick={onPick} /> : null}
    </li>
  );
}

function SlotPicker({ serviceId, locationId, timeZone, initialDay, onPick }: { serviceId: string; locationId: string | null; timeZone: string; initialDay: string | null; onPick: (start: string) => void }) {
  const t = useT();
  const [day, setDay] = useState<string | null>(initialDay);
  const slots = useAvailability({ locationId: locationId ?? undefined, serviceIds: [serviceId], from: day ?? undefined, days: 1 }, { enabled: locationId !== null && day !== null });
  return (
    <div className="grid gap-2 rounded-md bg-muted/40 p-3">
      <FormField label={t("dental.scheduleDay")} className="w-56">
        <DatePicker value={day} onChange={setDay} />
      </FormField>
      {slots.isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : slots.isError ? (
        <p className="text-sm text-destructive">{slots.error?.message}</p>
      ) : (slots.data?.slots.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t("dental.scheduleNoSlotsDay")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {slots.data?.slots.map((slot) => (
            <Button key={slot.start} type="button" variant="outline" size="sm" onClick={() => onPick(slot.start)}>
              {formatTime(slot.start, timeZone)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
