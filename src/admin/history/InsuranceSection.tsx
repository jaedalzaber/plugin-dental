// Insurance cards of a patient: list, add, edit, delete. Member ids are encrypted at rest; reading them is logged.

import { useId, useState } from "react";
import { Pencil, Plus, Trash2 } from "@appointit/ui/icons";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
  Select,
  Skeleton,
  toast,
} from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { isApiError, issuesOf } from "@appointit/plugin-sdk/client";
import { useDeleteInsurance, useInsurance, useSaveInsurance, type InsuranceDto, type InsuranceInput } from "./api";

const RELATIONSHIPS = ["self", "spouse", "child", "parent", "other"] as const;

const blank: InsuranceInput = {
  carrier: "",
  memberId: "",
  groupNumber: "",
  subscriberName: "",
  subscriberRelationship: null,
  isPrimary: false,
  validTo: null,
};

function InsuranceDialog({
  customerId,
  policy,
  isFirst,
  onClose,
}: {
  customerId: string;
  /** The policy being edited; null for a new one. */
  policy: InsuranceDto | null;
  isFirst: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const uid = useId();
  const save = useSaveInsurance(customerId);
  const [values, setValues] = useState<InsuranceInput>(
    policy
      ? {
          carrier: policy.carrier,
          memberId: policy.memberId ?? "",
          groupNumber: policy.groupNumber ?? "",
          subscriberName: policy.subscriberName ?? "",
          subscriberRelationship: policy.subscriberRelationship,
          isPrimary: policy.isPrimary,
          validTo: policy.validTo,
        }
      : { ...blank, isPrimary: isFirst },
  );
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof InsuranceInput>(key: K, value: InsuranceInput[K]) => setValues((v) => ({ ...v, [key]: value }));
  const id = (name: string) => `${uid}-${name}`;

  async function submit() {
    if (values.carrier.trim() === "") {
      setError(t("dental.insErrorCarrier"));
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        ...(policy && { id: policy.id, expectedVersion: policy.version }),
        values: { ...values, carrier: values.carrier.trim() },
      });
      toast.success(t("dental.insSaved"));
      onClose();
    } catch (e) {
      if (isApiError(e, "VERSION_CONFLICT")) toast.error(t("dental.insConflict"));
      else setError(issuesOf(e)[0]?.message ?? (e instanceof Error ? e.message : t("dental.insSaveFailed")));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{policy ? t("dental.insEditTitle") : t("dental.insNewTitle")}</DialogTitle>
          <DialogDescription>{t("dental.insDialogText")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField label={t("dental.insCarrier")} htmlFor={id("carrier")} required error={error}>
            <Input id={id("carrier")} value={values.carrier} maxLength={200} onChange={(e) => set("carrier", e.target.value)} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t("dental.insMemberId")} htmlFor={id("member")}>
              <Input id={id("member")} value={values.memberId ?? ""} maxLength={100} autoComplete="off" onChange={(e) => set("memberId", e.target.value)} />
            </FormField>
            <FormField label={t("dental.insGroup")} htmlFor={id("group")}>
              <Input id={id("group")} value={values.groupNumber ?? ""} maxLength={100} onChange={(e) => set("groupNumber", e.target.value)} />
            </FormField>
            <FormField label={t("dental.insSubscriber")} htmlFor={id("subscriber")}>
              <Input id={id("subscriber")} value={values.subscriberName ?? ""} maxLength={200} onChange={(e) => set("subscriberName", e.target.value)} />
            </FormField>
            <FormField label={t("dental.insRelationship")} htmlFor={id("relationship")}>
              <Select
                id={id("relationship")}
                value={values.subscriberRelationship}
                placeholder={t("dental.insRelationshipNone")}
                options={RELATIONSHIPS.map((r) => ({ value: r, label: t(`dental.rel_${r}`) }))}
                onChange={(value) => set("subscriberRelationship", value)}
              />
            </FormField>
            <FormField label={t("dental.insValidTo")} htmlFor={id("valid")}>
              <DatePicker id={id("valid")} value={values.validTo} onChange={(value) => set("validTo", value)} clearable />
            </FormField>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={id("primary")} checked={values.isPrimary} onCheckedChange={(c) => set("isPrimary", c === true)} />
            <Label htmlFor={id("primary")} className="font-normal">
              {t("dental.insPrimary")}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={save.isPending}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InsuranceSection({ customerId, canManage }: { customerId: string; canManage: boolean }) {
  const t = useT();
  const insurance = useInsurance(customerId);
  const remove = useDeleteInsurance(customerId);
  const [editing, setEditing] = useState<InsuranceDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<InsuranceDto | null>(null);
  const list = insurance.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{t("dental.insTitle")}</CardTitle>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("dental.insAdd")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-2">
        {insurance.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : insurance.isError ? (
          <div role="alert" className="grid justify-items-start gap-2">
            <p className="text-sm text-destructive">{insurance.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => void insurance.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dental.insEmpty")}</p>
        ) : (
          <ul className="grid gap-2">
            {list.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
                <div className="grid gap-0.5 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    {p.carrier}
                    {p.isPrimary ? <Badge variant="secondary">{t("dental.insPrimary")}</Badge> : null}
                  </p>
                  <p className="text-muted-foreground">
                    {[
                      p.memberId ? `${t("dental.insMemberId")}: ${p.memberId}` : null,
                      p.groupNumber ? `${t("dental.insGroup")}: ${p.groupNumber}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "-"}
                  </p>
                  <p className="text-muted-foreground">
                    {[
                      p.subscriberName
                        ? `${p.subscriberName}${p.subscriberRelationship ? ` (${t(`dental.rel_${p.subscriberRelationship}`)})` : ""}`
                        : null,
                      p.validTo ? `${t("dental.insValidTo")}: ${p.validTo}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`${t("common.edit")} ${p.carrier}`}>
                      <Pencil aria-hidden="true" />
                      {t("common.edit")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(p)} aria-label={`${t("common.delete")} ${p.carrier}`}>
                      <Trash2 aria-hidden="true" />
                      {t("common.delete")}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing ? (
        <InsuranceDialog customerId={customerId} policy={editing === "new" ? null : editing} isFirst={list.length === 0} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("dental.insDeleteTitle")}
        description={t("dental.insDeleteText", { carrier: deleting?.carrier ?? "" })}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t("dental.insDeleted"));
          } catch (e) {
            toast.error(e instanceof Error ? e.message : t("dental.insSaveFailed"));
            throw e;
          }
        }}
      />
    </Card>
  );
}
