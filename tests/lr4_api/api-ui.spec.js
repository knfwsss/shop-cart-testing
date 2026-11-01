const { test, expect } = require('@playwright/test');
const { CartPage } = require('../lr3_ui/pages/CartPage');
const { newSessionId, sessionHeaders } = require('./helpers');

test.describe('ЛР4. Связка API + UI', () => {
  test('Корзина, собранная через API, видна в браузере', async ({ page, request }) => {
    const sessionId = newSessionId();
    const headers = sessionHeaders(sessionId);
    await request.post('/api/cart/items', { headers, data: { productId: 'p2', quantity: 2 } });
    await request.post('/api/cart/promo', { headers, data: { code: 'SALE10' } });

    await page.addInitScript((id) => localStorage.setItem('cartSessionId', id), sessionId);
    const cart = new CartPage(page);
    await cart.open();

    await expect(page.getByTestId('cart-item-p2')).toContainText('Клавиатура механическая');
    await expect(cart.qtyInput('p2')).toHaveValue('2');
    await expect(cart.totals).toContainText('SALE10');
    await expect(cart.totals).toContainText(/9[\s\u00A0\u202F]882/);
  });

  test('Заказ, оформленный в браузере, очищает корзину и в API', async ({ page, request }) => {
    const sessionId = newSessionId();
    await page.addInitScript((id) => localStorage.setItem('cartSessionId', id), sessionId);
    const cart = new CartPage(page);
    await cart.open();
    await cart.addProduct('p4');
    await cart.checkout();
    await expect(cart.orderId).toHaveText(/^ORD-/);

    const res = await request.get('/api/cart', { headers: sessionHeaders(sessionId) });
    expect((await res.json()).items).toHaveLength(0);
  });
});
