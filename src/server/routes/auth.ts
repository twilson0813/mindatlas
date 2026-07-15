import { Router } from 'express';
import type { Request, Response } from 'express';
import { login, register, refresh } from '../services/auth/index.js';
import { createChildLogger } from '../logger.js';

const router = Router();
const log = createChildLogger({ module: 'authRoutes' });

/**
 * POST /api/auth/register
 * Creates a new user account and returns JWT tokens.
 */
router.post('/register', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ message: 'Email and password are required' });
    return;
  }

  try {
    const user = await register(email, password);
    const tokens = await login(email, password);
    res.status(201).json({
      user: { id: user.id, email: user.email },
      ...tokens,
    });
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode || (err.message.includes('already exists') ? 409 : 400);
    log.warn({ email, error: err.message }, 'Registration failed');
    res.status(status).json({ message: err.message });
  }
});

/**
 * POST /api/auth/login
 * Authenticates a user and returns JWT access + refresh tokens.
 */
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ message: 'Email and password are required' });
    return;
  }

  try {
    const tokens = await login(email, password);
    res.status(200).json(tokens);
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    log.warn({ email, error: err.message }, 'Login failed');
    res.status(401).json({ message: err.message || 'Invalid credentials' });
  }
});

/**
 * POST /api/auth/refresh
 * Exchanges a refresh token for a new access token.
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ message: 'Refresh token is required' });
    return;
  }

  try {
    const tokens = await refresh(refreshToken);
    res.status(200).json(tokens);
  } catch (error) {
    const err = error as Error;
    res.status(401).json({ message: err.message || 'Invalid refresh token' });
  }
});

export default router;
