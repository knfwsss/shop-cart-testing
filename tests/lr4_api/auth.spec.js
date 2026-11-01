const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { createApp } = require('../../src/app');
const {
  STRONG_PASSWORD,
  uniqueEmail,
  registerUser,
  registerAndLogin,
  expectSchema,
} = require('./helpers');

test.describe('ЛР4. Регистрация, вход и защищённые ресурсы', () => {
  test('1. Регистрация с валидными данными → 201 и данные пользователя', async ({ request }) => {
    const email = uniqueEmail('new');
    const res = await request.post('/api/auth/register', { data: { email, password: STRONG_PASSWORD } });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expectSchema(body, 'user');
    expect(body.email).toBe(email);
    expect(JSON.stringify(body)).not.toContain(STRONG_PASSWORD);
  });

  for (const badEmail of ['user-mail.ru', 'user@', '@mail.ru', 'user@mail', 'user name@mail.ru']) {
    test(`2. Невалидный email «${badEmail}» → 400`, async ({ request }) => {
      const res = await request.post('/api/auth/register', {
        data: { email: badEmail, password: STRONG_PASSWORD },
      });
      expect(res.status()).toBe(400);
      expectSchema(await res.json(), 'error');
    });
  }

  test('3. Повторная регистрация того же email → 409', async ({ request }) => {
    const { email } = await registerUser(request);
    const res = await request.post('/api/auth/register', {
      data: { email: email.toUpperCase(), password: STRONG_PASSWORD },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('уже зарегистрирован');
  });

  test('4. Успешный вход → 200 и токен', async ({ request }) => {
    const { email, password } = await registerUser(request);
    const res = await request.post('/api/auth/login', { data: { email, password } });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expectSchema(body, 'login');
    expect(body.tokenType).toBe('Bearer');
  });

  test('5. Вход с неверным паролем → 401', async ({ request }) => {
    const { email } = await registerUser(request);
    const res = await request.post('/api/auth/login', { data: { email, password: 'Wrong2026pass' } });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('Неверный email или пароль');
  });

  test('5a. Вход с несуществующим email → 401 с тем же текстом', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: uniqueEmail('ghost'), password: STRONG_PASSWORD },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('Неверный email или пароль');
  });

  test('6. Профиль без токена → 401', async ({ request }) => {
    const res = await request.get('/api/profile');
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('Требуется авторизация');
  });

  test('6a. История заказов без токена → 401', async ({ request }) => {
    const res = await request.get('/api/orders');
    expect(res.status()).toBe(401);
  });

  for (const [title, header] of [
    ['случайная строка', 'Bearer abc'],
    ['чужой формат', 'Basic dXNlcjpwYXNz'],
    ['64 hex, но не выданный сервером', `Bearer ${'a'.repeat(64)}`],
  ]) {
    test(`7. Невалидный токен (${title}) → 401`, async ({ request }) => {
      const res = await request.get('/api/profile', { headers: { Authorization: header } });
      expect(res.status()).toBe(401);
      expect((await res.json()).error).toBe('Недействительный или просроченный токен');
    });
  }

  test('7a. Просроченный токен → 401', async () => {
    let clock = Date.now();
    const app = createApp({ tokenTtlMs: 60_000, now: () => clock });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const ctx = await playwrightRequest.newContext({
      baseURL: `http://127.0.0.1:${server.address().port}`,
    });
    try {
      const { token } = await registerAndLogin(ctx);
      const auth = { Authorization: `Bearer ${token}` };

      expect((await ctx.get('/api/profile', { headers: auth })).status()).toBe(200);
      clock += 60_001;
      const expired = await ctx.get('/api/profile', { headers: auth });
      expect(expired.status()).toBe(401);
      expect((await expired.json()).error).toBe('Недействительный или просроченный токен');
    } finally {
      await ctx.dispose();
      server.close();
    }
  });

  test('7b. Токен после выхода больше не работает', async ({ request }) => {
    const { token } = await registerAndLogin(request);
    const auth = { Authorization: `Bearer ${token}` };

    expect((await request.post('/api/auth/logout', { headers: auth })).status()).toBe(204);
    expect((await request.get('/api/profile', { headers: auth })).status()).toBe(401);
  });

  test('Профиль с токеном → 200, без пароля и хеша', async ({ request }) => {
    const { email, token } = await registerAndLogin(request);
    const res = await request.get('/api/profile', { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expectSchema(body, 'profile');
    expect(body.email).toBe(email);
    expect(body.ordersCount).toBe(0);
  });
});

test.describe('ЛР4. Граничные значения регистрации', () => {
  const passwordOf = (length) => `A1${'b'.repeat(length - 2)}`;

  for (const [length, status] of [[7, 400], [8, 201], [9, 201], [63, 201], [64, 201], [65, 400]]) {
    test(`8. Пароль длиной ${length} → ${status}`, async ({ request }) => {
      const res = await request.post('/api/auth/register', {
        data: { email: uniqueEmail(`len${length}`), password: passwordOf(length) },
      });
      expect(res.status()).toBe(status);
    });
  }

  test('8. Email длиной 254 символа принимается, 255 — нет', async ({ request }) => {
    const domain = '@test.ru';
    const tag = uniqueEmail('x').split('@')[0].replace(/\W/g, '');
    const make = (length) => `${(tag + 'a'.repeat(length)).slice(0, length - domain.length)}${domain}`;

    const ok = await request.post('/api/auth/register', {
      data: { email: make(254), password: STRONG_PASSWORD },
    });
    const tooLong = await request.post('/api/auth/register', {
      data: { email: make(255), password: STRONG_PASSWORD },
    });
    expect(ok.status()).toBe(201);
    expect(tooLong.status()).toBe(400);
  });

  test('8. Пустое тело регистрации → 400', async ({ request }) => {
    const res = await request.post('/api/auth/register', { data: {} });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Укажите email и пароль');
  });

  test('8. Пустое тело входа → 400', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('8. Тело не JSON → 400, а не ошибка сервера', async ({ request }) => {
    const res = await request.post('/api/auth/register', {
      headers: { 'Content-Type': 'application/json' },
      data: '{"email": "broken',
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Некорректный JSON в теле запроса');
  });
});
