const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 64;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
const COMMON_PASSWORDS = new Set([
  'password1', 'password123', 'qwerty123', 'qwerty1234', '12345678a', '123456789a',
  'admin123', 'admin1234', 'iloveyou1', 'abc12345', '1q2w3e4r', '1qaz2wsx', 'qwertyuiop1',
]);
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;
const DEFAULT_LOGIN_LIMITS = {
  maxFailuresPerEmail: 5,
  maxFailuresPerIp: 100,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
};
const LOCKED_MESSAGE = 'Слишком много неудачных попыток входа. Попробуйте позже';

function validateEmail(email) {
  if (typeof email !== 'string' || email.length === 0) return 'Укажите email';
  if (email.length > EMAIL_MAX) return `Email длиннее ${EMAIL_MAX} символов`;
  if (!EMAIL_RE.test(email)) return 'Некорректный email';
  return null;
}

function validatePassword(password, email) {
  if (typeof password !== 'string' || password.length === 0) return 'Укажите пароль';
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `Пароль должен быть от ${PASSWORD_MIN} до ${PASSWORD_MAX} символов`;
  }
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) {
    return 'Пароль должен содержать букву и цифру';
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'Пароль слишком распространённый';
  const localPart = String(email).toLowerCase().split('@')[0];
  if (lower === String(email).toLowerCase() || (localPart.length >= 4 && lower.includes(localPart))) {
    return 'Пароль не должен совпадать с email';
  }
  return null;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [, saltHex, keyHex] = stored.split('$');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function publicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function createAuth({
  tokenTtlMs = DEFAULT_TOKEN_TTL_MS,
  now = Date.now,
  loginLimits = {},
  logSecurityEvent = (message) => console.warn(`[security] ${message}`),
} = {}) {
  const users = new Map();
  const tokens = new Map();
  const limits = { ...DEFAULT_LOGIN_LIMITS, ...loginLimits };
  const failures = new Map();

  function lockedUntil(key) {
    const record = failures.get(key);
    return record && record.lockedUntil > now() ? record.lockedUntil : 0;
  }

  // Возвращает true, если эта неудачная попытка превысила лимит и ключ заблокирован.
  function recordFailure(key, max) {
    const t = now();
    let record = failures.get(key);
    if (!record || t - record.windowStart > limits.windowMs) {
      record = { count: 0, windowStart: t, lockedUntil: 0 };
    }
    record.count += 1;
    const locked = record.count >= max;
    if (locked) record.lockedUntil = t + limits.lockMs;
    failures.set(key, record);
    return locked;
  }

  function registerFailure(email, ip) {
    if (recordFailure(`email:${email}`, limits.maxFailuresPerEmail)) {
      logSecurityEvent(`вход для ${email} заблокирован после ${limits.maxFailuresPerEmail} неверных паролей, IP ${ip}`);
    }
    if (recordFailure(`ip:${ip}`, limits.maxFailuresPerIp)) {
      logSecurityEvent(`вход с IP ${ip} заблокирован после ${limits.maxFailuresPerIp} неудачных попыток`);
    }
  }
  // Хеш-заглушка: вход с несуществующим email тратит столько же времени, сколько с существующим.
  const dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));

  async function register(body) {
    const { email, password } = body || {};
    if (email === undefined && password === undefined) {
      return { status: 400, error: 'Укажите email и пароль' };
    }
    const emailError = validateEmail(email);
    if (emailError) return { status: 400, error: emailError };
    const passwordError = validatePassword(password, email);
    if (passwordError) return { status: 400, error: passwordError };

    const key = email.toLowerCase();
    if (users.has(key)) {
      return { status: 409, error: 'Пользователь с таким email уже зарегистрирован' };
    }
    const user = {
      id: crypto.randomUUID(),
      email: key,
      passwordHash: await hashPassword(password),
      createdAt: new Date(now()).toISOString(),
    };
    // Пока считался хеш, этот же email мог успеть зарегистрироваться параллельным запросом.
    if (users.has(key)) {
      return { status: 409, error: 'Пользователь с таким email уже зарегистрирован' };
    }
    users.set(key, user);
    return { status: 201, user: publicUser(user) };
  }

  async function login(body, { ip = 'unknown' } = {}) {
    const { email, password } = body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return { status: 400, error: 'Укажите email и пароль' };
    }
    const key = email.toLowerCase();
    // Блокировка действует и для несуществующих email, иначе по ней можно узнать, есть ли аккаунт.
    const until = Math.max(lockedUntil(`email:${key}`), lockedUntil(`ip:${ip}`));
    if (until) {
      return { status: 429, error: LOCKED_MESSAGE, retryAfter: Math.ceil((until - now()) / 1000) };
    }

    const user = users.get(key);
    let ok = false;
    if (user) ok = await verifyPassword(password, user.passwordHash);
    else await verifyPassword(password, await dummyHashPromise);
    if (!ok) {
      registerFailure(key, ip);
      return { status: 401, error: 'Неверный email или пароль' };
    }
    failures.delete(`email:${key}`);

    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, { userId: user.id, email: user.email, expiresAt: now() + tokenTtlMs });
    return {
      status: 200,
      body: { token, tokenType: 'Bearer', expiresIn: Math.floor(tokenTtlMs / 1000) },
    };
  }

  function authenticate(authorizationHeader) {
    if (!authorizationHeader) return { ok: false, error: 'Требуется авторизация' };
    const match = /^Bearer ([a-f0-9]{64})$/.exec(authorizationHeader);
    const record = match && tokens.get(match[1]);
    if (!record) return { ok: false, error: 'Недействительный или просроченный токен' };
    if (record.expiresAt <= now()) {
      tokens.delete(match[1]);
      return { ok: false, error: 'Недействительный или просроченный токен' };
    }
    return { ok: true, token: match[1], user: publicUser(users.get(record.email)) };
  }

  function logout(token) {
    tokens.delete(token);
  }

  return { register, login, authenticate, logout, users };
}

module.exports = {
  createAuth,
  validateEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  PASSWORD_MIN,
  PASSWORD_MAX,
  EMAIL_MAX,
};
