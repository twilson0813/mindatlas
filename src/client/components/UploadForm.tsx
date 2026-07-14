import React, { useState, useRef, useCallback } from 'react';

interface UploadFormProps {
  onSubmit: (data: { content: string; file?: File; tags: string[] }) => Promise<void>;
}

export function UploadForm({ onSubmit }: UploadFormProps) {
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
  const ALLOWED_EXTENSIONS = [
    '.pdf', '.png', '.jpg', '.gif', '.txt', '.md',
    '.csv', '.json', '.py', '.js', '.ts', '.html', '.css',
  ];

  const validateFile = useCallback((f: File): string | null => {
    if (f.size > MAX_FILE_SIZE) {
      return `File exceeds 25 MB limit (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
    }
    const ext = '.' + f.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `File type "${ext}" is not supported`;
    }
    return null;
  }, []);

  const handleFileSelect = useCallback((f: File) => {
    const validationError = validateFile(f);
    if (validationError) {
      setError(validationError);
      return;
    }
    setFile(f);
    setError(null);
  }, [validateFile]);

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

  const handleAddTag = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const trimmed = tagInput.trim().replace(/^#/, '');
      if (trimmed && !tags.includes(trimmed)) {
        setTags((prev) => [...prev, trimmed]);
      }
      setTagInput('');
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && !file) {
      setError('Please enter text content or upload a file');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        content: content.trim(),
        file: file || undefined,
        tags,
      });
      setContent('');
      setFile(null);
      setTags([]);
      setTagInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [content, file, tags, onSubmit]);

  const handleRemoveFile = useCallback(() => {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <form className="upload-form" onSubmit={handleSubmit} aria-label="Upload item">
      <div className="form-group">
        <label htmlFor="upload-content">Content</label>
        <textarea
          id="upload-content"
          className="upload-textarea"
          placeholder="Enter text content, paste a link, or type a note..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          aria-describedby="content-hint"
        />
        <span id="content-hint" className="form-hint">
          Plain text, links, code snippets, notes, or ideas
        </span>
      </div>

      <div className="form-group">
        <label>File Upload</label>
        <div
          className={`drop-zone ${isDragOver ? 'drop-zone--active' : ''} ${file ? 'drop-zone--has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          aria-label="Drop zone for file upload"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              fileInputRef.current?.click();
            }
          }}
        >
          {file ? (
            <div className="drop-zone__file-info">
              <span className="drop-zone__filename">{file.name}</span>
              <span className="drop-zone__filesize">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
              <button
                type="button"
                className="drop-zone__remove"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveFile();
                }}
                aria-label="Remove file"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="drop-zone__prompt">
              <span className="drop-zone__icon" aria-hidden="true">📁</span>
              <span>Drag &amp; drop a file here or click to browse</span>
              <span className="drop-zone__hint">
                PDF, PNG, JPG, GIF, TXT, MD, CSV, JSON, code files — up to 25 MB
              </span>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="visually-hidden"
          onChange={handleFileInputChange}
          accept={ALLOWED_EXTENSIONS.join(',')}
          aria-label="File upload input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="upload-tags">Tags</label>
        <div className="tags-input-container">
          <div className="tags-list" aria-label="Selected tags">
            {tags.map((tag) => (
              <span key={tag} className="tag-badge">
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="tag-remove"
                  aria-label={`Remove tag ${tag}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <input
            id="upload-tags"
            type="text"
            className="tags-input"
            placeholder="Add tags (press Enter or comma to add)"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleAddTag}
            aria-describedby="tags-hint"
          />
        </div>
        <span id="tags-hint" className="form-hint">
          Separate tags with Enter or comma
        </span>
      </div>

      {error && (
        <div className="upload-error" role="alert">
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn-primary upload-submit"
        disabled={isSubmitting || (!content.trim() && !file)}
      >
        {isSubmitting ? 'Uploading...' : 'Upload Item'}
      </button>
    </form>
  );
}
