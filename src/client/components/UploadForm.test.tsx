import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UploadForm } from './UploadForm';

describe('UploadForm', () => {
  let mockOnSubmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnSubmit = vi.fn().mockResolvedValue(undefined);
  });

  it('renders the form with text input, file drop zone, and tags input', () => {
    render(<UploadForm onSubmit={mockOnSubmit} />);

    expect(screen.getByLabelText(/content/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drop zone for file upload/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /tags/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload item/i })).toBeInTheDocument();
  });

  it('submits text content without file', async () => {
    const user = userEvent.setup();
    render(<UploadForm onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText(/content/i), 'Hello world');
    await user.click(screen.getByRole('button', { name: /upload item/i }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        content: 'Hello world',
        file: undefined,
        tags: [],
      });
    });
  });

  it('shows error when submitting empty form', async () => {
    const user = userEvent.setup();
    render(<UploadForm onSubmit={mockOnSubmit} />);

    // Force enable button by focusing and submitting via form
    const form = screen.getByRole('form');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/enter text content or upload a file/i);
    });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('adds and removes tags', async () => {
    const user = userEvent.setup();
    render(<UploadForm onSubmit={mockOnSubmit} />);

    const tagsInput = screen.getByRole('textbox', { name: /tags/i });
    await user.type(tagsInput, 'javascript{Enter}');
    await user.type(tagsInput, 'react{Enter}');

    expect(screen.getByText('#javascript')).toBeInTheDocument();
    expect(screen.getByText('#react')).toBeInTheDocument();

    // Remove a tag
    await user.click(screen.getByLabelText(/remove tag javascript/i));
    expect(screen.queryByText('#javascript')).not.toBeInTheDocument();
    expect(screen.getByText('#react')).toBeInTheDocument();
  });

  it('displays selected file in the drop zone', async () => {
    render(<UploadForm onSubmit={mockOnSubmit} />);

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/file upload input/i);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('test.txt')).toBeInTheDocument();
    });
  });

  it('rejects files over 25 MB', async () => {
    render(<UploadForm onSubmit={mockOnSubmit} />);

    const largeFile = new File(['x'.repeat(100)], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(largeFile, 'size', { value: 26 * 1024 * 1024 });

    const input = screen.getByLabelText(/file upload input/i);
    fireEvent.change(input, { target: { files: [largeFile] } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/exceeds 25 MB/i);
    });
  });

  it('rejects unsupported file types', async () => {
    render(<UploadForm onSubmit={mockOnSubmit} />);

    const exeFile = new File(['content'], 'malware.exe', { type: 'application/octet-stream' });
    const input = screen.getByLabelText(/file upload input/i);
    fireEvent.change(input, { target: { files: [exeFile] } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/not supported/i);
    });
  });

  it('handles drag and drop', async () => {
    render(<UploadForm onSubmit={mockOnSubmit} />);

    const dropZone = screen.getByLabelText(/drop zone for file upload/i);
    const file = new File(['hello'], 'note.md', { type: 'text/markdown' });

    fireEvent.dragOver(dropZone, { dataTransfer: { files: [file] } });
    expect(dropZone).toHaveClass('drop-zone--active');

    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('note.md')).toBeInTheDocument();
    });
  });

  it('clears form after successful submit', async () => {
    const user = userEvent.setup();
    render(<UploadForm onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText(/content/i), 'Test content');
    await user.click(screen.getByRole('button', { name: /upload item/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/content/i)).toHaveValue('');
    });
  });

  it('shows error from failed submission', async () => {
    mockOnSubmit.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    render(<UploadForm onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText(/content/i), 'Test content');
    await user.click(screen.getByRole('button', { name: /upload item/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });
  });
});
