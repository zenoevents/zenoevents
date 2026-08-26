"use client";

import { useRef, useState } from "react";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Two explicit cards — "Take Photo" (camera only, capture="environment")
 * and "Upload" (gallery/file picker, no capture attribute) — rather than
 * one ambiguous file input. Staff at the venue want the camera; staff
 * filing a report from a photo already on their phone want the gallery.
 * Forcing camera-only on a single input would block the second case.
 */
export function PhotoCapture({
  onChange,
  required,
}: {
  onChange: (photo: { base64: string; mimeType: string; previewUrl: string } | null) => void;
  required?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    const base64 = await fileToBase64(file);
    setPreview(previewUrl);
    onChange({ base64, mimeType: file.type, previewUrl });
  }

  function clear() {
    setPreview(null);
    onChange(null);
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  }

  return (
    <div>
      <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
        Photo {required && <span className="font-normal text-[var(--color-bad)]">— required</span>}
      </span>

      {preview ? (
        <div className="mt-1.5 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Photo preview" className="h-16 w-16 rounded-lg object-cover border border-[var(--color-ink-200)]" />
          <button type="button" onClick={clear} className="text-[12px] text-[var(--color-bad)] hover:underline">Remove</button>
        </div>
      ) : (
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-ink-200)] bg-white hover:bg-[var(--color-ink-50)] py-3 transition-colors"
          >
            <span className="text-[20px]">📷</span>
            <span className="text-[12px] font-medium text-[var(--color-ink-700)]">Take Photo</span>
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-ink-200)] bg-white hover:bg-[var(--color-ink-50)] py-3 transition-colors"
          >
            <span className="text-[20px]">🖼️</span>
            <span className="text-[12px] font-medium text-[var(--color-ink-700)]">Upload</span>
          </button>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      <input ref={galleryRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}
