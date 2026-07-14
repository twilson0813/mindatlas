import pino from 'pino';
import { config } from './config.js';

/**
 * Structured JSON logger for all application log output.
 * Produces JSON to stdout with timestamp, level, and message fields.
 * Requirement 10.5: Container SHALL produce structured JSON log output to standard output.
 */
export const logger = pino({
  level: config.nodeEnv === 'test' ? 'silent' : 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

/**
 * Creates a child logger with additional context bindings.
 * Useful for adding module-specific context (e.g., service name, queue name).
 */
export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
