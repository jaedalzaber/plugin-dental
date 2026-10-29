// Dental chart tab on the patient page: an odontogram (upper and lower arch) with a side panel for the selected tooth.
import { useMemo, useState } from "react";
import { Button, EmptyState, Skeleton, toast } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { dentitionOf } from "../../server/chart/model";
import type { ChartEntryDto, Dentition, ToothNumbering } from "../../server/chart/model";
import { useAdmin } from "@appointit/plugin-sdk/client";
import { ChartList } from "./ChartList";
import { KINDS_IN_ORDER, KIND_FILL } from "./chart-view";
import { useChart, useSaveNumbering } from "./hooks";
import { Odontogram } from "./Odontogram";
import { ToothPanel } from "./ToothPanel";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border bg-background p-0.5">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? "default" : "ghost"}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function Legend() {
  const t = useT();
  return (
    <ul aria-label={t("dental.chartLegend")} className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      {KINDS_IN_ORDER.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <svg viewBox="0 0 10 10" aria-hidden="true" className="size-3">
            <rect width="10" height="10" rx="2" className={KIND_FILL[kind]} />
          </svg>
          {t(`dental.kind_${kind}`)}
        </li>
      ))}
    </ul>
  );
}

export function ChartTab({ customerId }: { customerId: string }) {
  const t = useT();
  const { can, locations, currentLocationId } = useAdmin();
  const chart = useChart(customerId);
  const saveNumbering = useSaveNumbering(customerId);
  const [dentition, setDentition] = useState<Dentition>("adult");
  const [view, setView] = useState<"chart" | "list">("chart");
  const [selected, setSelected] = useState<string | null>(null);
  const [numberingChoice, setNumberingChoice] = useState<ToothNumbering | null>(null);

  const timeZone = locations.find((l) => l.id === currentLocationId)?.timeZone ?? "UTC";
  const entries = useMemo(() => chart.data?.entries ?? [], [chart.data]);
  const clinicNumbering = chart.data?.toothNumbering ?? "fdi";
  const numbering = numberingChoice ?? clinicNumbering;

  const byTooth = useMemo(() => {
    const map = new Map<string, ChartEntryDto[]>();
    for (const entry of entries) map.set(entry.tooth, [...(map.get(entry.tooth) ?? []), entry]);
    return map;
  }, [entries]);

  function select(tooth: string) {
    setSelected(tooth);
    setDentition(dentitionOf(tooth));
  }

  async function saveDefault() {
    try {
      await saveNumbering.mutateAsync(numbering);
      setNumberingChoice(null);
      toast.success(t("dental.chartDefaultSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("dental.chartSaveFailed"));
    }
  }

  if (chart.isLoading) return <Skeleton className="h-80 w-full" />;
  if (chart.isError) {
    return (
      <EmptyState
        title={t("dental.chartLoadFailed")}
        description={chart.error.message}
        action={
          <Button variant="outline" onClick={() => void chart.refetch()}>
            {t("common.tryAgain")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented
          label={t("dental.chartDentition")}
          value={dentition}
          onChange={setDentition}
          options={[
            { value: "adult", label: t("dental.chartAdult") },
            { value: "child", label: t("dental.chartChild") },
          ]}
        />
        <Segmented
          label={t("dental.chartNumbering")}
          value={numbering}
          onChange={setNumberingChoice}
          options={[
            { value: "fdi", label: t("dental.chartNumberingFdi") },
            { value: "universal", label: t("dental.chartNumberingUniversal") },
          ]}
        />
        {can("plugins.manage") && numbering !== clinicNumbering ? (
          <Button type="button" size="sm" variant="outline" loading={saveNumbering.isPending} onClick={() => void saveDefault()}>
            {t("dental.chartSaveDefault")}
          </Button>
        ) : null}
        <div className="ml-auto">
          <Segmented
            label={t("dental.chartView")}
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: t("dental.chartViewChart") },
              { value: "list", label: t("dental.chartViewList") },
            ]}
          />
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid min-w-0 gap-3">
          {view === "chart" ? (
            <>
              <Odontogram dentition={dentition} numbering={numbering} entriesByTooth={byTooth} selected={selected} onSelect={select} />
              <Legend />
            </>
          ) : (
            <ChartList entries={entries} numbering={numbering} timeZone={timeZone} onSelect={select} />
          )}
        </div>
        <ToothPanel
          customerId={customerId}
          tooth={selected}
          entries={selected ? (byTooth.get(selected) ?? []) : []}
          numbering={numbering}
          canManage={can("health.manage")}
          timeZone={timeZone}
          onClose={() => setSelected(null)}
        />
      </div>
    </div>
  );
}
