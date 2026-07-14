/**
 * Type extension for Express Request to include authenticated user payload.
 * When the auth middleware validates a JWT, it attaches the decoded payload to req.user.
 */

export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
