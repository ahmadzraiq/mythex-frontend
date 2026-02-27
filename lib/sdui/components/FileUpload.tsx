'use client';

import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react-native';

interface FileUploadProps {
  label?: string;
  accept?: string;
  multiple?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onChange?: (files: FileList | null) => void;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const FileUpload = React.forwardRef<HTMLDivElement, FileUploadProps>(
  ({ label = 'Click or drag to upload', accept, multiple = false, className = '', style, onChange, ...rest }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [filename, setFilename] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);

    const handleFiles = (files: FileList | null) => {
      if (!files) return;
      setFilename(files.length === 1 ? files[0].name : `${files.length} files selected`);
      onChange?.(files);
    };

    return (
      <div ref={ref} style={style} className={`flex flex-col gap-1 ${className}`} {...rest}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 cursor-pointer transition-colors ${
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-primary/5 dark:border-gray-600 dark:bg-gray-900'
          }`}
        >
          <Upload size={24} color="#6b7280" />
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {filename ?? label}
          </span>
          {!filename && (
            <span className="text-xs text-gray-400 dark:text-gray-600">
              {accept ? `Accepted: ${accept}` : 'Any file type'}
            </span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    );
  },
);

FileUpload.displayName = 'FileUpload';
export default FileUpload;
