// A drawing pad for the patient's signature. It reports the picture (PNG on white) and the pen strokes (points 0..1).

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Button } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";

export interface SignatureValue {
  dataUrl: string;
  strokes: number[][][];
}

export interface SignaturePadHandle {
  /** The drawing, or null when nothing was drawn. */
  read: () => SignatureValue | null;
}

export function SignaturePad({ handleRef, onInk }: { handleRef: Ref<SignaturePadHandle>; onInk?: (hasInk: boolean) => void }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<number[][][]>([]);
  const drawing = useRef(false);
  const [ink, setInk] = useState(false);

  // Size the drawing surface to its box so lines stay sharp on dense screens.
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(c.clientWidth * ratio));
    c.height = Math.max(1, Math.round(c.clientHeight * ratio));
    g.scale(ratio, ratio);
    g.lineWidth = 2.4;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#17211c";
  }, []);

  useImperativeHandle(handleRef, () => ({
    read: () => {
      const c = canvas.current;
      if (!c || strokes.current.length === 0) return null;
      const out = document.createElement("canvas");
      out.width = c.width;
      out.height = c.height;
      const g = out.getContext("2d");
      if (!g) return null;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, out.width, out.height);
      g.drawImage(c, 0, 0);
      return { dataUrl: out.toDataURL("image/png"), strokes: strokes.current };
    },
  }));

  function point(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = canvas.current?.getContext("2d");
    if (!g) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const [x, y] = point(e);
    const r = e.currentTarget.getBoundingClientRect();
    g.beginPath();
    g.moveTo(x * r.width, y * r.height);
    strokes.current.push([[round(x), round(y)]]);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const g = canvas.current?.getContext("2d");
    const stroke = strokes.current[strokes.current.length - 1];
    if (!g || !stroke || stroke.length >= 1500) return;
    const [x, y] = point(e);
    const r = e.currentTarget.getBoundingClientRect();
    g.lineTo(x * r.width, y * r.height);
    g.stroke();
    stroke.push([round(x), round(y)]);
    if (!ink) {
      setInk(true);
      onInk?.(true);
    }
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.restore();
    strokes.current = [];
    setInk(false);
    onInk?.(false);
  }

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvas}
        role="img"
        aria-label={t("dental.planSignPad")}
        className="h-40 w-full touch-none rounded-md border border-input bg-background"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">{t("dental.planSignHint")}</span>
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!ink}>
          {t("dental.planSignClear")}
        </Button>
      </div>
    </div>
  );
}

const round = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
