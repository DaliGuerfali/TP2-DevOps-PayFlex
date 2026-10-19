'use strict';

const { ValidationError } = require('../utils/errors');

// Transfer pricing grid (amounts in cents):
//   < 100.00            -> free
//   100.00 .. 10 000.00 -> 0.5 %
//   > 10 000.00         -> 0.25 %
// with a floor of 1.00 and a cap of 50.00 on paid transfers.
const FREE_UNDER = 100_00;
const STANDARD_LIMIT = 10_000_00;
const MIN_FEE = 1_00;
const MAX_FEE = 50_00;

function computeTransferFee(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ValidationError('amount must be a positive integer number of cents');
  }
  if (amountCents < FREE_UNDER) return 0;
  const rate = amountCents <= STANDARD_LIMIT ? 0.005 : 0.0025;
  const fee = Math.round(amountCents * rate);
  return Math.min(Math.max(fee, MIN_FEE), MAX_FEE);
}

module.exports = { computeTransferFee };
