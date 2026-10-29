
import { DataTable, EmptyState, StatusBadge, type DataTableColumn } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { formatTooth } from "../../server/chart/model";
import type { ChartEntryDto, ToothNumbering } from "../../server/chart/model";
import { formatDate } from "@appointit/plugin-sdk/client";
import { KIND_TONE, entryWhat } from "./chart-view";

/** The same entries as the chart, as a table (newest first). Selecting a row selects its tooth. */
export function ChartList({
  entries,
  numbering,
  timeZone,
  onSelect,
}: {
  entries: ChartEntryDto[];
  numbering: ToothNumbering;
  timeZone: string;
  onSelect: (tooth: string) => void;
}) {
  const t = useT();
  const columns: DataTableColumn<ChartEntryDto>[] = [
    { key: "tooth", header: t("dental.chartColTooth"), className: "w-20", cell: (row) => <span className="font-medium tabular-nums">{formatTooth(row.tooth, numbering)}</span> },
    { key: "what", header: t("dental.chartColFinding"), cell: (row) => entryWhat(row, t) },
    { key: "surfaces", header: t("dental.chartColSurfaces"), className: "w-32", cell: (row) => (row.surfaces.length === 0 ? t("dental.chartWholeTooth") : row.surfaces.join(", ")) },
    { key: "kind", header: t("dental.chartColKind"), className: "w-36", cell: (row) => <StatusBadge tone={KIND_TONE[row.kind]}>{t(`dental.kind_${row.kind}`)}</StatusBadge> },
    {
      key: "status",
      header: t("dental.chartColStatus"),
      className: "w-32",
      cell: (row) => (row.status === "resolved" ? <StatusBadge>{t("dental.entryStatus_resolved")}</StatusBadge> : t("dental.entryStatus_active")),
    },
    { key: "recorded", header: t("dental.chartColRecorded"), className: "w-40", cell: (row) => formatDate(row.recordedAt, timeZone) },
  ];
  return (
    <DataTable
      rows={entries}
      getRowId={(row) => row.id}
      columns={columns}
      onRowClick={(row) => onSelect(row.tooth)}
      empty={<EmptyState title={t("dental.chartEmptyTitle")} description={t("dental.chartEmptyText")} />}
    />
  );
}
