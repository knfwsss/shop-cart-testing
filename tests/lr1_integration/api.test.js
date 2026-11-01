const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { app, resetSessions } = require('../../src/server');

let server;
let baseUrl;
const session = 'test-session-integration';

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': session,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe('API integration', () => {
  before(async () => {
    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    server.close();
  });

  beforeEach(async () => {
    resetSessions();
    await api('POST', '/api/cart/reset');
  });

  it('GET /api/products — возвращает каталог', async () => {
    const { status, data } = await api('GET', '/api/products');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 3);
  });

  it('POST /api/cart/items — smoke: добавление товара', async () => {
    const { status, data } = await api('POST', '/api/cart/items', {
      productId: 'p1',
      quantity: 1,
    });
    assert.equal(status, 200);
    assert.equal(data.items.length, 1);
    assert.equal(data.subtotal, 2990);
  });

  it('POST /api/cart/items — negative: товар не в наличии', async () => {
    const { status, data } = await api('POST', '/api/cart/items', {
      productId: 'p3',
      quantity: 1,
    });
    assert.equal(status, 400);
    assert.match(data.error, /склад/);
  });

  it('PATCH /api/cart/items — boundary: количество 0 удаляет позицию', async () => {
    await api('POST', '/api/cart/items', { productId: 'p1', quantity: 1 });
    const { status, data } = await api('PATCH', '/api/cart/items/p1', { quantity: 0 });
    assert.equal(status, 200);
    assert.equal(data.items.length, 0);
  });

  it('POST /api/cart/promo — negative: невалидный промокод', async () => {
    await api('POST', '/api/cart/items', { productId: 'p1', quantity: 1 });
    const { status, data } = await api('POST', '/api/cart/promo', { code: 'BADCODE' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Промокод недействителен');
  });

  it('POST /api/cart/promo — negative: просроченный промокод', async () => {
    await api('POST', '/api/cart/items', { productId: 'p1', quantity: 1 });
    const { status, data } = await api('POST', '/api/cart/promo', { code: 'EXPIRED' });
    assert.equal(status, 400);
    assert.match(data.error, /истёк/);
  });

  it('POST /api/checkout — negative: пустая корзина', async () => {
    const { status, data } = await api('POST', '/api/checkout', {});
    assert.equal(status, 400);
    assert.equal(data.error, 'Корзина пуста');
  });

  it('POST /api/checkout — security: подмена суммы отклоняется', async () => {
    await api('POST', '/api/cart/items', { productId: 'p1', quantity: 1 });
    const { status, data } = await api('POST', '/api/checkout', { total: 1 });
    assert.equal(status, 400);
    assert.match(data.error, /серверным расчётом/);
    assert.equal(data.expectedTotal, 2990);
  });

  it('E2E regression: добавить → qty → промокод → checkout', async () => {
    let res = await api('POST', '/api/cart/items', { productId: 'p1', quantity: 2 });
    assert.equal(res.data.subtotal, 5980);

    res = await api('PATCH', '/api/cart/items/p1', { quantity: 1 });
    assert.equal(res.data.subtotal, 2990);

    res = await api('POST', '/api/cart/promo', { code: 'SALE10' });
    assert.equal(res.data.promoApplied, true);
    assert.equal(res.data.total, 2691);

    res = await api('POST', '/api/checkout', { total: res.data.total });
    assert.equal(res.status, 201);
    assert.match(res.data.id, /^ORD-/);
    assert.equal(res.data.total, 2691);

    res = await api('GET', '/api/cart');
    assert.equal(res.data.items.length, 0);
  });
});
