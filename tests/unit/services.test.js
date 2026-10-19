'use strict';

const { computeTransferFee } = require('../../src/services/fees');
const { validateCard, passesLuhn, detectBrand, maskCardNumber } = require('../../src/services/cards');
const { createStore } = require('../../src/services/store');
const { createAccountService } = require('../../src/services/accounts');
const { parseAmount, toUnits } = require('../../src/utils/money');
const { ValidationError, NotFoundError, BusinessRuleError } = require('../../src/utils/errors');

describe('money', () => {
  test.each([
    [10, 1000],
    [0.01, 1],
    [12.34, 1234],
  ])('parseAmount(%p) -> %p cents', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  test.each([['10'], [Number.NaN], [Infinity], [0], [-5], [1.234], [2e9]])('parseAmount(%p) is rejected', (input) => {
    expect(() => parseAmount(input)).toThrow(ValidationError);
  });

  test('error message uses the field name', () => {
    expect(() => parseAmount(-1, 'initialBalance')).toThrow('initialBalance must be greater than 0');
  });

  test('toUnits converts cents back to units', () => {
    expect(toUnits(1234)).toBe(12.34);
  });
});

describe('fees', () => {
  test.each([
    [99_99, 0], // free under 100
    [100_00, 1_00], // 0.5 % = 0.50, floored to 1.00
    [1_000_00, 5_00], // 0.5 %
    [10_000_00, 50_00], // 0.5 % = 50.00, at the cap
    [10_000_01, 25_00], // 0.25 %
    [100_000_00, 50_00], // capped
  ])('fee for %p cents is %p cents', (amount, fee) => {
    expect(computeTransferFee(amount)).toBe(fee);
  });

  test.each([[0], [-100], [10.5], ['100']])('rejects invalid amount %p', (amount) => {
    expect(() => computeTransferFee(amount)).toThrow(ValidationError);
  });
});

describe('cards', () => {
  test('accepts a valid Visa test card and masks it', () => {
    expect(validateCard('4111 1111 1111 1111')).toEqual({
      valid: true,
      brand: 'visa',
      maskedNumber: '**** **** **** 1111',
    });
  });

  test('flags a checksum failure without exposing the number', () => {
    const result = validateCard('4111-1111-1111-1112');
    expect(result).toMatchObject({ valid: false, reason: 'CHECKSUM_FAILED', maskedNumber: '**** **** **** 1112' });
    expect(JSON.stringify(result)).not.toContain('411111');
  });

  test.each([['1234'], ['abcd efgh ijkl mnop'], ['']])('rejects badly formatted %p', (input) => {
    expect(validateCard(input)).toEqual({ valid: false, reason: 'INVALID_FORMAT' });
  });

  test('rejects non-string input', () => {
    expect(() => validateCard(4111111111111111)).toThrow(ValidationError);
  });

  test.each([
    ['4111111111111111', 'visa'],
    ['5555555555554444', 'mastercard'],
    ['2223003122003222', 'mastercard'],
    ['378282246310005', 'amex'],
    ['6011111111111117', 'unknown'],
  ])('detects brand of %s as %s', (digits, brand) => {
    expect(detectBrand(digits)).toBe(brand);
  });

  test('luhn and mask helpers', () => {
    expect(passesLuhn('378282246310005')).toBe(true);
    expect(passesLuhn('4111111111111112')).toBe(false);
    expect(maskCardNumber('5555555555554444')).toBe('**** **** **** 4444');
  });
});

describe('store', () => {
  test('generates prefixed ids and tracks stats', () => {
    const store = createStore({ idGenerator: () => 'fixed' });
    expect(store.newId('acc')).toBe('acc_fixed');
    store.saveAccount({ id: 'a' });
    store.addTransaction({ id: 't', accountId: 'a', counterpartyId: 'b' });
    expect(store.findAccount('a')).toEqual({ id: 'a' });
    expect(store.transactionsFor('b')).toHaveLength(1);
    expect(store.transactionsFor('c')).toHaveLength(0);
    expect(store.stats()).toEqual({ accounts: 1, transactions: 1 });
  });
});

describe('account service', () => {
  const fixedClock = () => new Date('2026-10-19T10:00:00.000Z');
  let service;

  beforeEach(() => {
    service = createAccountService(createStore(), fixedClock);
  });

  test('creates an account with default currency and no balance', () => {
    const account = service.createAccount({ owner: '  Alice  ' });
    expect(account).toMatchObject({ owner: 'Alice', currency: 'EUR', balance: 0, createdAt: '2026-10-19T10:00:00.000Z' });
    expect(service.listTransactions(account.id)).toEqual([]);
  });

  test('records the initial balance as a deposit', () => {
    const account = service.createAccount({ owner: 'Bob', currency: 'TND', initialBalance: 250.5 });
    expect(account.balance).toBe(250.5);
    expect(service.listTransactions(account.id)).toEqual([expect.objectContaining({ type: 'DEPOSIT', amount: 250.5 })]);
  });

  test.each([[{}], [{ owner: 'A' }], [{ owner: 42 }], [{ owner: 'Alice', currency: 'GBP' }], [undefined]])(
    'rejects invalid account payload %p',
    (payload) => {
      expect(() => service.createAccount(payload)).toThrow(ValidationError);
    },
  );

  test('getAccount on unknown id throws NotFoundError', () => {
    expect(() => service.getAccount('acc_missing')).toThrow(NotFoundError);
    expect(() => service.listTransactions('acc_missing')).toThrow(NotFoundError);
  });

  test('deposit and withdraw update the balance', () => {
    const { id } = service.createAccount({ owner: 'Carol' });
    expect(service.deposit(id, 100).account.balance).toBe(100);
    const { account, transaction } = service.withdraw(id, 40.25);
    expect(account.balance).toBe(59.75);
    expect(transaction).toMatchObject({ type: 'WITHDRAWAL', amount: 40.25, fee: 0, counterpartyId: null });
  });

  test('withdraw more than the balance is refused', () => {
    const { id } = service.createAccount({ owner: 'Dave', initialBalance: 10 });
    expect(() => service.withdraw(id, 10.01)).toThrow(BusinessRuleError);
    expect(service.getAccount(id).balance).toBe(10);
  });

  describe('transfer', () => {
    let alice;
    let bob;

    beforeEach(() => {
      alice = service.createAccount({ owner: 'Alice', initialBalance: 1000 });
      bob = service.createAccount({ owner: 'Bob' });
    });

    test('moves money and charges the fee to the sender', () => {
      const result = service.transfer({ fromAccountId: alice.id, toAccountId: bob.id, amount: 200 });
      expect(result.transaction).toMatchObject({ type: 'TRANSFER', amount: 200, fee: 1, counterpartyId: bob.id });
      expect(result.from.balance).toBe(799);
      expect(result.to.balance).toBe(200);
      expect(service.listTransactions(bob.id)).toHaveLength(1);
    });

    test('refuses when balance does not cover amount + fee', () => {
      expect(() => service.transfer({ fromAccountId: alice.id, toAccountId: bob.id, amount: 999.5 })).toThrow(
        expect.objectContaining({ code: 'INSUFFICIENT_FUNDS' }),
      );
      expect(service.getAccount(alice.id).balance).toBe(1000);
    });

    test('refuses a transfer between currencies', () => {
      const usd = service.createAccount({ owner: 'Eve', currency: 'USD' });
      expect(() => service.transfer({ fromAccountId: alice.id, toAccountId: usd.id, amount: 10 })).toThrow(
        expect.objectContaining({ code: 'CURRENCY_MISMATCH' }),
      );
    });

    test.each([
      [{}],
      [undefined],
      [{ fromAccountId: 'x' }],
    ])('requires both accounts %p', (payload) => {
      expect(() => service.transfer(payload)).toThrow(ValidationError);
    });

    test('refuses a self transfer and unknown accounts', () => {
      expect(() => service.transfer({ fromAccountId: alice.id, toAccountId: alice.id, amount: 1 })).toThrow(
        ValidationError,
      );
      expect(() => service.transfer({ fromAccountId: alice.id, toAccountId: 'acc_nope', amount: 1 })).toThrow(
        NotFoundError,
      );
    });
  });
});
