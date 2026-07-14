import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import pino from 'pino';

/**
 * Property 15: Structured Log Output
 * Verify all log events produce valid JSON with timestamp, level, and message fields.
 * Generator: random log events at various levels.
 *
 * **Validates: Requirements 10.5**
 */
describe('Property 15: Structured Log Output', () => {
  const pinoLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

  const levelArb = fc.constantFrom(...pinoLevels);
  const messageArb = fc.string({ minLength: 0, maxLength: 500 });

  function createTestLogger(): { logger: pino.Logger; output: string[] } {
    const output: string[] = [];
    const testLogger = pino(
      {
        level: 'trace',
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level(label) {
            return { level: label };
          },
        },
      },
      {
        write(msg: string) {
          output.push(msg);
        },
      },
    );
    return { logger: testLogger, output };
  }

  it('should produce valid JSON with time, level, and msg fields for any log event', () => {
    fc.assert(
      fc.property(levelArb, messageArb, (level, message) => {
        const { logger: testLogger, output } = createTestLogger();

        testLogger[level](message);

        expect(output).toHaveLength(1);

        // Must be valid JSON
        let parsed: Record<string, unknown>;
        expect(() => {
          parsed = JSON.parse(output[0]);
        }).not.toThrow();

        parsed = JSON.parse(output[0]);

        // Must have 'time' field with valid ISO timestamp
        expect(parsed).toHaveProperty('time');
        expect(typeof parsed.time).toBe('string');
        const timeValue = new Date(parsed.time as string);
        expect(timeValue.getTime()).not.toBeNaN();

        // Must have 'level' field matching the log level used
        expect(parsed).toHaveProperty('level');
        expect(parsed.level).toBe(level);

        // Must have 'msg' field matching the message logged
        expect(parsed).toHaveProperty('msg');
        expect(parsed.msg).toBe(message);
      }),
      { numRuns: 200 },
    );
  });

  it('should produce valid JSON for log events with additional context bindings', () => {
    // Avoid keys that conflict with JS prototype properties or pino internals
    const reservedKeys = new Set([
      'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'toLocaleString',
      'isPrototypeOf', 'propertyIsEnumerable', '__proto__', '__defineGetter__',
      '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
      'level', 'time', 'msg', 'pid', 'hostname',
    ]);
    const safeKeyArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && !reservedKeys.has(s));

    const contextArb = fc.dictionary(
      safeKeyArb,
      fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      { minKeys: 1, maxKeys: 5 },
    );

    fc.assert(
      fc.property(levelArb, messageArb, contextArb, (level, message, context) => {
        const { logger: testLogger, output } = createTestLogger();

        testLogger[level](context, message);

        expect(output).toHaveLength(1);

        let parsed: Record<string, unknown>;
        expect(() => {
          parsed = JSON.parse(output[0]);
        }).not.toThrow();

        parsed = JSON.parse(output[0]);

        // Core fields still present
        expect(parsed).toHaveProperty('time');
        expect(parsed).toHaveProperty('level', level);
        expect(parsed).toHaveProperty('msg', message);

        // Additional context fields included
        for (const [key, value] of Object.entries(context)) {
          expect(parsed).toHaveProperty(key, value);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should produce valid JSON for child loggers at any level', () => {
    // Avoid keys that conflict with JS prototype properties or pino internals
    const reservedKeys = new Set([
      'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'toLocaleString',
      'isPrototypeOf', 'propertyIsEnumerable', '__proto__', '__defineGetter__',
      '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
      'level', 'time', 'msg', 'pid', 'hostname',
    ]);
    const safeKeyArb = fc
      .string({ minLength: 1, maxLength: 15 })
      .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && !reservedKeys.has(s));

    const bindingsArb = fc.dictionary(
      safeKeyArb,
      fc.oneof(fc.string(), fc.integer()),
      { minKeys: 1, maxKeys: 3 },
    );

    fc.assert(
      fc.property(levelArb, messageArb, bindingsArb, (level, message, bindings) => {
        const { logger: testLogger, output } = createTestLogger();
        const childLogger = testLogger.child(bindings);

        childLogger[level](message);

        expect(output).toHaveLength(1);

        let parsed: Record<string, unknown>;
        expect(() => {
          parsed = JSON.parse(output[0]);
        }).not.toThrow();

        parsed = JSON.parse(output[0]);

        // Core structured fields present
        expect(parsed).toHaveProperty('time');
        expect(parsed).toHaveProperty('level', level);
        expect(parsed).toHaveProperty('msg', message);

        // Child bindings present
        for (const [key, value] of Object.entries(bindings)) {
          expect(parsed).toHaveProperty(key, value);
        }
      }),
      { numRuns: 100 },
    );
  });
});
