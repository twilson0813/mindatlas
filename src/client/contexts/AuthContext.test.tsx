import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

// Helper component to expose auth context for testing
function AuthConsumer() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="user-email">{user?.email || 'none'}</span>
      <button onClick={() => login('test@example.com', 'password123')}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

// Create a valid JWT-like token for testing
function createMockToken(payload: { sub: string; email: string; exp: number }): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = 'mock-signature';
  return `${header}.${body}.${signature}`;
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when useAuth is called outside AuthProvider', () => {
    // Suppress React error boundary logs
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AuthConsumer />)).toThrow('useAuth must be used within an AuthProvider');
    spy.mockRestore();
  });

  it('starts with unauthenticated state when no tokens stored', async () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('user-email').textContent).toBe('none');
  });

  it('restores auth state from valid stored access token', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const token = createMockToken({ sub: 'user-1', email: 'stored@test.com', exp: futureExp });
    localStorage.setItem('mindatlas_access_token', token);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-email').textContent).toBe('stored@test.com');
  });

  it('clears state on logout', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = createMockToken({ sub: 'user-1', email: 'test@test.com', exp: futureExp });
    localStorage.setItem('mindatlas_access_token', token);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').textContent).toBe('true');
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /logout/i }));

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(localStorage.getItem('mindatlas_access_token')).toBeNull();
    expect(localStorage.getItem('mindatlas_refresh_token')).toBeNull();
  });

  it('handles successful login', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 900;
    const accessToken = createMockToken({ sub: 'user-2', email: 'test@example.com', exp: futureExp });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ accessToken, refreshToken: 'refresh-token-123' }),
    });

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').textContent).toBe('true');
    });

    expect(screen.getByTestId('user-email').textContent).toBe('test@example.com');
    expect(localStorage.getItem('mindatlas_access_token')).toBe(accessToken);
    expect(localStorage.getItem('mindatlas_refresh_token')).toBe('refresh-token-123');
  });

  it('handles failed login', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Invalid credentials' }),
    });

    // We need to catch the error thrown by login
    function LoginErrorConsumer() {
      const { login } = useAuth();
      const [error, setError] = React.useState('');
      return (
        <div>
          <span data-testid="login-error">{error}</span>
          <button
            onClick={async () => {
              try {
                await login('bad@test.com', 'wrong');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Try Login
          </button>
        </div>
      );
    }

    render(
      <AuthProvider>
        <LoginErrorConsumer />
      </AuthProvider>
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /try login/i }));

    await waitFor(() => {
      expect(screen.getByTestId('login-error').textContent).toBe('Invalid credentials');
    });
  });
});
