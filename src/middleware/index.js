'use strict';

const { AppError } = require('../utils/errors');

// Artificial delay on /api routes. Only used by the CI demo scenarios to simulate a
// slow release (perf-warning / perf-critical); 0 in normal operation.
function simulatedLatency(ms) {
  if (!ms) return (req, res, next) => next();
  return (req, res, next) => setTimeout(next, ms);
}

function requestLogger(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  };
}

function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `route ${req.method} ${req.path} not found` } });
}

function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'request body is not valid JSON' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'request body is too large' } });
    }
    logger.error('unhandled error', { path: req.originalUrl, error: err.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'unexpected error' } });
  };
}

module.exports = { simulatedLatency, requestLogger, notFound, errorHandler };
