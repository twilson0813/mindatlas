import { body, validationResult } from 'express-validator';
import type { Request, Response, NextFunction } from 'express';
import { sanitizeHtml } from '../utils/sanitization.js';

/**
 * Express-validator middleware chains for common input patterns.
 * Each chain validates and sanitizes specific input types.
 */

// Valid content types for items
const VALID_CONTENT_TYPES = [
  'plain_text',
  'link',
  'code_snippet',
  'note',
  'task',
  'idea',
  'file',
  'custom',
] as const;

/**
 * Middleware that checks validation results and returns 400 if invalid.
 * Place after any validation chain.
 */
export function handleValidationErrors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map((err) => ({
        field: 'path' in err ? err.path : undefined,
        message: err.msg,
      })),
    });
    return;
  }
  next();
}

/**
 * Email validation chain.
 * Validates format and normalizes email.
 */
export const validateEmail = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Must be a valid email address')
    .normalizeEmail(),
];

/**
 * Password validation chain.
 * Enforces complexity: min 8 chars, uppercase, lowercase, digit, special character.
 */
export const validatePassword = [
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/\d/)
    .withMessage('Password must contain at least one digit')
    .matches(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/)
    .withMessage('Password must contain at least one special character'),
];

/**
 * Generic text content validation chain.
 * Sanitizes HTML, enforces max length.
 */
export const validateTextContent = [
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Content is required')
    .isLength({ max: 50000 })
    .withMessage('Content must not exceed 50000 characters')
    .customSanitizer((value: string) => sanitizeHtml(value)),
];

/**
 * Item content type validation chain.
 * Validates against the allowed content type enum values.
 */
export const validateContentType = [
  body('content_type')
    .optional()
    .trim()
    .isIn(VALID_CONTENT_TYPES)
    .withMessage(
      `Content type must be one of: ${VALID_CONTENT_TYPES.join(', ')}`
    ),
];

/**
 * Combined item creation validation chain.
 * Validates content (sanitized), optional content_type (enum), and optional metadata.
 */
export const validateItemCreation = [
  ...validateTextContent,
  ...validateContentType,
  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be a JSON object'),
];

/**
 * Registration validation chain (email + password).
 */
export const validateRegistration = [...validateEmail, ...validatePassword];

export { VALID_CONTENT_TYPES };
