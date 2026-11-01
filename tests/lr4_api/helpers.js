const crypto = require('crypto');
const { expect } = require('@playwright/test');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const schemas = {
  error: require('./schemas/error.schema.json'),
  products: require('./schemas/products.schema.json'),
  cart: require('./schemas/cart.schema.json'),
  order: require('./schemas/order.schema.json'),
  user: require('./schemas/user.schema.json'),
  login: require('./schemas/login.schema.json'),
  profile: require('./schemas/profile.schema.json'),
};
const validators = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]),
);

const STRONG_PASSWORD = 'Cart2026secure';

function newSessionId() {
  return crypto.randomUUID();
}

function uniqueEmail(prefix = 'user') {
  return `${prefix}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}@test.ru`;
}

function sessionHeaders(sessionId, token) {
  const headers = { 'X-Session-Id': sessionId };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function registerUser(request, email = uniqueEmail(), password = STRONG_PASSWORD) {
  const res = await request.post('/api/auth/register', { data: { email, password } });
  expect(res.status(), await res.text()).toBe(201);
  return { email, password, user: await res.json() };
}

async function registerAndLogin(request) {
  const { email, password, user } = await registerUser(request);
  const res = await request.post('/api/auth/login', { data: { email, password } });
  expect(res.status()).toBe(200);
  const { token } = await res.json();
  return { email, password, user, token };
}

function expectSchema(body, name) {
  const validate = validators[name];
  const ok = validate(body);
  expect(ok, `Ответ не соответствует схеме ${name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
}

module.exports = {
  STRONG_PASSWORD,
  newSessionId,
  uniqueEmail,
  sessionHeaders,
  registerUser,
  registerAndLogin,
  expectSchema,
};
