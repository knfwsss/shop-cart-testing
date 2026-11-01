import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
export const PASSWORD = 'Load2026secure';
export const USERS = Number(__ENV.USERS || 40);

export const ordersCreated = new Counter('orders_created');
export const flowDuration = new Trend('shop_flow_duration', true);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// SLA из ЛР1: пересчёт корзины и оформление ≤ 1 с; берём строже — p95 ≤ 500 мс.
export const SLA_THRESHOLDS = {
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  'http_req_duration{name:catalog}': ['p(95)<300'],
  'http_req_duration{name:add_item}': ['p(95)<500'],
  'http_req_duration{name:checkout}': ['p(95)<500'],
  'http_req_duration{name:login}': ['p(95)<1000'],
  shop_flow_duration: ['p(95)<6000'],
};

export function sessionId() {
  const vu = exec.vu.idInTest;
  const iter = exec.vu.iterationInScenario;
  return `k6-${vu}-${iter}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function registerUsers() {
  const runTag = Date.now();
  const users = [];
  for (let i = 0; i < USERS; i += 1) {
    const email = `load.${runTag}.${i}@test.ru`;
    const res = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({ email, password: PASSWORD }), {
      headers: JSON_HEADERS,
      tags: { name: 'setup_register' },
    });
    if (res.status !== 201) throw new Error(`Регистрация ${email} не удалась: ${res.status} ${res.body}`);
    users.push(email);
  }
  return { users };
}

// Сценарий 1 (лёгкий): покупатель открывает магазин и смотрит каталог.
export function browse() {
  const headers = { 'X-Session-Id': sessionId() };

  const page = http.get(`${BASE_URL}/`, { tags: { name: 'index' } });
  check(page, { 'главная: 200': (r) => r.status === 200 });

  const health = http.get(`${BASE_URL}/api/health`, { tags: { name: 'health' } });
  check(health, { 'health: ok': (r) => r.status === 200 });

  const catalog = http.get(`${BASE_URL}/api/products`, { tags: { name: 'catalog' } });
  check(catalog, {
    'каталог: 200': (r) => r.status === 200,
    'каталог: 4 товара': (r) => r.json().length === 4,
  });

  const cart = http.get(`${BASE_URL}/api/cart`, { headers, tags: { name: 'get_cart' } });
  check(cart, { 'корзина: пустая': (r) => r.status === 200 && r.json().items.length === 0 });

  sleep(1);
}

// Сценарий 2 (бизнес): вход → товар → количество → промокод → оформление → история заказов.
export function shop(data) {
  const started = Date.now();
  const email = data.users[(exec.vu.idInTest - 1) % data.users.length];
  const session = { ...JSON_HEADERS, 'X-Session-Id': sessionId() };

  const login = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: JSON_HEADERS,
    tags: { name: 'login' },
  });
  const loggedIn = check(login, { 'вход: 200 и токен': (r) => r.status === 200 && !!r.json().token });
  if (!loggedIn) return;
  const authed = { ...session, Authorization: `Bearer ${login.json().token}` };
  sleep(0.5);

  const add = http.post(`${BASE_URL}/api/cart/items`, JSON.stringify({ productId: 'p1', quantity: 1 }), {
    headers: session,
    tags: { name: 'add_item' },
  });
  check(add, { 'товар добавлен': (r) => r.status === 200 && r.json().total === 2990 });
  sleep(0.5);

  const qty = http.patch(`${BASE_URL}/api/cart/items/p1`, JSON.stringify({ quantity: 2 }), {
    headers: session,
    tags: { name: 'update_qty' },
  });
  check(qty, { 'количество 2': (r) => r.status === 200 && r.json().subtotal === 5980 });
  sleep(0.5);

  const promo = http.post(`${BASE_URL}/api/cart/promo`, JSON.stringify({ code: 'SALE10' }), {
    headers: session,
    tags: { name: 'apply_promo' },
  });
  check(promo, { 'промокод: итог 5382': (r) => r.status === 200 && r.json().total === 5382 });
  sleep(0.5);

  const order = http.post(`${BASE_URL}/api/checkout`, JSON.stringify({ total: 5382 }), {
    headers: authed,
    tags: { name: 'checkout' },
  });
  const ordered = check(order, { 'заказ: 201 и номер': (r) => r.status === 201 && /^ORD-/.test(r.json().id) });
  if (ordered) ordersCreated.add(1);

  const history = http.get(`${BASE_URL}/api/orders`, { headers: authed, tags: { name: 'orders' } });
  check(history, { 'история: 200': (r) => r.status === 200 });

  flowDuration.add(Date.now() - started);
  sleep(1);
}
