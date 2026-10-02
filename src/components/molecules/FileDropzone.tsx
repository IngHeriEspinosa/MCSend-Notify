'use client';

/**
 * Zona de carga de archivos: arrastrar y soltar o selector nativo (accesible por teclado gracias
 * al <label> asociado al <input type="file"> visualmente oculto).
 */
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useId, useRef, useState, type DragEvent } from 'react';

interface FileDropzoneProps {
  accept: string;
  label: string;
  hint: string;
  busyLabel: string;
  busy: boolean;
  compact?: boolean;
  onFile: (file: File) => void | Promise<void>;
}

export function FileDropzone({
  accept,
  label,
  hint,
  busyLabel,
  busy,
  compact = false,
  onFile,
}: FileDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file || busy) return;
    await onFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void handle(event.dataTransfer.files[0]);
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors focus-within:outline-3 focus-within:outline-secondary ${
          compact ? 'px-4 py-6' : 'px-6 py-10'
        } ${dragging ? 'border-primary bg-surface' : 'border-line bg-paper hover:border-primary'}`}
      >
        <UploadFileOutlined
          fontSize={compact ? 'medium' : 'large'}
          className="text-primary"
          aria-hidden
        />
        <Typography>{busy ? busyLabel : label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          className="sr-only"
          disabled={busy}
          onChange={(event) => void handle(event.target.files?.[0])}
        />
      </label>
      {busy ? <LinearProgress aria-label={busyLabel} /> : null}
    </div>
  );
}
