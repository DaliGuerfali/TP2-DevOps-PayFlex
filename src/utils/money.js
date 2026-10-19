'use strict';

const { ValidationError } = require('./errors');

// Amounts are exchanged as decimal units (e.g. 12.5 EUR) and stored as integer cents
// to avoid floating point drift on balances.
const MAX_AMOUNT_CENTS = 100_000_000_00; // 100 million per operation

function parseAmount(value, field = 'amount') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a number`);
  }
  if (value <= 0) {
    throw new ValidationError(`${field} must be greater than 0`);
  }
  const cents = Math.round(value * 100);
  if (Math.abs(cents - value * 100) > 1e-6) {
    throw new ValidationError(`${field} must have at most 2 decimals`);
  }
  if (cents > MAX_AMOUNT_CENTS) {
    throw new ValidationError(`${field} exceeds the maximum allowed per operation`);
  }
  return cents;
}

function toUnits(cents) {
  return cents / 100;
}

module.exports = { parseAmount, toUnits, MAX_AMOUNT_CENTS };
