import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PlatformCredentials from './PlatformCredentials';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockLocalStorage = {
  getItem: vi.fn(() => 'mock-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

const mockStatusResponse = {
  providers: {
    openai: { configured: true, updatedAt: '2024-01-15T10:00:00Z' },
    twilio: { configured: false, updatedAt: null },
    stripe: { configured: true, updatedAt: '2024-01-10T08:30:00Z' },
  },
};

describe('PlatformCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<PlatformCredentials />);
    expect(screen.getByText('Loading credential status...')).toBeInTheDocument();
  });

  it('displays all provider sections after fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI')).toBeInTheDocument();
      expect(screen.getByText('Twilio')).toBeInTheDocument();
      expect(screen.getByText('Stripe')).toBeInTheDocument();
    });
  });

  it('shows configured status for providers with credentials', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      const configuredBadges = screen.getAllByText('Configured');
      expect(configuredBadges.length).toBe(2);
    });
  });

  it('shows not configured status for providers without credentials', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByText('Not configured')).toBeInTheDocument();
    });
  });

  it('shows masked placeholder when credentials are configured', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      const apiKeyInput = screen.getByLabelText('API Key');
      expect(apiKeyInput).toHaveAttribute('placeholder', '••••••••configured');
    });
  });

  it('shows normal placeholder when credentials are not configured', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      const accountSidInput = screen.getByLabelText('Account SID');
      expect(accountSidInput).toHaveAttribute('placeholder', 'AC...');
    });
  });

  it('shows correct count of configured providers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByText('2 of 3 configured')).toBeInTheDocument();
    });
  });

  it('displays all expected form fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByLabelText('API Key')).toBeInTheDocument();
      expect(screen.getByLabelText('Account SID')).toBeInTheDocument();
      expect(screen.getByLabelText('Auth Token')).toBeInTheDocument();
      expect(screen.getByLabelText('Phone Number')).toBeInTheDocument();
      expect(screen.getByLabelText('Secret Key')).toBeInTheDocument();
      expect(screen.getByLabelText('Webhook Secret')).toBeInTheDocument();
    });
  });

  it('disables save button when no values are entered', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      const saveButtons = screen.getAllByRole('button', { name: /save|update/i });
      saveButtons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });
    });
  });

  it('enables save button when a field value is entered', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByLabelText('Account SID')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Account SID'), {
      target: { value: 'AC12345' },
    });

    const twilioForm = screen.getByLabelText('Account SID').closest('form');
    const saveBtn = twilioForm!.querySelector('button[type="submit"]');
    expect(saveBtn).not.toBeDisabled();
  });

  it('shows success message after saving credentials', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatusResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Credentials saved' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatusResponse,
      });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-test-key' },
    });

    const openaiForm = screen.getByLabelText('API Key').closest('form');
    fireEvent.submit(openaiForm!);

    await waitFor(() => {
      expect(screen.getByText('OpenAI credentials saved successfully.')).toBeInTheDocument();
    });
  });

  it('shows error message on save failure', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatusResponse,
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'apiKey is required and must be a string' }),
      });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-test-key' },
    });

    const openaiForm = screen.getByLabelText('API Key').closest('form');
    fireEvent.submit(openaiForm!);

    await waitFor(() => {
      expect(screen.getByText('apiKey is required and must be a string')).toBeInTheDocument();
    });
  });

  it('shows permission denied message on 403 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(
        screen.getByText('You do not have permission to manage platform credentials.')
      ).toBeInTheDocument();
    });
  });

  it('shows error state with retry on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch credential status')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('has accessible form labels and section headings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusResponse,
    });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Platform Credentials' })).toBeInTheDocument();
      expect(screen.getByLabelText('OpenAI credentials form')).toBeInTheDocument();
      expect(screen.getByLabelText('Twilio credentials form')).toBeInTheDocument();
      expect(screen.getByLabelText('Stripe credentials form')).toBeInTheDocument();
    });
  });

  it('sends POST request to correct provider endpoint on save', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatusResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Credentials saved' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatusResponse,
      });

    render(<PlatformCredentials />);

    await waitFor(() => {
      expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-new-key' },
    });

    const openaiForm = screen.getByLabelText('API Key').closest('form');
    fireEvent.submit(openaiForm!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/credentials/openai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({ apiKey: 'sk-new-key' }),
      });
    });
  });
});
