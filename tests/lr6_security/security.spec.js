const { test, expect } = require('@playwright/test');
const { createAuth } = require('../../src/auth');
const { CartPage } = require('../lr3_ui/pages/CartPage');
const {
  STRONG_PASSWORD,
  newSessionId,
  sessionHeaders,
  uniqueEmail,
  registerUser,
  registerAndLogin,
} = require('../lr4_api/helpers');

const LEAK_MARKERS = ['node_modules', '/Users/', 'at JSON.parse', 'SyntaxError', 'Express', 'SQL', 'syntax error'];

function expectNoLeak(text) {
  for (const marker of LEAK_MARKERS) expect(text, `ответ содержит «${marker}»`).not.toContain(marker);
}

test.describe('ЛР6-1. SQL-инъекции', () => {
  const payloads = ["' OR '1'='1", "admin'--", "1; DROP TABLE users;--", "' UNION SELECT * FROM users--"];

  for (const payload of payloads) {
    test(`Вход с «${payload}» не пускает и не раскрывает внутренности`, async ({ request }) => {
      const res = await request.post('/api/auth/login', { data: { email: payload, password: payload } });
      expect([400, 401]).toContain(res.status());
      const text = await res.text();
      expect(text).not.toContain('token');
      expectNoLeak(text);
    });
  }

  test('Инъекция в промокод и productId отклоняется валидацией', async ({ request }) => {
    const headers = sessionHeaders(newSessionId());
    const promo = await request.post('/api/cart/promo', { headers, data: { code: "' OR '1'='1" } });
    const item = await request.post('/api/cart/items', {
      headers, data: { productId: "p1' OR 1=1--", quantity: 1 },
    });
    expect(promo.status()).toBe(400);
    expect(item.status()).toBe(400);
    expectNoLeak(await promo.text());
    expectNoLeak(await item.text());
  });
});

test.describe('ЛР6-2. XSS', () => {
  test('Скрипт в email не принимается при регистрации', async ({ request }) => {
    const res = await request.post('/api/auth/register', {
      data: { email: '<script>alert(1)</script>@test.ru', password: STRONG_PASSWORD },
    });
    expect(res.status()).toBe(400);
  });

  test('Ввод скрипта в поля корзины не исполняется в браузере', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const cart = new CartPage(page);
    await cart.open();
    await cart.addProduct('p1');
    for (const payload of ['<script>alert(1)</script>', '<img src=x onerror=alert(2)>', '"><svg onload=alert(3)>']) {
      await cart.applyPromo(payload);
      await expect(cart.message).toContainText('Неверный формат промокода');
    }
    await expect(page.locator('#message img, #message svg, #message script')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('Страница отдаётся с Content-Security-Policy', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
  });
});

test.describe('ЛР6-3. Хранение паролей', () => {
  test('В хранилище лежит хеш scrypt с солью, а не пароль', async () => {
    const auth = createAuth();
    const email = uniqueEmail('hash');
    await auth.register({ email, password: STRONG_PASSWORD });
    await auth.register({ email: uniqueEmail('hash2'), password: STRONG_PASSWORD });

    const [first, second] = [...auth.users.values()];
    expect(first.passwordHash).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(first.passwordHash).not.toContain(STRONG_PASSWORD);
    expect(first.passwordHash).not.toBe(second.passwordHash);
  });

  test('Ни один ответ API не содержит пароль или его хеш', async ({ request }) => {
    const email = uniqueEmail('leak');
    const register = await request.post('/api/auth/register', { data: { email, password: STRONG_PASSWORD } });
    const login = await request.post('/api/auth/login', { data: { email, password: STRONG_PASSWORD } });
    const { token } = await login.json();
    const profile = await request.get('/api/profile', { headers: { Authorization: `Bearer ${token}` } });

    for (const res of [register, login, profile]) {
      const text = await res.text();
      expect(text).not.toContain(STRONG_PASSWORD);
      expect(text).not.toContain('scrypt$');
      expect(text.toLowerCase()).not.toContain('password');
    }
  });
});

test.describe('ЛР6-4. Доступ без авторизации', () => {
  for (const [method, path] of [['get', '/api/profile'], ['get', '/api/orders'], ['post', '/api/auth/logout']]) {
    test(`${method.toUpperCase()} ${path} без токена → 401`, async ({ request }) => {
      const res = await request[method](path);
      expect(res.status()).toBe(401);
    });
  }

  test('Токен одного пользователя не показывает заказы другого', async ({ request }) => {
    const alice = await registerAndLogin(request);
    const bob = await registerAndLogin(request);
    const aliceHeaders = sessionHeaders(newSessionId(), alice.token);
    await request.post('/api/cart/items', { headers: aliceHeaders, data: { productId: 'p1', quantity: 1 } });
    await request.post('/api/checkout', { headers: aliceHeaders, data: {} });

    const bobOrders = await request.get('/api/orders', { headers: { Authorization: `Bearer ${bob.token}` } });
    expect((await bobOrders.json()).orders).toEqual([]);
  });

  test('Корзина недоступна без идентификатора сессии', async ({ request }) => {
    const missing = await request.get('/api/cart');
    const weak = await request.get('/api/cart', { headers: { 'X-Session-Id': '1' } });
    expect(missing.status()).toBe(400);
    expect(weak.status()).toBe(400);
  });

  test('Две сессии не видят корзины друг друга', async ({ request }) => {
    const a = sessionHeaders(newSessionId());
    const b = sessionHeaders(newSessionId());
    await request.post('/api/cart/items', { headers: a, data: { productId: 'p2', quantity: 3 } });
    const cartB = await (await request.get('/api/cart', { headers: b })).json();
    expect(cartB.items).toEqual([]);
  });
});

test.describe('ЛР6-5. Политика паролей', () => {
  for (const [title, password, emailLocal] of [
    ['короче 8 символов', 'Abc1234', null],
    ['только буквы', 'abcdefghij', null],
    ['только цифры', '1234567890', null],
    ['из списка распространённых', 'Password1', null],
    ['совпадает с именем в email', 'ivanov2026', 'ivanov2026'],
    ['содержит имя из email', 'Ivanov2026!', 'ivanov2026'],
    ['длиннее 64 символов', `A1${'x'.repeat(63)}`, null],
  ]) {
    test(`Пароль ${title} отклоняется`, async ({ request }) => {
      const email = emailLocal ? `${emailLocal}@test${Date.now()}.ru` : uniqueEmail('weak');
      const res = await request.post('/api/auth/register', { data: { email, password } });
      expect(res.status()).toBe(400);
    });
  }
});

test.describe('ЛР6-6. Утечка данных в ответах', () => {
  test('Битый JSON → 400 без стека и путей', async ({ request }) => {
    const res = await request.post('/api/cart/items', {
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': newSessionId() },
      data: '{bad json',
    });
    expect(res.status()).toBe(400);
    expect(res.headers()['content-type']).toContain('application/json');
    expectNoLeak(await res.text());
  });

  test('Слишком большое тело → 413 без стека', async ({ request }) => {
    const res = await request.post('/api/auth/register', {
      data: { email: uniqueEmail('big'), password: 'x'.repeat(20_000) },
    });
    expect(res.status()).toBe(413);
    expectNoLeak(await res.text());
  });

  test('Неизвестный адрес → 404 JSON без имени фреймворка', async ({ request }) => {
    const res = await request.get('/api/admin');
    expect(res.status()).toBe(404);
    expectNoLeak(await res.text());
  });

  test('Нет заголовка X-Powered-By, есть защитные заголовки', async ({ request }) => {
    for (const path of ['/', '/api/products']) {
      const headers = (await request.get(path)).headers();
      expect(headers['x-powered-by']).toBeUndefined();
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
    }
    const api = (await request.get('/api/products')).headers();
    expect(api['cache-control']).toBe('no-store');
  });

  test('Ответ на вход одинаков для чужого и несуществующего email', async ({ request }) => {
    const { email } = await registerUser(request);
    const wrongPassword = await request.post('/api/auth/login', { data: { email, password: 'Wrong2026pass' } });
    const noUser = await request.post('/api/auth/login', {
      data: { email: uniqueEmail('nobody'), password: 'Wrong2026pass' },
    });
    expect(wrongPassword.status()).toBe(noUser.status());
    expect(await wrongPassword.json()).toEqual(await noUser.json());
  });
});

test.describe('ЛР6-7. Cookie и HTTPS', () => {
  test('Приложение не ставит cookie: сессия передаётся заголовком', async ({ request }) => {
    const { token } = await registerAndLogin(request);
    const responses = await Promise.all([
      request.get('/'),
      request.get('/api/cart', { headers: sessionHeaders(newSessionId()) }),
      request.get('/api/profile', { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    for (const res of responses) expect(res.headers()['set-cookie']).toBeUndefined();
  });
});

test.describe('ЛР6. Известные открытые риски', () => {
  test('После 10 неверных паролей вход блокируется (429)', async ({ request }) => {
    test.fail(true, 'Находка S-07: ограничения попыток входа нет, подбор пароля не блокируется');
    const { email } = await registerUser(request);
    const statuses = [];
    for (let i = 0; i < 10; i += 1) {
      const res = await request.post('/api/auth/login', { data: { email, password: `Wrong${i}pass2026` } });
      statuses.push(res.status());
    }
    expect(statuses).toContain(429);
  });
});
