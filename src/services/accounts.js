'use strict';

const { ValidationError, NotFoundError, BusinessRuleError } = require('../utils/errors');
const { parseAmount, toUnits } = require('../utils/money');
const { computeTransferFee } = require('./fees');

const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'TND'];

function toPublicAccount(account) {
  return {
    id: account.id,
    owner: account.owner,
    currency: account.currency,
    balance: toUnits(account.balanceCents),
    createdAt: account.createdAt,
  };
}

function toPublicTransaction(transaction) {
  return {
    id: transaction.id,
    type: transaction.type,
    accountId: transaction.accountId,
    counterpartyId: transaction.counterpartyId,
    amount: toUnits(transaction.amountCents),
    fee: toUnits(transaction.feeCents),
    createdAt: transaction.createdAt,
  };
}

function createAccountService(store, clock = () => new Date()) {
  function requireAccount(id) {
    const account = store.findAccount(id);
    if (!account) throw new NotFoundError(`account ${id} not found`);
    return account;
  }

  function record(type, accountId, amountCents, extra = {}) {
    return store.addTransaction({
      id: store.newId('txn'),
      type,
      accountId,
      counterpartyId: extra.counterpartyId ?? null,
      amountCents,
      feeCents: extra.feeCents ?? 0,
      createdAt: clock().toISOString(),
    });
  }

  function createAccount({ owner, currency = 'EUR', initialBalance } = {}) {
    if (typeof owner !== 'string' || owner.trim().length < 2) {
      throw new ValidationError('owner must be a string of at least 2 characters');
    }
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new ValidationError(`currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}`);
    }
    const account = store.saveAccount({
      id: store.newId('acc'),
      owner: owner.trim(),
      currency,
      balanceCents: 0,
      createdAt: clock().toISOString(),
    });
    if (initialBalance !== undefined) {
      const cents = parseAmount(initialBalance, 'initialBalance');
      account.balanceCents = cents;
      record('DEPOSIT', account.id, cents);
    }
    return toPublicAccount(account);
  }

  function getAccount(id) {
    return toPublicAccount(requireAccount(id));
  }

  function deposit(id, amount) {
    const account = requireAccount(id);
    const cents = parseAmount(amount);
    account.balanceCents += cents;
    const transaction = record('DEPOSIT', id, cents);
    return { account: toPublicAccount(account), transaction: toPublicTransaction(transaction) };
  }

  function withdraw(id, amount) {
    const account = requireAccount(id);
    const cents = parseAmount(amount);
    if (account.balanceCents < cents) {
      throw new BusinessRuleError('INSUFFICIENT_FUNDS', 'balance too low for this withdrawal');
    }
    account.balanceCents -= cents;
    const transaction = record('WITHDRAWAL', id, cents);
    return { account: toPublicAccount(account), transaction: toPublicTransaction(transaction) };
  }

  function transfer({ fromAccountId, toAccountId, amount } = {}) {
    if (!fromAccountId || !toAccountId) {
      throw new ValidationError('fromAccountId and toAccountId are required');
    }
    if (fromAccountId === toAccountId) {
      throw new ValidationError('cannot transfer to the same account');
    }
    const source = requireAccount(fromAccountId);
    const target = requireAccount(toAccountId);
    if (source.currency !== target.currency) {
      throw new BusinessRuleError('CURRENCY_MISMATCH', 'both accounts must use the same currency');
    }
    const cents = parseAmount(amount);
    const feeCents = computeTransferFee(cents);
    if (source.balanceCents < cents + feeCents) {
      throw new BusinessRuleError('INSUFFICIENT_FUNDS', 'balance too low for this transfer and its fee');
    }
    source.balanceCents -= cents + feeCents;
    target.balanceCents += cents;
    const transaction = record('TRANSFER', source.id, cents, {
      counterpartyId: target.id,
      feeCents,
    });
    return {
      transaction: toPublicTransaction(transaction),
      from: toPublicAccount(source),
      to: toPublicAccount(target),
    };
  }

  function listTransactions(id) {
    requireAccount(id);
    return store.transactionsFor(id).map(toPublicTransaction);
  }

  return { createAccount, getAccount, deposit, withdraw, transfer, listTransactions };
}

module.exports = { createAccountService, SUPPORTED_CURRENCIES };
