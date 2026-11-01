const { test, expect } = require('@playwright/test');
const { newSessionId, sessionHeaders, registerAndLogin, expectSchema } = require('./helpers');

test.describe('ЛР4. Корзина и оформление заказа через API', () => {
  let headers;

  test.beforeEach(() => {
    headers = sessionHeaders(newSessionId());
  });

  async function add(request, productId, quantity = 1) {
    return request.post('/api/cart/items', { headers, data: { productId, quantity } });
  }

  test('Добавление товара → 200, сумма пересчитана', async ({ request }) => {
    const res = await add(request, 'p1', 2);
    expect(res.status()).toBe(200);
    const cart = await res.json();
    expectSchema(cart, 'cart');
    expect(cart.subtotal).toBe(5980);
    expect(cart.total).toBe(5980);
  });

  test('Товар без остатка → 400', async ({ request }) => {
    const res = await add(request, 'p3');
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Товар отсутствует на складе');
  });

  test('Несуществующий товар → 400', async ({ request }) => {
    const res = await add(request, 'p999');
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Товар не найден');
  });

  for (const [quantity, status] of [[0, 200], [1, 200], [15, 200], [16, 400]]) {
    test(`8. Количество ${quantity} при остатке 15 → ${status}`, async ({ request }) => {
      await add(request, 'p1');
      const res = await request.patch('/api/cart/items/p1', { headers, data: { quantity } });
      expect(res.status()).toBe(status);
      if (quantity === 0) expect((await res.json()).items).toHaveLength(0);
      if (status === 400) expect((await res.json()).error).toBe('Доступно только 15 шт.');
    });
  }

  for (const [title, quantity] of [['отрицательное', -1], ['дробное', 1.5], ['строка', 'abc']]) {
    test(`Количество ${title} → 400`, async ({ request }) => {
      const res = await add(request, 'p1', quantity);
      expect(res.status()).toBe(400);
    });
  }

  for (const [code, status, error] of [
    ['AB123', 400, 'Неверный формат промокода'],
    ['AB1234', 400, 'Промокод недействителен'],
    ['A'.repeat(20), 400, 'Промокод недействителен'],
    ['A'.repeat(21), 400, 'Неверный формат промокода'],
    ['EXPIRED', 400, 'Срок действия промокода истёк'],
    ['sale10', 200, null],
  ]) {
    test(`8. Промокод «${code}» (длина ${code.length}) → ${status}`, async ({ request }) => {
      await add(request, 'p1');
      const res = await request.post('/api/cart/promo', { headers, data: { code } });
      expect(res.status()).toBe(status);
      const body = await res.json();
      if (error) expect(body.error).toBe(error);
      else expect(body).toMatchObject({ promoCode: 'SALE10', discountPercent: 10, total: 2691 });
    });
  }

  test('Отмена промокода возвращает полную сумму', async ({ request }) => {
    await add(request, 'p1');
    await request.post('/api/cart/promo', { headers, data: { code: 'SALE10' } });
    const res = await request.delete('/api/cart/promo', { headers });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ promoApplied: false, total: 2990 });
  });

  test('Оформление пустой корзины → 400', async ({ request }) => {
    const res = await request.post('/api/checkout', { headers, data: {} });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Корзина пуста');
  });

  test('Подмена суммы при оформлении → 400', async ({ request }) => {
    await add(request, 'p1');
    const res = await request.post('/api/checkout', { headers, data: { total: 1 } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Сумма заказа не совпадает с серверным расчётом',
      expectedTotal: 2990,
    });
  });

  test('Гостевой заказ → 201, корзина очищена', async ({ request }) => {
    await add(request, 'p4');
    const res = await request.post('/api/checkout', { headers, data: { total: 3490 } });
    expect(res.status()).toBe(201);
    expectSchema(await res.json(), 'order');

    const cart = await (await request.get('/api/cart', { headers })).json();
    expect(cart.items).toHaveLength(0);
  });

  test('Заказ с токеном попадает в историю пользователя', async ({ request }) => {
    const { token } = await registerAndLogin(request);
    const authHeaders = { ...headers, Authorization: `Bearer ${token}` };

    await add(request, 'p2', 2);
    await request.post('/api/cart/promo', { headers, data: { code: 'SALE10' } });
    const orderRes = await request.post('/api/checkout', { headers: authHeaders, data: {} });
    expect(orderRes.status()).toBe(201);
    const order = await orderRes.json();
    expect(order.total).toBe(9882);

    const history = await (await request.get('/api/orders', { headers: authHeaders })).json();
    expect(history.orders.map((o) => o.id)).toEqual([order.id]);
    const profile = await (await request.get('/api/profile', { headers: authHeaders })).json();
    expect(profile.ordersCount).toBe(1);
  });

  test('Заказ с недействительным токеном → 401, корзина не очищена', async ({ request }) => {
    await add(request, 'p1');
    const res = await request.post('/api/checkout', {
      headers: { ...headers, Authorization: 'Bearer broken' },
      data: {},
    });
    expect(res.status()).toBe(401);
    const cart = await (await request.get('/api/cart', { headers })).json();
    expect(cart.items).toHaveLength(1);
  });

  test('30 одновременных заказов получают 30 разных номеров', async ({ request }) => {
    const sessions = Array.from({ length: 30 }, () => sessionHeaders(newSessionId()));
    for (const h of sessions) {
      await request.post('/api/cart/items', { headers: h, data: { productId: 'p4', quantity: 1 } });
    }
    const orders = await Promise.all(
      sessions.map(async (h) => (await request.post('/api/checkout', { headers: h, data: {} })).json()),
    );
    expect(new Set(orders.map((o) => o.id)).size).toBe(30);
  });
});
