// Settings > Business: "Dental setup". Lists the parts of the dental pack with how many items exist and adds the missing
// ones (POST /api/v1/ext/dental/setup). Existing items are never changed, so pressing the button again is safe.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SetupPart, SetupResult, SetupStatus } from "../../server";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Skeleton, toast } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { api, useAdmin, useRefresh, type ApiError } from "@appointit/plugin-sdk/client";

const KEY = ["dental", "setup"] as const;

function useSetupStatus(enabled: boolean) {
  return useQuery<SetupStatus, ApiError>({
    queryKey: KEY,
    enabled,
    queryFn: ({ signal }) => api<SetupStatus>("/ext/dental/setup", { signal }),
  });
}

function useApplySetup() {
  const queryClient = useQueryClient();
  return useMutation<SetupResult, ApiError, void>({
    mutationFn: () => api<SetupResult>("/ext/dental/setup", { method: "POST", body: {} }),
    // The pack touches services, resources, forms, pages and the menu words: let every screen read them again.
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function DentalSetupCard() {
  const t = useT();
  const refresh = useRefresh();
  const { can } = useAdmin();
  const allowed = can("settings.manage");
  const status = useSetupStatus(allowed);
  const apply = useApplySetup();
  if (!allowed) return null;

  const labels: Record<SetupPart, string> = {
    vocabulary: t("dental.setupVocabulary"),
    resourceTypes: t("dental.setupResourceTypes"),
    services: t("dental.setupServices"),
    procedures: t("dental.setupProcedures"),
    recall: t("dental.setupRecall"),
    forms: t("dental.setupForms"),
    pages: t("dental.setupPages"),
  };

  if (status.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("dental.setupTitle")}</CardTitle>
          <CardDescription>{t("dental.setupLoadFailed")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!status.data) return <Skeleton className="h-64 w-full" />;

  const parts = status.data.parts;
  const complete = parts.every((p) => p.present >= p.total);

  function onAdd() {
    apply.mutate(undefined, {
      onSuccess: (result) => {
        const added = Object.values(result.created).reduce((sum, n) => sum + n, 0);
        toast.success(added > 0 ? t("dental.setupAdded", { count: added }) : t("dental.setupNothing"));
        for (const warning of result.warnings) toast.warning(warning);
        refresh(); // the menu shows the new words
      },
      onError: (error) => toast.error(error.message || t("dental.setupFailed")),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dental.setupTitle")}</CardTitle>
        <CardDescription>{t("dental.setupText")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {parts.map((p) => (
            <li key={p.part} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">{labels[p.part]}</span>
              {p.present >= p.total ? (
                <Badge variant="secondary">{t("dental.setupComplete")}</Badge>
              ) : (
                <Badge variant="outline">{t("dental.setupCount", { present: p.present, total: p.total })}</Badge>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" onClick={onAdd} loading={apply.isPending} disabled={complete}>
          {t("dental.setupAdd")}
        </Button>
      </CardFooter>
    </Card>
  );
}
