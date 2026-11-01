const { test, expect } = require('@playwright/test');
const { newSessionId, sessionHeaders, registerAndLogin, expectSchema } = require('./helpers');

test.describe('ЛР4. Контракт ответов (JSON Schema)', () => {
  test('9. GET /api/products соответствует схеме', async ({ request }) => {
    const res = await request.get('/api/products');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    const products = await res.json();
    expectSchema(products, 'products');
    expect(products.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  test('9. GET /api/cart новой сессии соответствует схеме', async ({ request }) => {
    const res = await request.get('/api/cart', { headers: sessionHeaders(newSessionId()) });
    const cart = await res.json();
    expectSchema(cart, 'cart');
    expect(cart).toMatchObject({ items: [], total: 0, promoApplied: false });
  });

  test('9. Заказ и история заказов соответствуют схеме', async ({ request }) => {
    const { token } = await registerAndLogin(request);
    const headers = sessionHeaders(newSessionId(), token);
    await request.post('/api/cart/items', { headers, data: { productId: 'p1', quantity: 1 } });

    const order = await (await request.post('/api/checkout', { headers, data: {} })).json();
    expectSchema(order, 'order');

    const { orders } = await (await request.get('/api/orders', { headers })).json();
    orders.forEach((o) => expectSchema(o, 'order'));
  });

  test('9. Все ошибки 4xx возвращают JSON вида { error }', async ({ request }) => {
    const responses = await Promise.all([
      request.get('/api/profile'),
      request.get('/api/cart'),
      request.post('/api/auth/login', { data: { email: 'x@y.ru', password: 'Wrong2026pass' } }),
      request.get('/api/unknown'),
      request.delete('/api/products'),
    ]);
    expect(responses.map((r) => r.status())).toEqual([401, 400, 401, 404, 405]);
    for (const res of responses) expectSchema(await res.json(), 'error');
  });
});

test.describe('ЛР4. Несуществующие ресурсы и методы', () => {
  test('Health-check → 200', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('10. Несуществующий endpoint → 404', async ({ request }) => {
    const res = await request.get('/api/does-not-exist');
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'Ресурс не найден' });
  });

  for (const [method, path, allow] of [
    ['delete', '/api/products', 'GET, HEAD'],
    ['put', '/api/checkout', 'POST'],
    ['get', '/api/auth/login', 'POST'],
    ['post', '/api/profile', 'GET, HEAD'],
  ]) {
    test(`10. ${method.toUpperCase()} ${path} → 405 и заголовок Allow`, async ({ request }) => {
      const res = await request.fetch(path, { method: method.toUpperCase() });
      expect(res.status()).toBe(405);
      expect(res.headers().allow).toBe(allow);
    });
  }
});
