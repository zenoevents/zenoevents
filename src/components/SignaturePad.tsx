"use client";

import { useRef, useState, useEffect } from "react";

/**
 * A real draw-with-finger/mouse signature pad — canvas + pointer events,
 * no library (this app takes no new dependencies). Exports the drawn mark
 * as a PNG data URL, same {base64, mimeType} shape PhotoCapture already
 * uses, so both flow into the same upload path as the wet-ink photo.
 */
export function SignaturePad({
  onChange,
  height = 160,
}: {
  onChange: (signature: { base64: string; mimeType: string } | null) => void;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const hasStrokes = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ratio = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.25;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1d1d1f";
    }
  }, [height]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasStrokes.current = true;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    if (!hasStrokes.current) return;
    setEmpty(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onChange({ base64: dataUrl.split(",")[1] || "", mimeType: "image/png" });
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes.current = false;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative rounded-lg border border-[var(--color-ink-200)] bg-white overflow-hidden"
        style={{ height, touchAction: "none" }}
      >
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-[var(--color-ink-300)]">
            Sign here
          </span>
        )}
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="absolute inset-0 w-full h-full cursor-crosshair"
        />
      </div>
      <div className="flex justify-end mt-1">
        <button type="button" onClick={clear} className="text-[11.5px] text-[var(--color-ink-400)] hover:text-[var(--color-ink-600)] hover:underline">
          Clear
        </button>
      </div>
    </div>
  );
}
