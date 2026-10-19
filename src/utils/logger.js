'use strict';

const { redact } = require('./redact');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function createLogger({ level = 'info', sink = console } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(lvl, message, context = {}) {
    if (LEVELS[lvl] < threshold) return;
    const entry = { time: new Date().toISOString(), level: lvl, message, ...redact(context) };
    const out = lvl === 'error' || lvl === 'warn' ? sink.error : sink.log;
    out.call(sink, JSON.stringify(entry));
  }

  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}

module.exports = { createLogger, LEVELS };
