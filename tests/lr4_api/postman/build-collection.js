// Собирает Postman-коллекцию (формат v2.1) из описания ниже.
// Запуск: node tests/lr4_api/postman/build-collection.js
const fs = require('fs');
const path = require('path');

const json = { key: 'Content-Type', value: 'application/json' };
const session = { key: 'X-Session-Id', value: '{{sessionId}}' };
const bearer = { key: 'Authorization', value: 'Bearer {{token}}' };

const requests = [
  {
    name: '01 Health-check',
    method: 'GET', url: '/api/health',
    tests: ['status(200)', "pm.test('status ok', () => pm.expect(pm.response.json().status).to.eql('ok'));"],
  },
  {
    name: '02 Каталог товаров',
    method: 'GET', url: '/api/products',
    tests: [
      'status(200)',
      "pm.test('4 товара с ценой', () => { const p = pm.response.json(); pm.expect(p).to.have.length(4); p.forEach((x) => pm.expect(x.price).to.be.above(0)); });",
    ],
  },
  {
    name: '03 Регистрация (positive)',
    method: 'POST', url: '/api/auth/register', headers: [json],
    prerequest: [
      "pm.collectionVariables.set('email', `postman.${Date.now()}@test.ru`);",
    ],
    body: { email: '{{email}}', password: '{{password}}' },
    tests: [
      'status(201)',
      "pm.test('в ответе нет пароля', () => pm.expect(pm.response.text()).to.not.include(pm.collectionVariables.get('password')));",
      "pm.test('email совпадает', () => pm.expect(pm.response.json().email).to.eql(pm.collectionVariables.get('email')));",
    ],
  },
  {
    name: '04 Регистрация того же email (409)',
    method: 'POST', url: '/api/auth/register', headers: [json],
    body: { email: '{{email}}', password: '{{password}}' }, tests: ['status(409)'],
  },
  {
    name: '05 Регистрация с email без @ (400)',
    method: 'POST', url: '/api/auth/register', headers: [json],
    body: { email: 'postman-test.ru', password: '{{password}}' }, tests: ['status(400)'],
  },
  {
    name: '06 Регистрация с паролем из 7 символов (400)',
    method: 'POST', url: '/api/auth/register', headers: [json],
    body: { email: 'short.{{$timestamp}}@test.ru', password: 'Abc1234' }, tests: ['status(400)'],
  },
  {
    name: '07 Вход (200 + токен)',
    method: 'POST', url: '/api/auth/login', headers: [json],
    body: { email: '{{email}}', password: '{{password}}' },
    tests: [
      'status(200)',
      "pm.test('выдан токен', () => { const t = pm.response.json().token; pm.expect(t).to.match(/^[a-f0-9]{64}$/); pm.collectionVariables.set('token', t); });",
    ],
  },
  {
    name: '08 Вход с неверным паролем (401)',
    method: 'POST', url: '/api/auth/login', headers: [json],
    body: { email: '{{email}}', password: 'Wrong2026pass' }, tests: ['status(401)'],
  },
  {
    name: '09 Профиль без токена (401)',
    method: 'GET', url: '/api/profile', tests: ['status(401)'],
  },
  {
    name: '10 Профиль с поддельным токеном (401)',
    method: 'GET', url: '/api/profile',
    headers: [{ key: 'Authorization', value: 'Bearer 0000000000000000000000000000000000000000000000000000000000000000' }],
    tests: ['status(401)'],
  },
  {
    name: '11 Профиль с токеном (200)',
    method: 'GET', url: '/api/profile', headers: [bearer],
    tests: [
      'status(200)',
      "pm.test('нет полей пароля', () => { const b = pm.response.json(); pm.expect(b).to.not.have.property('password'); pm.expect(b).to.not.have.property('passwordHash'); });",
    ],
  },
  {
    name: '12 Добавить наушники в корзину',
    method: 'POST', url: '/api/cart/items', headers: [json, session],
    body: { productId: 'p1', quantity: 1 },
    tests: ['status(200)', "pm.test('сумма 2990', () => pm.expect(pm.response.json().total).to.eql(2990));"],
  },
  {
    name: '13 Добавить товар без остатка (400)',
    method: 'POST', url: '/api/cart/items', headers: [json, session],
    body: { productId: 'p3', quantity: 1 }, tests: ['status(400)'],
  },
  {
    name: '14 Количество 16 при остатке 15 (400)',
    method: 'PATCH', url: '/api/cart/items/p1', headers: [json, session],
    body: { quantity: 16 }, tests: ['status(400)'],
  },
  {
    name: '15 Промокод EXPIRED (400)',
    method: 'POST', url: '/api/cart/promo', headers: [json, session],
    body: { code: 'EXPIRED' }, tests: ['status(400)'],
  },
  {
    name: '16 Промокод SALE10 (200)',
    method: 'POST', url: '/api/cart/promo', headers: [json, session],
    body: { code: 'SALE10' },
    tests: ['status(200)', "pm.test('итог 2691', () => pm.expect(pm.response.json().total).to.eql(2691));"],
  },
  {
    name: '17 Оформление с подменённой суммой (400)',
    method: 'POST', url: '/api/checkout', headers: [json, session],
    body: { total: 1 },
    tests: ['status(400)', "pm.test('сервер называет верную сумму', () => pm.expect(pm.response.json().expectedTotal).to.eql(2691));"],
  },
  {
    name: '18 Оформление с токеном (201)',
    method: 'POST', url: '/api/checkout', headers: [json, session, bearer],
    body: { total: 2691 },
    tests: [
      'status(201)',
      "pm.test('номер заказа', () => { const id = pm.response.json().id; pm.expect(id).to.match(/^ORD-/); pm.collectionVariables.set('orderId', id); });",
    ],
  },
  {
    name: '19 История заказов (200)',
    method: 'GET', url: '/api/orders', headers: [bearer],
    tests: [
      'status(200)',
      "pm.test('заказ в истории', () => pm.expect(pm.response.json().orders.map((o) => o.id)).to.include(pm.collectionVariables.get('orderId')));",
    ],
  },
  {
    name: '20 Несуществующий endpoint (404)',
    method: 'GET', url: '/api/does-not-exist', tests: ['status(404)'],
  },
  {
    name: '21 Неподдерживаемый метод DELETE /api/products (405)',
    method: 'DELETE', url: '/api/products',
    tests: ['status(405)', "pm.test('заголовок Allow', () => pm.expect(pm.response.headers.get('Allow')).to.eql('GET, HEAD'));"],
  },
  {
    name: '22 Выход (204)',
    method: 'POST', url: '/api/auth/logout', headers: [bearer], tests: ['status(204)'],
  },
  {
    name: '23 Профиль со старым токеном после выхода (401)',
    method: 'GET', url: '/api/profile', headers: [bearer], tests: ['status(401)'],
  },
];

function testScript(lines) {
  return lines.map((line) => {
    const m = /^status\((\d+)\)$/.exec(line);
    return m ? `pm.test('статус ${m[1]}', () => pm.response.to.have.status(${m[1]}));` : line;
  });
}

function toItem(r) {
  const event = [{ listen: 'test', script: { type: 'text/javascript', exec: testScript(r.tests) } }];
  if (r.prerequest) event.unshift({ listen: 'prerequest', script: { type: 'text/javascript', exec: r.prerequest } });
  const segments = r.url.replace(/^\//, '').split('/');
  return {
    name: r.name,
    event,
    request: {
      method: r.method,
      header: r.headers || [],
      ...(r.body && { body: { mode: 'raw', raw: JSON.stringify(r.body, null, 2), options: { raw: { language: 'json' } } } }),
      url: { raw: `{{baseUrl}}${r.url}`, host: ['{{baseUrl}}'], path: segments },
    },
  };
}

const collection = {
  info: {
    name: 'Корзина интернет-магазина — ЛР4',
    description: 'Ручные и автоматизированные запросы к API корзины: positive, negative, boundary, security.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: [{
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        "if (!pm.collectionVariables.get('sessionId')) {",
        "  pm.collectionVariables.set('sessionId', pm.variables.replaceIn('{{$guid}}'));",
        '}',
      ],
    },
  }],
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000' },
    { key: 'password', value: 'Cart2026secure' },
    { key: 'email', value: '' },
    { key: 'token', value: '' },
    { key: 'sessionId', value: '' },
    { key: 'orderId', value: '' },
  ],
  item: requests.map(toItem),
};

const out = path.join(__dirname, 'shop-cart.postman_collection.json');
fs.writeFileSync(out, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`Коллекция: ${out} (${requests.length} запросов)`);
