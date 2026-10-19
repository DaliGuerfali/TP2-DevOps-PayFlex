'use strict';

// Redaction helpers used before anything is written to the logs: PayFlex must never
// leak a full card number (PAN) or a credential, even in debug output.
const PAN_PATTERN = /\b(?:\d[ -]?){12,18}\d\b/g;
const SENSITIVE_KEYS = /pass(word)?|secret|token|api[-_]?key|authorization|cvv|cardnumber|pan/i;

function maskPan(match) {
  const digits = match.replace(/\D/g, '');
  return `****${digits.slice(-4)}`;
}

function redactString(text) {
  return text.replace(PAN_PATTERN, maskPan);
}

function redact(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item, depth + 1),
      ]),
    );
  }
  return value;
}

module.exports = { redact, redactString };
