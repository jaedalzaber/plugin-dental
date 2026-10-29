import { describe, expect, it } from "vitest";
import { mapIntakeAnswers, mergeImported } from "./intake-mapping";
import { computeAlerts, emptyHistory } from "./schema";

describe("mapIntakeAnswers", () => {
  it("maps allergy text and yes/no allergy questions", () => {
    const r = mapIntakeAnswers(
      [
        { id: "a", type: "long", label: "Any allergies?" },
        { id: "b", type: "yesno", label: "Are you allergic to latex?" },
        { id: "c", type: "yesno", label: "Allergic to penicillin?" },
      ],
      { a: "Ibuprofen, shellfish", b: "Yes", c: "No" },
    );
    expect(r.document.allergies.nsaids).toBe(true);
    expect(r.document.allergies.latex).toBe(true);
    expect(r.document.allergies.penicillin).toBe(false);
    expect(r.document.allergies.other).toBe("shellfish");
  });

  it("maps condition flags, choice lists, pregnancy weeks and sends the rest to notes", () => {
    const r = mapIntakeAnswers(
      [
        { id: "c1", type: "check", label: "Do you suffer from any of these conditions?" },
        { id: "p1", type: "short", label: "If pregnant, how many weeks?" },
        { id: "s1", type: "yesno", label: "Do you smoke?" },
        { id: "t1", type: "consent", label: "I agree" },
        { id: "x1", type: "short", label: "Dentist phobia level" },
      ],
      { c1: ["Heart disease", "Asthma", "Gout"], p1: "12 weeks", s1: "No, never", t1: true, x1: "high" },
    );
    expect(r.document.conditions.heartDisease).toBe(true);
    expect(r.document.conditions.asthma).toBe(true);
    expect(r.document.conditions.other).toBe("Gout");
    expect(r.document.pregnancy).toEqual({ pregnant: true, weeks: 12 });
    expect(r.document.smoker).toBe(false);
    expect(r.document.notes).toBe("Intake - Dentist phobia level: high");
    expect(r.unmapped).toBe(1);
  });

  it("only adds when merging: a No never clears known data", () => {
    const known = emptyHistory();
    known.conditions.diabetes = true;
    known.medications = ["Metformin"];
    const imported = mapIntakeAnswers([{ id: "d", type: "yesno", label: "Diabetes?" }, { id: "m", type: "long", label: "Medication" }], { d: "No", m: "metformin; Aspirin" });
    const merged = mergeImported(known, imported.document);
    expect(merged.conditions.diabetes).toBe(true);
    expect(merged.medications).toEqual(["Metformin", "Aspirin"]);
  });
});

describe("computeAlerts", () => {
  it("lists allergies, drugs, bleeding, heart, pregnancy and manual alerts in a stable order", () => {
    const d = emptyHistory();
    d.allergies.latex = true;
    d.bisphosphonates = true;
    d.conditions.heartDisease = true;
    d.pregnancy = { pregnant: true, weeks: 20 };
    d.manualAlerts = ["Fainting history"];
    d.conditions.diabetes = true; // not an alert
    expect(computeAlerts(d).map((a) => a.label)).toEqual([
      "Allergy: latex",
      "Takes bisphosphonates",
      "Heart condition",
      "Pregnant (20 weeks)",
      "Fainting history",
    ]);
  });
});
