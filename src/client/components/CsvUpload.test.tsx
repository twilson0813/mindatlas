import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CsvUpload } from './CsvUpload';

describe('CsvUpload', () => {
  let mockOnImport: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnImport = vi.fn().mockResolvedValue({
      itemsCreated: 10,
      rowsSkipped: 2,
      skippedRowNumbers: [3, 7],
      errors: [
        { row: 3, reason: 'Empty content field' },
        { row: 7, reason: 'Empty content field' },
      ],
    });
  });

  it('renders with template download link and drop zone', () => {
    render(<CsvUpload onImport={mockOnImport} />);

    expect(screen.getByText(/bulk import via csv/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/download csv template/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drop zone for csv file upload/i)).toBeInTheDocument();
  });

  it('template download link has correct href', () => {
    render(<CsvUpload onImport={mockOnImport} templateDownloadUrl="/api/csv/template" />);

    const link = screen.getByLabelText(/download csv template/i);
    expect(link).toHaveAttribute('href', '/api/csv/template');
    expect(link).toHaveAttribute('download', 'mindatlas-template.csv');
  });

  it('accepts valid CSV file', async () => {
    render(<CsvUpload onImport={mockOnImport} />);

    const file = new File(['content\nhello'], 'import.csv', { type: 'text/csv' });
    const input = screen.getByLabelText(/csv file input/i);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('import.csv')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /import csv/i })).toBeInTheDocument();
  });

  it('rejects non-CSV files', async () => {
    render(<CsvUpload onImport={mockOnImport} />);

    const file = new File(['content'], 'data.json', { type: 'application/json' });
    const input = screen.getByLabelText(/csv file input/i);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/upload a .csv file/i);
    });
  });

  it('rejects CSV files over 10 MB', async () => {
    render(<CsvUpload onImport={mockOnImport} />);

    const file = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });

    const input = screen.getByLabelText(/csv file input/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/exceeds 10 MB/i);
    });
  });

  it('shows progress indicator during import', async () => {
    // Use a slow-resolving promise to observe progress state
    let resolveImport: (value: unknown) => void;
    mockOnImport.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );

    render(<CsvUpload onImport={mockOnImport} />);

    const file = new File(['content\nhello'], 'data.csv', { type: 'text/csv' });
    const input = screen.getByLabelText(/csv file input/i);
    fireEvent.change(input, { target: { files: [file] } });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /import csv/i }));

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    // Resolve the import
    resolveImport!({
      itemsCreated: 5,
      rowsSkipped: 0,
      skippedRowNumbers: [],
      errors: [],
    });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  it('displays import results with created and skipped counts', async () => {
    const user = userEvent.setup();
    render(<CsvUpload onImport={mockOnImport} />);

    const file = new File(['content\nhello'], 'data.csv', { type: 'text/csv' });
    const input = screen.getByLabelText(/csv file input/i);
    fireEvent.change(input, { target: { files: [file] } });

    await user.click(screen.getByRole('button', { name: /import csv/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/import results/i)).toBeInTheDocument();
    });

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Items Created')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Rows Skipped')).toBeInTheDocument();
  });

  it('shows error details in expandable section', async () => {
    const user = userEvent.setup();
    render(<CsvUpload onImport={mockOnImport} />);

    const file = new File(['content\nhello'], 'data.csv', { type: 'text/csv' });
    const input = screen.getByLabelText(/csv file input/i);
    fireEvent.change(input, { target: { files: [file] } });

    await user.click(screen.getByRole('button', { name: /import csv/i }));

    await waitFor(() => {
      expect(screen.getByText(/view 2 skipped row details/i)).toBeInTheDocument();
    });
  });

  it('handles import failure with error message', async () => {
    mockOnImport.mockRejectedValue(new Error('Malformed CSV at line 5'));
    const user = userEvent.setup();
    render(<CsvUpload onImport={mockOnImport} />);

    const file = new File(['bad data'], 'bad.csv', { type: 'text/csv' });
    const input = screen.getByLabelText(/csv file input/i);
    fireEvent.change(input, { target: { files: [file] } });

    await user.click(screen.getByRole('button', { name: /import csv/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Malformed CSV at line 5');
    });
  });

  it('allows resetting after successful import', async () => {
    const user = userEvent.setup();
    render(<CsvUpload onImport={mockOnImport} />);

    const file = new File(['content\nhello'], 'data.csv', { type: 'text/csv' });
    const input = screen.getByLabelText(/csv file input/i);
    fireEvent.change(input, { target: { files: [file] } });

    await user.click(screen.getByRole('button', { name: /import csv/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /import another/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /import another/i }));

    expect(screen.queryByLabelText(/import results/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/drop zone for csv file upload/i)).toBeInTheDocument();
  });

  it('handles drag and drop for CSV files', async () => {
    render(<CsvUpload onImport={mockOnImport} />);

    const dropZone = screen.getByLabelText(/drop zone for csv file upload/i);
    const file = new File(['content\nhello'], 'import.csv', { type: 'text/csv' });

    fireEvent.dragOver(dropZone, { dataTransfer: { files: [file] } });
    expect(dropZone).toHaveClass('csv-drop-zone--active');

    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('import.csv')).toBeInTheDocument();
    });
  });
});
