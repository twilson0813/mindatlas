import React, { useState, useRef, useCallback } from 'react';

interface CsvImportResult {
  itemsCreated: number;
  rowsSkipped: number;
  skippedRowNumbers: number[];
  errors: Array<{ row: number; reason: string }>;
}

interface CsvUploadProps {
  onImport: (file: File) => Promise<CsvImportResult>;
  templateDownloadUrl?: string;
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export function CsvUpload({ onImport, templateDownloadUrl = '/api/csv/template' }: CsvUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_CSV_SIZE = 10 * 1024 * 1024; // 10 MB

  const validateCsvFile = useCallback((f: File): string | null => {
    if (f.size > MAX_CSV_SIZE) {
      return `CSV file exceeds 10 MB limit (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
    }
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'csv') {
      return 'Please upload a .csv file';
    }
    return null;
  }, []);

  const handleFileSelect = useCallback((f: File) => {
    const validationError = validateCsvFile(f);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    setFile(f);
    setError(null);
    setResult(null);
    setStatus('idle');
  }, [validateCsvFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  }, [handleFileSelect]);

  const handleImport = useCallback(async () => {
    if (!file) return;

    setStatus('uploading');
    setProgress(0);
    setError(null);
    setResult(null);

    // Simulate upload progress
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      const importResult = await onImport(file);
      clearInterval(progressInterval);
      setProgress(100);
      setStatus('success');
      setResult(importResult);
    } catch (err) {
      clearInterval(progressInterval);
      setProgress(0);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'CSV import failed');
    }
  }, [file, onImport]);

  const handleReset = useCallback(() => {
    setFile(null);
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className="csv-upload" aria-label="CSV bulk import">
      <div className="csv-upload__header">
        <h3>Bulk Import via CSV</h3>
        <a
          href={templateDownloadUrl}
          className="btn-secondary csv-template-btn"
          download="mindatlas-template.csv"
          aria-label="Download CSV template"
        >
          ⬇ Download Template
        </a>
      </div>

      <p className="csv-upload__description">
        Upload a CSV file to import multiple items at once. The file must include a
        &quot;content&quot; column header. Optional columns: content_type, tags, metadata.
      </p>

      <div
        className={`csv-drop-zone ${isDragOver ? 'csv-drop-zone--active' : ''} ${file ? 'csv-drop-zone--has-file' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        aria-label="Drop zone for CSV file upload"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            fileInputRef.current?.click();
          }
        }}
      >
        {file ? (
          <div className="csv-drop-zone__file-info">
            <span className="csv-drop-zone__icon" aria-hidden="true">📄</span>
            <span className="csv-drop-zone__filename">{file.name}</span>
            <span className="csv-drop-zone__filesize">
              ({(file.size / 1024).toFixed(1)} KB)
            </span>
          </div>
        ) : (
          <div className="csv-drop-zone__prompt">
            <span className="csv-drop-zone__icon" aria-hidden="true">📊</span>
            <span>Drag &amp; drop a CSV file or click to browse</span>
            <span className="csv-drop-zone__hint">Max 10 MB, up to 5000 rows</span>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="visually-hidden"
        accept=".csv"
        onChange={handleFileInputChange}
        aria-label="CSV file input"
      />

      {status === 'uploading' && (
        <div className="csv-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="csv-progress__bar">
            <div
              className="csv-progress__fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="csv-progress__label">{progress}% — Importing...</span>
        </div>
      )}

      {status === 'success' && result && (
        <div className="csv-results" role="status" aria-label="Import results">
          <h4 className="csv-results__title">Import Complete</h4>
          <div className="csv-results__summary">
            <div className="csv-results__stat csv-results__stat--created">
              <span className="csv-results__stat-value">{result.itemsCreated}</span>
              <span className="csv-results__stat-label">Items Created</span>
            </div>
            <div className="csv-results__stat csv-results__stat--skipped">
              <span className="csv-results__stat-value">{result.rowsSkipped}</span>
              <span className="csv-results__stat-label">Rows Skipped</span>
            </div>
          </div>
          {result.errors.length > 0 && (
            <details className="csv-results__errors">
              <summary>View {result.errors.length} skipped row details</summary>
              <ul>
                {result.errors.map((err) => (
                  <li key={err.row}>
                    Row {err.row}: {err.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && (
        <div className="upload-error" role="alert">
          {error}
        </div>
      )}

      <div className="csv-upload__actions">
        {file && status !== 'uploading' && status !== 'success' && (
          <button
            type="button"
            className="btn-primary"
            onClick={handleImport}
            disabled={!file}
          >
            Import CSV
          </button>
        )}
        {(file || result) && status !== 'uploading' && (
          <button
            type="button"
            className="btn-secondary"
            onClick={handleReset}
          >
            {status === 'success' ? 'Import Another' : 'Clear'}
          </button>
        )}
      </div>
    </div>
  );
}
