"use client";

import { useCallback, useRef, useState } from "react";

export type Attachment = {
  id: string;
  url: string; // data URL (base64)
  mediaType: string;
  name: string;
};

// FileUIPart zgodny z AI SDK — trafia do sendMessage({ files }).
export type FilePart = {
  type: "file";
  mediaType: string;
  url: string;
  filename?: string;
};

const ACCEPTED = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
];
const MAX_BYTES = 4 * 1024 * 1024; // 4MB

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Wspólna logika załączania obrazów: Ctrl+V, upload pliku i drag & drop.
 * Używana na /vision oraz w czatach /chat i /search.
 */
export function useImageAttachment() {
  const [images, setImages] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const addFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (!ACCEPTED.includes(file.type)) {
        setError("Obsługiwane formaty: PNG, JPG, GIF, WEBP.");
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError("Max 4MB. Zrób screenshot fragmentu.");
        continue;
      }
      const url = await readAsDataURL(file);
      setError(null);
      setImages((prev) => [
        ...prev,
        { id: makeId(), url, mediaType: file.type, name: file.name || "obraz" },
      ]);
    }
  }, []);

  // Ctrl+V — wklejenie screenshota ze schowka.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    },
    [addFiles],
  );

  // Drag & drop — nasłuch na obszarze czatu.
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
      e.preventDefault();
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void addFiles(files);
    },
  };

  const remove = useCallback(
    (id: string) => setImages((prev) => prev.filter((i) => i.id !== id)),
    [],
  );
  const clear = useCallback(() => setImages([]), []);

  const toFileParts = useCallback(
    (): FilePart[] =>
      images.map((i) => ({
        type: "file",
        mediaType: i.mediaType,
        url: i.url,
        filename: i.name,
      })),
    [images],
  );

  return {
    images,
    error,
    dragging,
    addFiles,
    handlePaste,
    dropHandlers,
    remove,
    clear,
    toFileParts,
    setError,
  };
}

// Ukryty input + przycisk spinacza (📎).
export function AttachButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={disabled}
        title="Dodaj obraz"
        style={{
          background: "#1a1a2a",
          border: "1px solid #333",
          borderRadius: 10,
          color: "#ededed",
          padding: "0 14px",
          fontSize: 18,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        📎
      </button>
    </>
  );
}

// Podgląd miniatur załączonych obrazów z przyciskiem X.
export function AttachmentPreview({
  images,
  onRemove,
  hint,
}: {
  images: Attachment[];
  onRemove: (id: string) => void;
  hint?: string;
}) {
  if (images.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      {hint && (
        <div style={{ color: "#888", fontSize: 12, marginBottom: 6 }}>
          {hint}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {images.map((img) => (
          <div key={img.id} style={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.name}
              style={{
                maxHeight: 120,
                maxWidth: 200,
                borderRadius: 8,
                border: "1px solid #333",
                display: "block",
              }}
            />
            <button
              type="button"
              onClick={() => onRemove(img.id)}
              title="Usuń"
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "#2a2a3a",
                border: "1px solid #555",
                color: "#ededed",
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Nakładka pokazywana podczas przeciągania pliku nad obszarem czatu.
export function DropOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,10,20,0.85)",
        border: "3px dashed #3b82f6",
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        pointerEvents: "none",
        fontSize: 22,
        color: "#ededed",
      }}
    >
      📥 Upuść obraz
    </div>
  );
}
