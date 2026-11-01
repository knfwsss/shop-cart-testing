const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  createEmptyCart,
  addItem,
  updateQuantity,
  applyPromo,
  calculateTotals,
  checkout,
} = require('../../src/cart');
const { validatePromoCode } = require('../../src/promo');

describe('validatePromoCode (unit)', () => {
  it('принимает валидный промокод SALE10', () => {
    const result = validatePromoCode('sale10', new Date('2026-09-01'));
    assert.equal(result.valid, true);
    assert.equal(result.code, 'SALE10');
    assert.equal(result.discountPercent, 10);
  });

  it('отклоняет несуществующий промокод', () => {
    const result = validatePromoCode('FAKE99', new Date('2026-09-01'));
    assert.equal(result.valid, false);
    assert.equal(result.error, 'Промокод недействителен');
  });

  it('отклоняет просроченный промокод', () => {
    const result = validatePromoCode('EXPIRED', new Date('2026-09-01'));
    assert.equal(result.valid, false);
    assert.equal(result.error, 'Срок действия промокода истёк');
  });

  it('отклоняет неверный формат', () => {
    const result = validatePromoCode('AB', new Date('2026-09-01'));
    assert.equal(result.valid, false);
    assert.equal(result.error, 'Неверный формат промокода');
  });
});

describe('cart business logic (unit)', () => {
  let cart;

  beforeEach(() => {
    cart = createEmptyCart();
  });

  it('добавляет товар в корзину', () => {
    const result = addItem(cart, 'p1', 1);
    assert.equal(result.ok, true);
    assert.equal(result.cart.items.length, 1);
    assert.equal(result.cart.items[0].quantity, 1);
    assert.equal(result.cart.items[0].unitPrice, 2990);
  });

  it('отклоняет товар без остатка', () => {
    const result = addItem(cart, 'p3', 1);
    assert.equal(result.ok, false);
    assert.match(result.error, /склад/);
  });

  it('отклоняет количество больше остатка', () => {
    const result = addItem(cart, 'p2', 100);
    assert.equal(result.ok, false);
    assert.match(result.error, /Доступно только/);
  });

  it('удаляет позицию при количестве 0', () => {
    let result = addItem(cart, 'p1', 2);
    cart = result.cart;
    result = updateQuantity(cart, 'p1', 0);
    assert.equal(result.ok, true);
    assert.equal(result.cart.items.length, 0);
  });

  it('применяет промокод и пересчитывает итог', () => {
    let result = addItem(cart, 'p1', 2);
    cart = result.cart;
    result = applyPromo(cart, 'SALE10', new Date('2026-09-01'));
    cart = result.cart;
    const totals = calculateTotals(cart);
    assert.equal(totals.subtotal, 5980);
    assert.equal(totals.discountPercent, 10);
    assert.equal(totals.discount, 598);
    assert.equal(totals.total, 5382);
  });

  it('не оформляет пустую корзину', () => {
    const result = checkout(cart);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Корзина пуста');
  });

  it('успешно оформляет заказ', () => {
    let result = addItem(cart, 'p4', 1);
    cart = result.cart;
    result = checkout(cart);
    assert.equal(result.ok, true);
    assert.match(result.order.id, /^ORD-/);
    assert.equal(result.order.total, 3490);
  });
});
