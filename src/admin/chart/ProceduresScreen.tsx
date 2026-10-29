
import { useState } from "react";
import { Button, Checkbox, DataTable, EmptyState, Label, PageHeader, StatusBadge, toast, type DataTableColumn } from "@appointit/ui";
import { ArrowDown, ArrowUp, ClipboardList, Pencil, Plus } from "@appointit/ui/icons";
import { useT } from "@appointit/i18n/react";
import { formatMoney, useAdmin } from "@appointit/plugin-sdk/client";
import { ProcedureDialog } from "./ProcedureDialog";
import { useProcedures, useReorderProcedures, useUpdateProcedure, type ProcedureDto } from "./hooks";

/** /admin/ext/dental/procedures: the clinic's own catalog of procedures (no licensed code list is included). */
export function ProceduresScreen() {
  const t = useT();
  const { locations, currentLocationId } = useAdmin();
  const defaultCurrency = locations.find((l) => l.id === currentLocationId)?.currency ?? locations[0]?.currency ?? "USD";
  const [showArchived, setShowArchived] = useState(false);
  const procedures = useProcedures(showArchived);
  const update = useUpdateProcedure();
  const reorder = useReorderProcedures();
  const [editing, setEditing] = useState<ProcedureDto | "new" | null>(null);

  const rows = procedures.data ?? [];

  async function move(index: number, step: -1 | 1) {
    const ids = rows.map((r) => r.id);
    const target = index + step;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    try {
      await reorder.mutateAsync(ids);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("dental.procSaveFailed"));
    }
  }

  async function setActive(row: ProcedureDto, active: boolean) {
    try {
      await update.mutateAsync({ id: row.id, expectedVersion: row.version, active });
      toast.success(active ? t("dental.procRestored") : t("dental.procArchivedToast"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("dental.procSaveFailed"));
    }
  }

  const addButton = (
    <Button type="button" onClick={() => setEditing("new")}>
      <Plus aria-hidden="true" />
      {t("dental.procAdd")}
    </Button>
  );

  const columns: DataTableColumn<ProcedureDto>[] = [
    {
      key: "name",
      header: t("dental.procColName"),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.category ? <p className="truncate text-[13px] text-muted-foreground">{row.category}</p> : null}
        </div>
      ),
    },
    { key: "code", header: t("dental.procColCode"), className: "w-32", cell: (row) => row.code ?? <span className="text-muted-foreground">-</span> },
    {
      key: "price",
      header: t("dental.procColPrice"),
      className: "w-32",
      cell: (row) =>
        row.defaultPriceMinor !== null && row.currency ? formatMoney(row.defaultPriceMinor, row.currency) : <span className="text-muted-foreground">-</span>,
    },
    { key: "service", header: t("dental.procColService"), className: "w-48", cell: (row) => row.serviceName ?? <span className="text-muted-foreground">-</span> },
    {
      key: "status",
      header: t("dental.procColStatus"),
      className: "w-28",
      cell: (row) => <StatusBadge tone={row.active ? "success" : "neutral"}>{row.active ? t("dental.procActive") : t("dental.procArchived")}</StatusBadge>,
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("dental.procColActions")}</span>,
      className: "w-56",
      cell: (row) => {
        const index = rows.findIndex((r) => r.id === row.id);
        return (
          <div className="flex items-center justify-end gap-1">
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("dental.procMoveUp")} disabled={index <= 0 || reorder.isPending} onClick={() => void move(index, -1)}>
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("dental.procMoveDown")} disabled={index >= rows.length - 1 || reorder.isPending} onClick={() => void move(index, 1)}>
              <ArrowDown aria-hidden="true" />
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(row)}>
              <Pencil aria-hidden="true" />
              {t("dental.procEdit")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => void setActive(row, !row.active)}>
              {row.active ? t("dental.procArchive") : t("dental.procRestore")}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title={t("dental.procTitle")} description={t("dental.procDescription")} actions={addButton} />
      <div className="mb-3 flex items-center gap-2">
        <Checkbox id="proc-show-archived" checked={showArchived} onCheckedChange={(checked) => setShowArchived(checked === true)} />
        <Label htmlFor="proc-show-archived" className="cursor-pointer font-normal">
          {t("dental.procShowArchived")}
        </Label>
      </div>
      {procedures.isError ? (
        <EmptyState
          title={t("dental.procLoadFailed")}
          description={procedures.error.message}
          action={
            <Button variant="outline" onClick={() => void procedures.refetch()}>
              {t("common.tryAgain")}
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={rows}
          loading={procedures.isLoading}
          getRowId={(row) => row.id}
          columns={columns}
          empty={<EmptyState icon={ClipboardList} title={t("dental.procEmptyTitle")} description={t("dental.procEmptyText")} action={addButton} />}
        />
      )}
      {editing ? (
        <ProcedureDialog procedure={editing === "new" ? null : editing} defaultCurrency={defaultCurrency} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
