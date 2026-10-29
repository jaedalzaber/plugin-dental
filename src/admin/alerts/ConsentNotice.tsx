// "Consent needed" notice of the booking panel: the booked service has a consent form that the patient has not
// signed since the booking was made. Links to the public form prefilled for the patient, and copies the link to send.

import { Copy, ExternalLink, FileText } from "@appointit/ui/icons";
import { Button, toast } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { useConsentStatus } from "./api";

export function ConsentNotice({ bookingId }: { bookingId: string }) {
  const t = useT();
  const consent = useConsentStatus(bookingId);
  if (!consent.data?.needed) return null;
  const pending = consent.data.forms.filter((form) => !form.signed);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(new URL(link, window.location.origin).toString());
      toast.success(t("dental.consentCopied"));
    } catch {
      toast.error(t("dental.consentCopyFailed"));
    }
  }

  return (
    <section role="status" aria-label={t("dental.consentNeeded")} className="grid gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <FileText className="size-4" aria-hidden="true" />
        {t("dental.consentNeeded")}
      </h3>
      <ul className="grid gap-2">
        {pending.map((form) => (
          <li key={form.slug} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{form.name}</span>
            <span className="flex items-center gap-1">
              <Button asChild variant="outline" size="sm">
                <a href={form.link} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  {t("dental.consentOpen")}
                </a>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void copy(form.link)}>
                <Copy aria-hidden="true" />
                {t("dental.consentCopy")}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
