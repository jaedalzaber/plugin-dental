import { describe, expect, it } from "vitest";
import { BOOKING_FORM } from "./data/forms";

// The form builder's own checks live in the web app's form model. The web app is typed under its own tsconfig, so the
// model is loaded by path here (it stays out of this plugin's type check) and typed by what this test uses of it.
const WEB_FORMS = "../../../booking-and-cms/apps/web/src/forms";
type Draft = Record<string, unknown>;
type FormServer = { parseDraft(raw: unknown): { draft: Draft; purpose: string }; assertPublishable(draft: Draft): void };
type FormCheck = { checkFlow(content: unknown, kind: string): { errs: number } };

describe("the dental starter pack's forms", () => {
  it("the booking form is a valid, publishable booking form with service, time, contact and payment", async () => {
    const { parseDraft, assertPublishable } = (await import(/* @vite-ignore */ `${WEB_FORMS}/server`)) as FormServer;
    const { checkFlow } = (await import(/* @vite-ignore */ `${WEB_FORMS}/model/check`)) as FormCheck;
    const { draft, purpose } = parseDraft(BOOKING_FORM.content);
    expect(purpose).toBe("booking");
    expect(() => assertPublishable(draft)).not.toThrow();
    expect(checkFlow(draft, "booking").errs).toBe(0);
    const types = (draft as { fields: { type: string }[] }).fields.map((f) => f.type);
    for (const type of ["service", "slot", "name", "email", "phone", "payment"]) expect(types, type).toContain(type);
  }, 30_000); // loads the web app's form model on first use, slow when the whole suite runs in parallel
});
