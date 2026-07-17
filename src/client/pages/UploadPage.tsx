import React, { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UploadForm } from '../components/UploadForm';
import { CsvUpload } from '../components/CsvUpload';

export function UploadPage() {
  const { user, logout } = useAuth();

  const handleItemSubmit = useCallback(
    async (data: { content: string; file?: File; tags: string[] }) => {
      const formData = new FormData();
      if (data.content) {
        formData.append('content', data.content);
      }
      if (data.file) {
        formData.append('file', data.file);
      }
      if (data.tags.length > 0) {
        formData.append('tags', JSON.stringify(data.tags));
      }

      const token = localStorage.getItem('mindatlas_access_token');
      const response = await fetch('/api/items/upload', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Upload failed');
      }
    },
    [],
  );

  const handleCsvImport = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const token = localStorage.getItem('mindatlas_access_token');
    const response = await fetch('/api/csv/import', {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'CSV import failed');
    }

    return response.json();
  }, []);

  return (
    <div className="upload-page">
      <header className="dashboard-header">
        <h1>MindAtlas</h1>
        <div className="header-actions">
          <span className="user-email">{user?.email}</span>
          <button className="btn-secondary" onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="upload-page__content">
        <div className="upload-page__nav">
          <a href="/" className="upload-page__back">
            ← Back to Dashboard
          </a>
        </div>

        <h2>Upload Items</h2>
        <p className="text-muted">
          Add new items to your collection by entering text, uploading files, or importing in bulk
          via CSV.
        </p>

        <section className="upload-section" aria-labelledby="single-upload-heading">
          <h3 id="single-upload-heading">Single Item Upload</h3>
          <UploadForm onSubmit={handleItemSubmit} />
        </section>

        <hr className="upload-divider" />

        <section className="upload-section" aria-labelledby="csv-upload-heading">
          <h3 id="csv-upload-heading" className="visually-hidden">
            CSV Bulk Import
          </h3>
          <CsvUpload onImport={handleCsvImport} />
        </section>
      </main>
    </div>
  );
}
