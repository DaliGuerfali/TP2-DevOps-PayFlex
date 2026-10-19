'use strict';

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(400, 'VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends AppError {
  constructor(message) {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

class BusinessRuleError extends AppError {
  constructor(code, message) {
    super(422, code, message);
    this.name = 'BusinessRuleError';
  }
}

module.exports = { AppError, ValidationError, NotFoundError, BusinessRuleError };
