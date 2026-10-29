// Maps the answers of an intake form submission onto a medical history document.
//
// MAPPING RULES (heuristics on the question label, and the field key when it is a plain word)
// 1. Fields that carry no health answer are skipped: heading, divider, consent, signature, name, email,
//    phone, address, verify, payment, summary, total, hidden, photo, picture, slot, service, coupon.
// 2. A field whose label mentions "allerg" feeds allergies. Allergen words in the label (for a yes/no
//    question like "Allergic to penicillin?") or in the answer text/choices decide which allergy is set:
//    penicillin, latex, local anaesthetic (anaesthetic, numbing, lidocaine), NSAIDs (nsaid, ibuprofen,
//    aspirin). Anything else goes to allergies.other. "No", "none", "n/a" set nothing.
// 3. Otherwise the label is matched against the condition table: heart, high blood pressure, low blood
//    pressure, diabetes, asthma, epilepsy/seizures, bleeding disorder/haemophilia, hepatitis, HIV,
//    kidney, liver, cancer/radiotherapy, pregnancy, smoker, blood thinners/anticoagulants,
//    bisphosphonates. A yes/no (or text) answer sets that flag when it means yes.
// 4. Choice fields (check / multi) about conditions, illnesses or health: each chosen option is matched
//    against the same condition table; options that match nothing are joined into conditions.other.
// 5. A label about medication/tablets/drugs fills the medications list (split on commas, semicolons,
//    "and" and new lines). A label about previous dental problems/history fills previousDentalIssues.
// 6. Pregnancy: a number found in the answer or in "how many weeks" answers sets pregnancy.weeks.
// 7. Every other non-empty answer is not lost: it is added to notes as "Intake - <question>: <answer>".
// An explicit "no" never clears something already known (the import only adds), see mergeImported().

import { ALLERGY_KEYS, CONDITION_KEYS, emptyHistory, type AllergyKey, type ConditionKey, type HistoryDocument } from "./schema";

export type IntakeField = { id: string; type?: string; label?: string; opts?: string[] };

const SKIP_TYPES = new Set([
  "heading",
  "divider",
  "consent",
  "signature",
  "name",
  "email",
  "phone",
  "address",
  "verify",
  "payment",
  "summary",
  "total",
  "hidden",
  "photo",
  "picture",
  "slot",
  "service",
  "coupon",
  "estimate",
  "addons",
  "map",
]);

type Flag = ConditionKey | "pregnant" | "smoker" | "anticoagulants" | "bisphosphonates";

const FLAG_PATTERNS: [Flag, RegExp][] = [
  ["heartDisease", /\bheart|cardiac|angina|pacemaker/],
  ["highBloodPressure", /high blood pressure|hypertens/],
  ["lowBloodPressure", /low blood pressure|hypotens/],
  ["diabetes", /diabet/],
  ["asthma", /asthma/],
  ["epilepsy", /epilep|seizure|fits\b/],
  ["bleedingDisorder", /bleed|h(a)?emophil|clotting/],
  ["hepatitis", /hepatitis/],
  ["hiv", /\bhiv\b|\baids\b/],
  ["kidneyDisease", /kidney|renal/],
  ["liverDisease", /liver/],
  ["cancerRadiotherapy", /cancer|radiotherap|chemo|tumou?r/],
  ["pregnant", /pregnan/],
  ["smoker", /smok|tobacco|cigarette|vap(e|ing)/],
  ["anticoagulants", /blood thinner|anticoag|warfarin|clopidogrel|apixaban|rivaroxaban|heparin/],
  ["bisphosphonates", /bisphosphonate|alendron|zoledron|risedron|ibandron|fosamax/],
];

const ALLERGEN_PATTERNS: [AllergyKey, RegExp][] = [
  ["penicillin", /penicillin|amoxicillin/],
  ["latex", /latex|rubber/],
  ["localAnaesthetic", /an(a)?esthe|numbing|lidocaine|lignocaine|novocain/],
  ["nsaids", /nsaid|ibuprofen|aspirin|diclofenac|naproxen/],
];

const NEGATIVE = /^(no|none|nil|n\/a|na|not applicable|nope|false|never|-+)(?![a-z0-9])/i;
const POSITIVE = /^(yes|y|true|yep|yeah|1)\b/i;

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9/&+\-\s]/g, " ").replace(/\s+/g, " ").trim();
}

function answerParts(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(answerParts);
  if (typeof value === "boolean") return [value ? "Yes" : "No"];
  if (typeof value === "number") return [String(value)];
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? [] : [t];
  }
  return []; // objects (files, signatures ...) are never imported
}

function isNegative(parts: string[]): boolean {
  return parts.length > 0 && parts.every((p) => NEGATIVE.test(p.trim()));
}

function meansYes(parts: string[]): boolean {
  if (parts.length === 0 || isNegative(parts)) return false;
  return parts.some((p) => POSITIVE.test(p.trim())) || parts.some((p) => p.trim().length > 0 && !NEGATIVE.test(p.trim()));
}

function isYesNoAnswer(parts: string[]): boolean {
  return parts.length === 1 && (POSITIVE.test(parts[0]!.trim()) || NEGATIVE.test(parts[0]!.trim()));
}

function splitList(parts: string[]): string[] {
  return parts
    .flatMap((p) => p.split(/[\n,;]+|\band\b/i))
    .map((p) => p.trim())
    .filter((p) => p !== "" && !NEGATIVE.test(p));
}

export type IntakeImport = {
  /** The imported values as a document (merge it with mergeImported). */
  document: HistoryDocument;
  /** Names of the document sections that received data (no values). */
  mappedSections: string[];
  /** How many answers went to notes because nothing matched. */
  unmapped: number;
};

function setFlag(doc: HistoryDocument, flag: Flag): void {
  if (flag === "pregnant") doc.pregnancy.pregnant = true;
  else if (flag === "smoker") doc.smoker = true;
  else if (flag === "anticoagulants") doc.anticoagulants = true;
  else if (flag === "bisphosphonates") doc.bisphosphonates = true;
  else doc.conditions[flag] = true;
}

function addOther(current: string, extra: string): string {
  const e = extra.trim();
  if (!e) return current;
  if (current.toLowerCase().includes(e.toLowerCase())) return current;
  return current ? `${current}; ${e}` : e;
}

export function mapIntakeAnswers(fields: readonly IntakeField[], answers: Record<string, unknown>): IntakeImport {
  const doc = emptyHistory();
  const mapped = new Set<string>();
  const noteLines: string[] = [];

  for (const field of fields) {
    if (field.type && SKIP_TYPES.has(field.type)) continue;
    const parts = answerParts(answers[field.id]);
    if (parts.length === 0) continue;

    const label = (field.label ?? "").trim();
    const key = /^[A-Za-z_]+$/.test(field.id) ? field.id.replace(/_/g, " ") : "";
    const q = normalise(`${label} ${key}`);
    const joined = parts.join(", ");

    // Rule 2: allergies.
    if (/allerg/.test(q)) {
      if (isNegative(parts)) continue;
      const fromLabel = ALLERGEN_PATTERNS.filter(([, re]) => re.test(q));
      if (isYesNoAnswer(parts) && fromLabel.length > 0) {
        if (meansYes(parts)) {
          for (const [k] of fromLabel) doc.allergies[k] = true;
          mapped.add("allergies");
        }
        continue;
      }
      const leftovers: string[] = [];
      let touched = false;
      for (const item of splitList(parts)) {
        const hit = ALLERGEN_PATTERNS.find(([, re]) => re.test(normalise(item)));
        if (hit) {
          doc.allergies[hit[0]] = true;
          touched = true;
        } else if (!isYesNoAnswer([item])) leftovers.push(item);
      }
      if (leftovers.length > 0) {
        doc.allergies.other = addOther(doc.allergies.other, leftovers.join(", "));
        touched = true;
      }
      if (touched) mapped.add("allergies");
      continue;
    }

    // Rule 5: medications and previous dental issues.
    if (/medic|tablet|drug|prescription/.test(q) && !FLAG_PATTERNS.some(([, re]) => re.test(q))) {
      if (isNegative(parts)) continue;
      if (isYesNoAnswer(parts)) continue; // "Do you take medication? Yes" carries no names
      for (const m of splitList(parts)) if (!doc.medications.some((x) => x.toLowerCase() === m.toLowerCase())) doc.medications.push(m);
      mapped.add("medications");
      continue;
    }
    if (/(previous|past|prior|history).*(dental|tooth|teeth)|dental (history|problem|issue|treatment)/.test(q)) {
      if (isNegative(parts)) continue;
      doc.previousDentalIssues = addOther(doc.previousDentalIssues, joined);
      mapped.add("previousDentalIssues");
      continue;
    }

    // Rule 6: pregnancy weeks.
    if (/pregnan/.test(q) && /week/.test(`${q} ${normalise(joined)}`)) {
      const n = /(\d{1,2})/.exec(joined);
      if (n) {
        const weeks = Number(n[1]);
        if (weeks > 0 && weeks <= 45) {
          doc.pregnancy.pregnant = true;
          doc.pregnancy.weeks = weeks;
          mapped.add("pregnancy");
          continue;
        }
      }
    }

    // Rule 4: choice fields listing conditions.
    const isChoice = field.type === "check" || Array.isArray(answers[field.id]);
    if (isChoice && /condition|illness|disease|suffer|medical|health|problem/.test(q)) {
      const unknown: string[] = [];
      for (const item of parts) {
        const nq = normalise(item);
        const hit = FLAG_PATTERNS.find(([, re]) => re.test(nq));
        if (hit) {
          setFlag(doc, hit[0]);
          mapped.add(hit[0] === "pregnant" ? "pregnancy" : hit[0] === "smoker" || hit[0] === "anticoagulants" || hit[0] === "bisphosphonates" ? hit[0] : "conditions");
        } else if (!NEGATIVE.test(item.trim())) {
          unknown.push(item);
        }
      }
      if (unknown.length > 0) {
        doc.conditions.other = addOther(doc.conditions.other, unknown.join(", "));
        mapped.add("conditions");
      }
      continue;
    }

    // Rule 3: single-question flags.
    const hit = FLAG_PATTERNS.find(([, re]) => re.test(q));
    if (hit) {
      if (meansYes(parts)) {
        setFlag(doc, hit[0]);
        mapped.add(hit[0] === "pregnant" ? "pregnancy" : hit[0] === "smoker" || hit[0] === "anticoagulants" || hit[0] === "bisphosphonates" ? hit[0] : "conditions");
        // A longer text answer (not just yes) keeps its detail in notes too.
        if (!isYesNoAnswer(parts) && parts.join(" ").length > 3) noteLines.push(`Intake - ${label || field.id}: ${joined}`);
      }
      continue;
    }

    // Rule 7: nothing matched.
    if (!isNegative(parts)) noteLines.push(`Intake - ${label || field.id}: ${joined}`);
  }

  if (noteLines.length > 0) {
    doc.notes = noteLines.join("\n").slice(0, 8000);
    mapped.add("notes");
  }
  const unmapped = noteLines.length;
  return { document: doc, mappedSections: [...mapped].sort(), unmapped };
}

function union(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const item of b) if (!out.some((x) => x.toLowerCase() === item.toLowerCase())) out.push(item);
  return out;
}

function appendBlock(current: string, extra: string, max: number): string {
  const e = extra.trim();
  if (!e) return current;
  const lines = current.split("\n");
  const fresh = e.split("\n").filter((l) => !lines.includes(l));
  if (fresh.length === 0) return current;
  return (current ? `${current}\n${fresh.join("\n")}` : fresh.join("\n")).slice(0, max);
}

/** Adds the imported answers to what is already known: flags only turn on, lists and text are appended. */
export function mergeImported(existing: HistoryDocument, imported: HistoryDocument): HistoryDocument {
  const out: HistoryDocument = structuredClone(existing);
  for (const k of CONDITION_KEYS) if (imported.conditions[k]) out.conditions[k] = true;
  out.conditions.other = addOther(out.conditions.other, imported.conditions.other);
  for (const k of ALLERGY_KEYS) if (imported.allergies[k]) out.allergies[k] = true;
  out.allergies.other = addOther(out.allergies.other, imported.allergies.other);
  out.medications = union(out.medications, imported.medications).slice(0, 100);
  if (imported.pregnancy.pregnant) out.pregnancy.pregnant = true;
  if (imported.pregnancy.weeks !== null) out.pregnancy.weeks = imported.pregnancy.weeks;
  if (imported.smoker) out.smoker = true;
  if (imported.anticoagulants) out.anticoagulants = true;
  if (imported.bisphosphonates) out.bisphosphonates = true;
  out.previousDentalIssues = addOther(out.previousDentalIssues, imported.previousDentalIssues).slice(0, 4000);
  out.notes = appendBlock(out.notes, imported.notes, 8000);
  return out;
}
