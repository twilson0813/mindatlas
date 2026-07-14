import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

/**
 * Server-side input sanitization utilities.
 * Uses DOMPurify with jsdom for HTML/XSS prevention,
 * and provides SQL control character escaping as a defense-in-depth layer
 * (primary SQL injection protection is parameterized queries in db.ts).
 */

// Initialize DOMPurify with jsdom window
const window = new JSDOM('').window;
const purify = DOMPurify(window as unknown as Parameters<typeof DOMPurify>[0]);

/**
 * Sanitizes HTML input by stripping all potentially dangerous content.
 * Removes script tags, event handlers, and other XSS vectors.
 * Returns plain text — all HTML tags are stripped.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';
  // ALLOWED_TAGS: [] strips all HTML, leaving only text content
  return purify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

/**
 * Sanitizes HTML input while preserving safe formatting tags.
 * Allows basic formatting: bold, italic, links, lists, headings.
 * Strips scripts, iframes, event handlers, and other XSS vectors.
 */
export function sanitizeHtmlPermissive(input: string): string {
  if (!input) return '';
  return purify.sanitize(input, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'code', 'pre', 'blockquote'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  });
}

/**
 * Escapes SQL control characters as a defense-in-depth measure.
 * NOTE: This is NOT a substitute for parameterized queries.
 * The primary protection against SQL injection is the parameterized
 * query pattern used in src/server/db/db.ts.
 * This function provides an additional safety layer for contexts
 * where user input might be logged or displayed.
 */
export function sanitizeForSql(input: string): string {
  if (!input) return '';
  return input
    .replace(/\\/g, '\\\\')    // Escape backslashes first
    .replace(/'/g, "''")       // Escape single quotes (SQL standard)
    .replace(/"/g, '""')       // Escape double quotes
    .replace(/\x00/g, '')      // Remove null bytes
    .replace(/\x1a/g, '')      // Remove SUB character (used in some SQL injection)
    .replace(/\r/g, '\\r')     // Escape carriage return
    .replace(/\n/g, '\\n');    // Escape newline
}

/**
 * Checks if a string contains potential XSS patterns.
 * Useful for logging/alerting when suspicious input is detected.
 */
export function containsXssPatterns(input: string): boolean {
  if (!input) return false;
  const xssPatterns = [
    /<script[\s>]/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<iframe[\s>]/i,
    /<object[\s>]/i,
    /<embed[\s>]/i,
    /eval\s*\(/i,
    /expression\s*\(/i,
    /vbscript:/i,
    /data:\s*text\/html/i,
  ];
  return xssPatterns.some((pattern) => pattern.test(input));
}

/**
 * Checks if a string contains potential SQL injection patterns.
 * Useful for logging/alerting when suspicious input is detected.
 */
export function containsSqlInjectionPatterns(input: string): boolean {
  if (!input) return false;
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|UNION)\b.*\b(FROM|INTO|TABLE|SET|WHERE|ALL)\b)/i,
    /--\s/,                    // SQL single-line comment
    /;\s*(SELECT|INSERT|UPDATE|DELETE|DROP)/i,  // Statement chaining
    /'\s*(OR|AND)\s+.*=/i,     // Tautology attacks
    /WAITFOR\s+DELAY/i,        // Time-based attacks
    /BENCHMARK\s*\(/i,         // MySQL time-based attacks
  ];
  return sqlPatterns.some((pattern) => pattern.test(input));
}
