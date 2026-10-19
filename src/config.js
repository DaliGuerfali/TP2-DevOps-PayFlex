'use strict';

const { LEVELS } = require('./utils/logger');

function readInteger(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

function loadConfig(env = process.env) {
  const logLevel = env.LOG_LEVEL || 'info';
  if (!(logLevel in LEVELS)) {
    throw new Error(`LOG_LEVEL must be one of ${Object.keys(LEVELS).join(', ')}`);
  }
  return {
    port: readInteger(env, 'PORT', 3000),
    latencyMs: readInteger(env, 'SIMULATED_LATENCY_MS', 0),
    logLevel,
  };
}

module.exports = { loadConfig };
