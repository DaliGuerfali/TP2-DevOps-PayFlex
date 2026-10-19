'use strict';

const { randomUUID } = require('node:crypto');

// In-memory persistence: enough for a CI target, and every test gets a fresh store.
function createStore({ idGenerator = randomUUID } = {}) {
  const accounts = new Map();
  const transactions = [];

  return {
    newId: (prefix) => `${prefix}_${idGenerator()}`,
    saveAccount(account) {
      accounts.set(account.id, account);
      return account;
    },
    findAccount: (id) => accounts.get(id),
    addTransaction(transaction) {
      transactions.push(transaction);
      return transaction;
    },
    transactionsFor: (accountId) =>
      transactions.filter((t) => t.accountId === accountId || t.counterpartyId === accountId),
    stats: () => ({ accounts: accounts.size, transactions: transactions.length }),
  };
}

module.exports = { createStore };
