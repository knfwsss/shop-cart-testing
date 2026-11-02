const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { createApp } = require('../../src/app');
const { STRONG_PASSWORD, uniqueEmail } = require('../lr4_api/helpers');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Отдельный сервер с управляемыми часами: блокировку можно «перемотать», не дожидаясь 15 минут.
async function startServer(loginLimits) {
  const clock = { now: Date.now() };
  const events = [];
  const app = createApp({ now: () => clock.now, loginLimits, logSecurityEvent: (m) => events.push(m) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const ctx = await playwrightRequest.newContext({ baseURL: `http://127.0.0.1:${server.address().port}` });
  return {
    ctx,
    clock,
    events,
    async register(email = uniqueEmail('victim')) {
      await ctx.post('/api/auth/register', { data: { email, password: STRONG_PASSWORD } });
      return email;
    },
    login(email, password, headers) {
      return ctx.post('/api/auth/login', { data: { email, password }, headers });
    },
    async close() {
      await ctx.dispose();
      server.close();
    },
  };
}

async function failTimes(srv, email, times) {
  const statuses = [];
  for (let i = 0; i < times; i += 1) statuses.push((await srv.login(email, `Wrong${i}pass2026`)).status());
  return statuses;
}

test.describe('ЛР6-8. Защита от подбора пароля', () => {
  let srv;

  test.afterEach(async () => {
    await srv.close();
  });

  test('5 неверных паролей → 401, шестая попытка → 429 и Retry-After', async () => {
    srv = await startServer();
    const email = await srv.register();

    expect(await failTimes(srv, email, 5)).toEqual([401, 401, 401, 401, 401]);
    const blocked = await srv.login(email, 'Wrong5pass2026');
    expect(blocked.status()).toBe(429);
    expect(blocked.headers()['retry-after']).toBe('900');
    expect((await blocked.json()).error).toBe('Слишком много неудачных попыток входа. Попробуйте позже');
    expect(srv.events).toHaveLength(1);
    expect(srv.events[0]).toContain(email);
  });

  test('Во время блокировки не пускает даже с верным паролем', async () => {
    srv = await startServer();
    const email = await srv.register();
    await failTimes(srv, email, 5);

    const res = await srv.login(email, STRONG_PASSWORD);
    expect(res.status()).toBe(429);
    expect(await res.text()).not.toContain('token');
  });

  test('Через 15 минут блокировка снимается', async () => {
    srv = await startServer();
    const email = await srv.register();
    await failTimes(srv, email, 5);

    srv.clock.now += FIFTEEN_MINUTES - 1000;
    expect((await srv.login(email, STRONG_PASSWORD)).status()).toBe(429);
    srv.clock.now += 2000;
    expect((await srv.login(email, STRONG_PASSWORD)).status()).toBe(200);
  });

  test('Успешный вход обнуляет счётчик ошибок', async () => {
    srv = await startServer();
    const email = await srv.register();

    await failTimes(srv, email, 4);
    expect((await srv.login(email, STRONG_PASSWORD)).status()).toBe(200);
    expect(await failTimes(srv, email, 4)).toEqual([401, 401, 401, 401]);
  });

  test('Несуществующий email блокируется так же — по блокировке не узнать, есть ли аккаунт', async () => {
    srv = await startServer();
    const real = await srv.register();
    const ghost = uniqueEmail('ghost');

    await failTimes(srv, real, 5);
    await failTimes(srv, ghost, 5);
    const [realRes, ghostRes] = [await srv.login(real, 'x1y2z3w4'), await srv.login(ghost, 'x1y2z3w4')];
    expect(realRes.status()).toBe(429);
    expect(ghostRes.status()).toBe(429);
    expect(await realRes.json()).toEqual(await ghostRes.json());
  });

  test('Блокировка одного аккаунта не мешает другим', async () => {
    srv = await startServer();
    const victim = await srv.register();
    const other = await srv.register(uniqueEmail('other'));
    await failTimes(srv, victim, 5);

    expect((await srv.login(other, STRONG_PASSWORD)).status()).toBe(200);
  });

  test('Перебор одного пароля по многим аккаунтам с одного IP блокируется', async () => {
    srv = await startServer({ maxFailuresPerIp: 10 });
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await srv.login(uniqueEmail(`spray${i}`), 'Summer2026')).status());
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  test('Подмена IP через X-Forwarded-For не обходит блокировку', async () => {
    srv = await startServer({ maxFailuresPerIp: 10 });
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await srv.login(uniqueEmail(`xff${i}`), 'Summer2026', { 'X-Forwarded-For': `10.0.0.${i}` });
      statuses.push(res.status());
    }
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
