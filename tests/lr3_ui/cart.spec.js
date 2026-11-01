const { test, expect } = require('@playwright/test');
const { CartPage } = require('./pages/CartPage');

test.describe('Корзина интернет-магазина — UI', () => {
  let cart;

  test.beforeEach(async ({ page }) => {
    cart = new CartPage(page);
    await cart.open();
  });

  test('1. Успешное добавление товара и оформление заказа', async ({ page }) => {
    await cart.addProduct('p1');
    await expect(cart.cartItems).toContainText('Наушники Bluetooth');
    await expect(cart.totals).toContainText(/2[\s\u00A0\u202F]990/);
    await cart.checkout();
    await expect(cart.orderModal).toBeVisible();
    await expect(cart.orderId).toHaveText(/^ORD-/);
    await expect(cart.cartItems).toContainText('Корзина пуста');
    await page.screenshot({ path: 'tests/lr3_ui/screenshots/success-checkout.png', fullPage: true });
  });

  test('2. Пустой промокод', async () => {
    await cart.addProduct('p1');
    await cart.applyPromo('');
    await expect(cart.message).toContainText('Промокод не указан');
  });

  test('3. Промокод с недопустимыми символами', async () => {
    await cart.addProduct('p1');
    await cart.applyPromo('SALE@10');
    await expect(cart.message).toContainText('Неверный формат промокода');
  });

  test('4. Количество больше остатка (граница max + 1)', async () => {
    await cart.addProduct('p1');
    await cart.setQuantity('p1', 16);
    await expect(cart.message).toContainText('Доступно только 15 шт.');
  });

  test('5. Несуществующий промокод', async () => {
    await cart.addProduct('p1');
    await cart.applyPromo('NOSUCH');
    await expect(cart.message).toContainText('Промокод недействителен');
  });

  test('6. Просроченный промокод', async () => {
    await cart.addProduct('p1');
    await cart.applyPromo('EXPIRED');
    await expect(cart.message).toContainText('Срок действия промокода истёк');
  });

  test('7. XSS в поле промокода не выполняется', async ({ page }) => {
    let dialogOpened = false;
    page.on('dialog', async (dialog) => {
      dialogOpened = true;
      await dialog.dismiss();
    });

    const payload = '<script>alert(1)</script>';
    await cart.addProduct('p1');
    await cart.applyPromo(payload);
    await expect(cart.message).toContainText('Неверный формат промокода');
    await expect(cart.message).not.toContainText('alert(1)');
    expect(dialogOpened).toBe(false);
  });

  test('8. Границы количества: минимум 1 и максимум 15', async () => {
    await cart.addProduct('p1');
    await cart.setQuantity('p1', 1);
    await expect(cart.totals).toContainText(/2[\s\u00A0\u202F]990/);

    await cart.setQuantity('p1', 15);
    await expect(cart.message).not.toContainText('Доступно только');
    await expect(cart.qtyInput('p1')).toHaveValue('15');
    await expect(cart.totals).toContainText(/44[\s\u00A0\u202F]850/);
  });

  test('9. Товар без остатка нельзя добавить', async () => {
    await expect(cart.product('p3')).toContainText('Нет в наличии');
    await expect(cart.addButton('p3')).toBeDisabled();
  });

  test('10. Оформление пустой корзины недоступно', async () => {
    await expect(cart.cartItems).toContainText('Корзина пуста');
    await expect(cart.checkoutButton).toBeDisabled();
  });
});
