'use strict';

const { redact, redactString } = require('../../src/utils/redact');
const { createLogger } = require('../../src/utils/logger');
const { loadConfig } = require('../../src/config');

function fakeSink() {
  return { log: jest.fn(), error: jest.fn() };
}

describe('redact', () => {
  test('masks card numbers inside free text', () => {
    expect(redactString('paid with 4111 1111 1111 1111 today')).toBe('paid with ****1111 today');
    expect(redactString('no card here, order 12345')).toBe('no card here, order 12345');
  });

  test('replaces sensitive keys and walks nested objects and arrays', () => {
    const input = {
      user: 'alice',
      password: 'hunter2',
      nested: { apiKey: 'abc', notes: ['card 5555-5555-5555-4444'] },
      count: 3,
    };
    expect(redact(input)).toEqual({
      user: 'alice',
      password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', notes: ['card ****4444'] },
      count: 3,
    });
  });

  test('stops on very deep structures', () => {
    let deep = { value: 'leaf' };
    for (let i = 0; i < 10; i += 1) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });
});

describe('logger', () => {
  test('writes JSON lines with redacted context', () => {
    const sink = fakeSink();
    createLogger({ sink }).info('payment', { cardNumber: '4111111111111111', path: '/x' });
    const entry = JSON.parse(sink.log.mock.calls[0][0]);
    expect(entry).toMatchObject({ level: 'info', message: 'payment', cardNumber: '[REDACTED]', path: '/x' });
  });

  test('routes warn and error to stderr and honours the level', () => {
    const sink = fakeSink();
    const logger = createLogger({ level: 'warn', sink });
    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('careful');
    logger.error('boom');
    expect(sink.log).not.toHaveBeenCalled();
    expect(sink.error).toHaveBeenCalledTimes(2);
  });

  test('silent level writes nothing and unknown level falls back to info', () => {
    const silentSink = fakeSink();
    createLogger({ level: 'silent', sink: silentSink }).error('nope');
    expect(silentSink.error).not.toHaveBeenCalled();

    const sink = fakeSink();
    const logger = createLogger({ level: 'verbose', sink });
    logger.debug('hidden');
    logger.info('shown');
    expect(sink.log).toHaveBeenCalledTimes(1);
  });
});

describe('config', () => {
  test('uses defaults', () => {
    expect(loadConfig({})).toEqual({ port: 3000, latencyMs: 0, logLevel: 'info' });
  });

  test('reads environment values', () => {
    expect(loadConfig({ PORT: '8080', SIMULATED_LATENCY_MS: '250', LOG_LEVEL: 'debug' })).toEqual({
      port: 8080,
      latencyMs: 250,
      logLevel: 'debug',
    });
    expect(loadConfig({ PORT: '' }).port).toBe(3000);
  });

  test.each([[{ PORT: 'abc' }], [{ SIMULATED_LATENCY_MS: '-1' }], [{ LOG_LEVEL: 'loud' }]])('rejects %p', (env) => {
    expect(() => loadConfig(env)).toThrow();
  });
});
