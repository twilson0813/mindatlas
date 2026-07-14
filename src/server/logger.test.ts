import { describe, it, expect } from 'vitest';
import pino from 'pino';

describe('Logger', () => {
  it('should produce valid JSON output with required fields', () => {
    const output: string[] = [];
    const testLogger = pino(
      {
        level: 'info',
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

    testLogger.info('test message');

    expect(output).toHaveLength(1);
    const parsed = JSON.parse(output[0]);
    expect(parsed).toHaveProperty('level', 'info');
    expect(parsed).toHaveProperty('msg', 'test message');
    expect(parsed).toHaveProperty('time');
    // Verify time is valid ISO string
    expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
  });

  it('should include child bindings in output', () => {
    const output: string[] = [];
    const testLogger = pino(
      {
        level: 'info',
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

    const child = testLogger.child({ module: 'redis' });
    child.info('connected');

    const parsed = JSON.parse(output[0]);
    expect(parsed).toHaveProperty('module', 'redis');
    expect(parsed).toHaveProperty('level', 'info');
    expect(parsed).toHaveProperty('msg', 'connected');
  });

  it('should support all standard log levels', () => {
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

    testLogger.trace('trace msg');
    testLogger.debug('debug msg');
    testLogger.info('info msg');
    testLogger.warn('warn msg');
    testLogger.error('error msg');
    testLogger.fatal('fatal msg');

    expect(output).toHaveLength(6);
    const levels = output.map((o) => JSON.parse(o).level);
    expect(levels).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  });

  it('should include additional context in structured output', () => {
    const output: string[] = [];
    const testLogger = pino(
      {
        level: 'info',
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

    testLogger.info({ userId: 'abc-123', action: 'login' }, 'user authenticated');

    const parsed = JSON.parse(output[0]);
    expect(parsed).toHaveProperty('userId', 'abc-123');
    expect(parsed).toHaveProperty('action', 'login');
    expect(parsed).toHaveProperty('msg', 'user authenticated');
  });
});
