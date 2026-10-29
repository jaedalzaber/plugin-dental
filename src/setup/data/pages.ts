import type { PackNode, PackPage } from "../types";
import { INTAKE_FORM_SLUG } from "./forms";

// Two website pages built only from block types the page builder already has (section, heading, text, button,
// row, columns, cell, list, services). Ids are fixed so the pack is the same every time.

type Style = Record<string, string>;

function builder(prefix: string) {
  let n = 0;
  const id = () => `${prefix}${++n}`;
  const N = (type: string, props: Record<string, unknown> = {}, base: Style = {}, children?: PackNode[], mobile?: Style): PackNode => ({
    id: id(),
    type,
    props,
    style: { base, ...(mobile ? { mobile } : {}) },
    ...(children ? { children } : {}),
  });
  const heading = (tag: string, text: string, base: Style = {}) => N("heading", { text, tag }, base);
  const text = (html: string, base: Style = {}) => N("text", { html }, base);
  const button = (label: string, o: { action?: "link" | "booking"; link?: string; variant?: "primary" | "outline" } = {}) =>
    N("button", { text: label, action: o.action ?? "link", link: o.link ?? "", variant: o.variant ?? "primary", size: "md" });
  const row = (kids: PackNode[], base: Style = {}) => N("row", {}, base, kids);
  const cell = (kids: PackNode[]) => N("cell", {}, {}, kids);
  const columns = (kids: PackNode[], base: Style = {}) => N("columns", {}, { cols: String(kids.length), gap: "48px", ...base }, kids, { cols: "1" });
  const section = (name: string, kids: PackNode[], base: Style = {}, mobile?: Style): PackNode => ({
    id: id(),
    type: "section",
    props: { name, anchor: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") },
    style: { base, ...(mobile ? { mobile } : {}) },
    children: kids,
  });
  return { N, heading, text, button, row, cell, columns, section };
}

const HOURS = "Monday to Friday 9:00 to 17:00\nSaturday 9:00 to 13:00\nSunday closed";

function homePage(): PackPage {
  const b = builder("dh");
  return {
    slug: "home",
    title: "Home",
    home: true,
    seo: { title: "Dental care for the whole family", desc: "Check-ups, cleaning, fillings and more. Book your visit online." },
    nodes: [
      b.section(
        "Hero",
        [
          b.heading("h1", "Gentle dental care for the whole family", { align: "center" }),
          b.text("<p>Check-ups, cleaning, fillings and more. Book your visit online in a minute.</p>", { align: "center", color: "muted", fs: "L" }),
          b.row([b.button("Book an appointment", { action: "booking" }), b.button("New patients", { link: "/new-patients", variant: "outline" })], { justify: "center" }),
        ],
        { pad: "112px 24px", align: "center" },
        { pad: "64px 16px" },
      ),
      b.section("Services", [
        b.heading("h2", "Our services", { align: "center" }),
        b.text("<p>What we can do for you.</p>", { align: "center", color: "muted" }),
        b.N("services", { count: "6", card: "bordered" }),
      ]),
      b.section(
        "Book a visit",
        [
          b.heading("h2", "Ready for your next visit?", { align: "center" }),
          b.text("<p>Pick a time that suits you. We confirm by message.</p>", { align: "center" }),
          b.row([b.button("Book an appointment", { action: "booking", variant: "outline" })], { justify: "center" }),
        ],
        { bg: "brand", align: "center" },
      ),
      contactSection(b),
    ],
  };
}

function newPatientsPage(): PackPage {
  const b = builder("dn");
  return {
    slug: "new-patients",
    title: "New patients",
    seo: { title: "New patients", desc: "What to expect at your first visit and how to book it." },
    nodes: [
      b.section(
        "Hero",
        [
          b.heading("h1", "New patients are welcome", { align: "center" }),
          b.text("<p>Here is how your first visit works.</p>", { align: "center", color: "muted", fs: "L" }),
          b.row([b.button("Book your first visit", { action: "booking" })], { justify: "center" }),
        ],
        { pad: "112px 24px", align: "center" },
        { pad: "64px 16px" },
      ),
      b.section("Your first visit", [
        b.heading("h2", "Your first visit"),
        b.N("list", {
          items: [
            "Fill in the short new patient form online before you come",
            "Arrive a few minutes early and bring your ID and insurance card if you have one",
            "Meet your dentist and tell us what you would like",
            "Leave with a clear plan and price before any treatment starts",
          ].join("\n"),
        }),
        b.row([b.button("Fill in the new patient form", { link: `/f/${INTAKE_FORM_SLUG}`, variant: "outline" })]),
      ]),
      b.section("Services", [
        b.heading("h2", "Our services", { align: "center" }),
        b.N("services", { count: "6", card: "bordered" }),
      ]),
      b.section(
        "Book a visit",
        [
          b.heading("h2", "Book your first visit", { align: "center" }),
          b.row([b.button("Book an appointment", { action: "booking", variant: "outline" })], { justify: "center" }),
        ],
        { bg: "brand", align: "center" },
      ),
      contactSection(b),
    ],
  };
}

/** Opening hours beside the contact details. The address and phone are the clinic's to fill in. */
function contactSection(b: ReturnType<typeof builder>): PackNode {
  return b.section("Contact", [
    b.columns([
      b.cell([b.heading("h2", "Opening hours"), b.N("list", { items: HOURS })]),
      b.cell([
        b.heading("h2", "Find us"),
        b.text("<p>Your clinic address<br>Your city</p>", { color: "muted" }),
        b.button("Call us", { link: "tel:", variant: "outline" }),
      ]),
    ]),
  ]);
}

export const PAGES_PACK: PackPage[] = [homePage(), newPatientsPage()];
