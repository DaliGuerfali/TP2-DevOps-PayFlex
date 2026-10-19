'use strict';

const { ValidationError } = require('../utils/errors');

const BRANDS = [
  { name: 'visa', pattern: /^4/ },
  { name: 'mastercard', pattern: /^(5[1-5]|2[2-7])/ },
  { name: 'amex', pattern: /^3[47]/ },
];

function normalize(cardNumber) {
  if (typeof cardNumber !== 'string') {
    throw new ValidationError('cardNumber must be a string');
  }
  return cardNumber.replace(/[\s-]/g, '');
}

function passesLuhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function detectBrand(digits) {
  const brand = BRANDS.find(({ pattern }) => pattern.test(digits));
  return brand ? brand.name : 'unknown';
}

function maskCardNumber(digits) {
  return `**** **** **** ${digits.slice(-4)}`;
}

// The full card number never leaves this function: callers only get the brand,
// the masked number and the verdict.
function validateCard(cardNumber) {
  const digits = normalize(cardNumber);
  if (!/^\d{12,19}$/.test(digits)) {
    return { valid: false, reason: 'INVALID_FORMAT' };
  }
  const result = { brand: detectBrand(digits), maskedNumber: maskCardNumber(digits) };
  if (!passesLuhn(digits)) {
    return { valid: false, reason: 'CHECKSUM_FAILED', ...result };
  }
  return { valid: true, ...result };
}

module.exports = { validateCard, passesLuhn, detectBrand, maskCardNumber };
