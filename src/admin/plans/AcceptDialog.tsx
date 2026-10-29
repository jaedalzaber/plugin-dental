// The patient accepts a proposed plan: they sign (draw) or type their name.

import { useRef, useState, type FormEvent } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FormField, Input, toast } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { formatMoney } from "@appointit/plugin-sdk/client";
import { usePlanAction, type PlanDto } from "./hooks";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";

type Method = "draw" | "type";

export function AcceptDialog({ plan, patientName, onClose }: { plan: PlanDto; patientName: string; onClose: () => void }) {
  const t = useT();
  const accept = usePlanAction();
  const pad = useRef<SignaturePadHandle>(null);
  const [method, setMethod] = useState<Method>("draw");
  const [name, setName] = useState(patientName);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signerName = name.trim();
    if (signerName === "") return setError(t("dental.planSignNeedName"));
    const drawn = method === "draw" ? pad.current?.read() : null;
    if (method === "draw" && !drawn) return setError(t("dental.planSignNeedInk"));
    setError(null);
    try {
      await accept.mutateAsync({
        planId: plan.id,
        expectedVersion: plan.version,
        action: "accept",
        signerName,
        ...(drawn && { signatureDataUrl: drawn.dataUrl, strokes: drawn.strokes }),
      });
      toast.success(t("dental.planAccepted"));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dental.planSaveFailed"));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("dental.planAcceptTitle")}</DialogTitle>
            <DialogDescription>
              {t("dental.planAcceptText", { title: plan.title, total: plan.currency ? formatMoney(plan.estimateMinor, plan.currency) : String(plan.estimateMinor) })}
            </DialogDescription>
          </DialogHeader>
          <FormField label={t("dental.planSignName")} htmlFor="plan-signer">
            <Input id="plan-signer" value={name} maxLength={200} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </FormField>
          <div className="flex gap-2" role="tablist" aria-label={t("dental.planSignMethod")}>
            {(["draw", "type"] as const).map((m) => (
              <Button key={m} type="button" role="tab" aria-selected={method === m} variant={method === m ? "default" : "outline"} size="sm" onClick={() => setMethod(m)}>
                {m === "draw" ? t("dental.planSignDraw") : t("dental.planSignType")}
              </Button>
            ))}
          </div>
          {method === "draw" ? (
            <SignaturePad handleRef={pad} />
          ) : (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{t("dental.planSignTypedNote", { name: name.trim() || "..." })}</p>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={accept.isPending}>
              {t("dental.planAcceptButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
