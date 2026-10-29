// Admin picker: which consent form each service needs. The booking panel shows "Consent needed" for a booking whose
// service has a form here and whose patient has not submitted it since the booking was made.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Select, Skeleton, toast } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { api, useServices, type ApiError } from "@appointit/plugin-sdk/client";
import { useConsentForms, useSaveConsentForms, type ConsentFormMap } from "./api";

type PublishedForm = { slug: string; name: string; purpose: string };

function clean(map: ConsentFormMap): ConsentFormMap {
  return Object.fromEntries(Object.entries(map).filter(([, slug]) => slug !== ""));
}

export function ConsentFormsSettings() {
  const t = useT();
  const services = useServices();
  const saved = useConsentForms(true);
  const forms = useQuery<PublishedForm[], ApiError>({
    queryKey: ["dental", "consent-form-options"],
    queryFn: ({ signal }) => api<PublishedForm[]>("/forms", { signal, query: { status: "published" } }),
    retry: false,
  });
  const save = useSaveConsentForms();
  const [edits, setEdits] = useState<ConsentFormMap | null>(null);

  const draft = edits ?? saved.data ?? {};
  const dirty = edits !== null && JSON.stringify(clean(edits)) !== JSON.stringify(clean(saved.data ?? {}));
  const options = [
    { value: "", label: t("dental.consentNoForm") },
    ...(forms.data ?? [])
      .slice()
      .sort((a, b) => Number(b.purpose === "consent") - Number(a.purpose === "consent") || a.name.localeCompare(b.name))
      .map((f) => ({ value: f.slug, label: f.name, description: f.purpose })),
  ];
  const loading = services.isLoading || saved.isLoading || forms.isLoading;
  const failed = services.error ?? saved.error ?? forms.error;

  async function submit() {
    try {
      await save.mutateAsync(clean(draft));
      setEdits(null);
      toast.success(t("dental.consentSettingsSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("dental.consentSettingsFailed"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dental.consentSettingsTitle")}</CardTitle>
        <CardDescription>{t("dental.consentSettingsText")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : failed ? (
          <p role="alert" className="text-sm text-destructive">
            {failed.message}
          </p>
        ) : (services.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dental.consentNoServices")}</p>
        ) : (
          <>
            <ul className="grid gap-2">
              {(services.data ?? []).map((service) => (
                <li key={service.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{service.name}</span>
                  <Select
                    className="w-64 max-w-full"
                    aria-label={t("dental.consentFormFor", { service: service.name })}
                    value={draft[service.id] ?? ""}
                    placeholder={t("dental.consentNoForm")}
                    options={options}
                    onChange={(slug) => setEdits({ ...draft, [service.id]: slug })}
                  />
                </li>
              ))}
            </ul>
            <div>
              <Button onClick={() => void submit()} disabled={!dirty} loading={save.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
