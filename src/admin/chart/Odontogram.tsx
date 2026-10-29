
import { useRef, useState, type KeyboardEvent } from "react";
import { useT } from "@appointit/i18n/react";
import { cn } from "@appointit/ui";
import { formatTooth } from "../../server/chart/model";
import type { ChartEntryDto, Dentition, ToothNumbering } from "../../server/chart/model";
import { isMissing, surfaceMarks, toothLabel } from "./chart-view";
import { ToothGlyph } from "./ToothGlyph";

// Teeth in the order the dentist sees them across the patient: upper right ... upper left, lower right ... lower left.
const ROWS: Record<Dentition, { upper: string[]; lower: string[]; half: number }> = {
  adult: {
    upper: ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"],
    lower: ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"],
    half: 8,
  },
  child: {
    upper: ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"],
    lower: ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"],
    half: 5,
  },
};

/** The two arches as rows of tooth buttons with five-surface glyphs. Arrow keys move between teeth; Enter or Space selects. */
export function Odontogram({
  dentition,
  numbering,
  entriesByTooth,
  selected,
  onSelect,
}: {
  dentition: Dentition;
  numbering: ToothNumbering;
  entriesByTooth: Map<string, ChartEntryDto[]>;
  selected: string | null;
  onSelect: (tooth: string) => void;
}) {
  const t = useT();
  const { upper, lower, half } = ROWS[dentition];
  const order = [...upper, ...lower];
  const [focused, setFocused] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Exactly one tooth is in the tab order: the selected one, else the last focused, else the first.
  const tabbable = [selected, focused].find((tooth) => tooth !== null && order.includes(tooth)) ?? order[0];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = (event.target as HTMLElement).closest<HTMLElement>("[data-tooth]")?.dataset.tooth;
    if (!current) return;
    const row = upper.includes(current) ? upper : lower;
    const other = row === upper ? lower : upper;
    const index = row.indexOf(current);
    let next: string | undefined;
    switch (event.key) {
      case "ArrowRight":
        next = row[Math.min(index + 1, row.length - 1)];
        break;
      case "ArrowLeft":
        next = row[Math.max(index - 1, 0)];
        break;
      case "ArrowUp":
      case "ArrowDown":
        if ((event.key === "ArrowUp") === (row === lower)) next = other[index];
        break;
      case "Home":
        next = row[0];
        break;
      case "End":
        next = row[row.length - 1];
        break;
    }
    if (!next || next === current) return;
    event.preventDefault();
    root.current?.querySelector<HTMLElement>(`[data-tooth="${next}"]`)?.focus();
  }

  function renderRow(teeth: string[], isUpperRow: boolean) {
    return (
      <div className="flex items-stretch justify-center gap-0.5 sm:gap-1">
        {teeth.map((tooth, index) => {
          const entries = entriesByTooth.get(tooth) ?? [];
          const shown = formatTooth(tooth, numbering);
          const label = <span className="text-[11px] leading-none font-medium text-muted-foreground tabular-nums">{shown}</span>;
          return (
            <div key={tooth} className={cn("flex", index === half && "ml-2 border-l pl-2 sm:ml-3 sm:pl-3")}>
              <button
                type="button"
                data-tooth={tooth}
                aria-label={toothLabel(tooth, shown, entries, t)}
                aria-pressed={selected === tooth}
                tabIndex={tabbable === tooth ? 0 : -1}
                onClick={() => onSelect(tooth)}
                onFocus={() => setFocused(tooth)}
                className={cn(
                  "flex w-9 cursor-pointer flex-col items-center gap-1 rounded-md px-0.5 py-1 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:w-11",
                  selected === tooth && "bg-accent ring-2 ring-ring",
                )}
              >
                {isUpperRow ? label : null}
                <ToothGlyph tooth={tooth} marks={surfaceMarks(entries)} missing={isMissing(entries)} />
                {isUpperRow ? null : label}
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={root} onKeyDown={onKeyDown} className="overflow-x-auto rounded-xl border bg-card p-3 sm:p-4">
      <div className="mx-auto grid w-fit gap-3">
        <div className="flex justify-between px-1 text-xs text-muted-foreground">
          <span>{t("dental.chartPatientRight")}</span>
          <span>{t("dental.chartPatientLeft")}</span>
        </div>
        {renderRow(upper, true)}
        <div role="presentation" className="border-t border-dashed" />
        {renderRow(lower, false)}
      </div>
    </div>
  );
}
