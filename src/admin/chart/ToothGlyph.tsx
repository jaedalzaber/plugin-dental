import { isPatientRight, isUpper, SURFACE_SLOTS } from "../../server/chart/model";
import type { SurfaceSlot } from "../../server/chart/model";
import { cn } from "@appointit/ui";
import { KIND_FILL, type SurfaceMark } from "./chart-view";

type Side = "top" | "bottom" | "left" | "right" | "center";

const POINTS: Record<Side, string> = {
  top: "3,3 37,3 27,13 13,13",
  bottom: "3,37 37,37 27,27 13,27",
  left: "3,3 13,13 13,27 3,37",
  right: "37,3 27,13 27,27 37,37",
  center: "13,13 27,13 27,27 13,27",
};

/**
 * Where each face of this tooth sits in the glyph, seen from the front of the patient: the cheek side (buccal or
 * facial) faces away from the tongue, and the mesial side faces the midline of the mouth.
 */
function sideOf(tooth: string, slot: SurfaceSlot): Side {
  const upper = isUpper(tooth);
  const towardMidline = isPatientRight(tooth) ? "right" : "left";
  const awayFromMidline = towardMidline === "right" ? "left" : "right";
  switch (slot) {
    case "occlusal":
      return "center";
    case "buccal":
      return upper ? "top" : "bottom";
    case "lingual":
      return upper ? "bottom" : "top";
    case "mesial":
      return towardMidline;
    default:
      return awayFromMidline;
  }
}

/** The five-surface glyph of one tooth. Decorative: the button around it carries the name. */
export function ToothGlyph({ tooth, marks, missing, className }: { tooth: string; marks: Map<SurfaceSlot, SurfaceMark>; missing: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false" className={cn("size-9 sm:size-10", className)}>
      {SURFACE_SLOTS.map((slot) => {
        const mark = marks.get(slot);
        return (
          <polygon
            key={slot}
            points={POINTS[sideOf(tooth, slot)]}
            strokeWidth={1.25}
            strokeLinejoin="round"
            className={cn("stroke-foreground/45", mark ? KIND_FILL[mark.kind] : "fill-card")}
            fillOpacity={mark ? (mark.whole ? 0.4 : 0.9) : 1}
          />
        );
      })}
      {missing ? (
        <g className="stroke-destructive" strokeWidth={2.5} strokeLinecap="round">
          <line x1={5} y1={5} x2={35} y2={35} />
          <line x1={35} y1={5} x2={5} y2={35} />
        </g>
      ) : null}
    </svg>
  );
}
