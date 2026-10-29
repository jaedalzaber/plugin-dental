// Types of the dental setup pack. The data lives in ./data/*.ts; ./apply.ts builds a clinic from it.

/** The parts of the pack, in the order they are applied. */
export const SETUP_PARTS = ["vocabulary", "resourceTypes", "services", "procedures", "recall", "forms", "pages"] as const;
export type SetupPart = (typeof SETUP_PARTS)[number];

export type PackResourceType = {
  /** Stable key: an existing type with this key is never touched. */
  key: string;
  name: string;
  kind: "person" | "space" | "equipment" | "other";
};

export type PackNeed = {
  /** Name of the need inside the service (the booking panel and the solver use it). */
  key: string;
  /** Resource type key the need selects from. */
  typeKey: string;
  /** Minutes after the visit starts when the resource is needed (a "segment"). */
  offsetMin?: number;
  /** Minutes the resource is needed; left out = to the end of the visit. */
  lengthMin?: number;
  /** Minutes kept free after the visit (cleanup). */
  bufferAfterMin?: number;
  pick?: "auto" | "customer" | "later";
};

export type PackService = {
  /** Stable key: a service with this slug (or this name) is never created twice. */
  slug: string;
  name: string;
  category: string;
  description: string;
  durationMin: number;
  startStepMin: number;
  /** Sample price in minor units of the business currency; the owner changes it. */
  priceMinor: number;
  priceType: "fixed" | "from";
  needs: PackNeed[];
  policy?: { noticeMin?: number };
  /** Slug of the pack form the patient fills in before this service (uses the consent-per-service mapping). */
  form?: string;
};

export type PackProcedure = {
  /** Clinic-own code, never from a licensed list; null = none. */
  code: string | null;
  name: string;
  category: string;
  priceMinor: number;
  /** Slug of the pack service this procedure is booked as. */
  service: string;
};

export type PackRecallRule = {
  name: string;
  /** Slug of the pack service. */
  service: string;
  intervalMonths: number;
  leadDays: number;
};

export type PackFormField = {
  id: string;
  type: string;
  label: string;
  ph: string;
  help: string;
  req: boolean;
  w: "full" | "half";
  step: string;
  opts?: string[];
  role?: string;
  html?: string;
  /** Choice blocks (the service picker): how options are drawn, whether several can be picked, the ?service= prefill key. */
  disp?: string;
  multi?: boolean;
  prefill?: string;
  /** Time slot block: minutes the chosen time is held while the patient finishes. */
  hold?: number;
  /** Payment block: the deposit shown to the patient (the amount due comes from the service and Settings › Payments). */
  pay?: { mode: string; amountType: string; amount: number; refundHours: number };
  /** Consent block: which policy links it shows ("" = none). */
  policy?: string;
};

export type PackForm = {
  /** Stable key. */
  slug: string;
  name: string;
  /** The core purpose of the form (intake forms feed the medical history import; a booking form is the online booking page). */
  purpose: "booking" | "intake" | "consent";
  /** The document stored as the form draft (the shape the form builder edits). */
  content: Record<string, unknown>;
};

export type PackNode = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  style: { base: Record<string, string>; mobile?: Record<string, string> };
  children?: PackNode[];
};

export type PackPage = {
  /** Stable key. */
  slug: string;
  title: string;
  seo: { title: string; desc: string };
  nodes: PackNode[];
  /** Becomes the home page when the site has none. */
  home?: boolean;
};

export type SetupResult = {
  created: Record<SetupPart, number>;
  skipped: Record<SetupPart, number>;
  /** Things the setup could not finish (for example a service left as a draft until the team exists). */
  warnings: string[];
};

export type SetupStatus = {
  parts: { part: SetupPart; total: number; present: number }[];
};
