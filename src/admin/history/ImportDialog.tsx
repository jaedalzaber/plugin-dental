// "Import from intake form": lists the patient's completed intake submissions; importing one adds its answers to the
// medical history (it never removes what is already recorded).

import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Skeleton, toast } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { formatDateTime, useAdmin } from "@appointit/plugin-sdk/client";
import { useImportHistory, useIntakeSubmissions } from "./api";

export function ImportDialog({ customerId, open, onOpenChange }: { customerId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const { locations, currentLocationId } = useAdmin();
  const timeZone = locations.find((l) => l.id === currentLocationId)?.timeZone ?? locations[0]?.timeZone ?? "UTC";
  const submissions = useIntakeSubmissions(customerId, open);
  const importer = useImportHistory(customerId);

  async function run(submissionId: string) {
    try {
      const result = await importer.mutateAsync({ submissionId });
      toast.success(t("dental.histImported", { notes: result.unmapped }));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("dental.histImportFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dental.histImportTitle")}</DialogTitle>
          <DialogDescription>{t("dental.histImportHelp")}</DialogDescription>
        </DialogHeader>
        {submissions.isLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : submissions.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {submissions.error.message}
          </p>
        ) : (submissions.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dental.histImportNone")}</p>
        ) : (
          <ul className="grid gap-2">
            {(submissions.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="grid">
                  <span className="font-medium">{s.formName}</span>
                  <span className="text-muted-foreground tabular-nums">{formatDateTime(s.createdAt, timeZone)}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => void run(s.id)} disabled={importer.isPending} loading={importer.isPending && importer.variables?.submissionId === s.id}>
                  {t("dental.histImportAction")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
