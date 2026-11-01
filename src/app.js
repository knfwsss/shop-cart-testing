const express = require('express');
const path = require('path');
const { listProducts } = require('./products');
const {
  createEmptyCart,
  addItem,
  updateQuantity,
  applyPromo,
  removePromo,
  calculateTotals,
  checkout,
} = require('./cart');
const { createAuth } = require('./auth');

const SESSION_ID_RE = /^[A-Za-z0-9-]{16,64}$/;

const ROUTES = [
  ['/api/health', ['GET']],
  ['/api/products', ['GET']],
  ['/api/cart', ['GET']],
  ['/api/cart/items', ['POST']],
  ['/api/cart/items/:productId', ['PATCH']],
  ['/api/cart/promo', ['POST', 'DELETE']],
  ['/api/cart/reset', ['POST']],
  ['/api/checkout', ['POST']],
  ['/api/auth/register', ['POST']],
  ['/api/auth/login', ['POST']],
  ['/api/auth/logout', ['POST']],
  ['/api/profile', ['GET']],
  ['/api/orders', ['GET']],
];

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
}

function cartResponse(cart) {
  return {
    items: cart.items,
    promoCode: cart.promoCode,
    promoApplied: cart.promoApplied,
    ...calculateTotals(cart),
  };
}

function createApp({ tokenTtlMs, now } = {}) {
  const app = express();
  const auth = createAuth({ tokenTtlMs, now });
  const sessions = new Map();
  const ordersByUser = new Map();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  function withSession(req, res, next) {
    const sid = req.get('X-Session-Id');
    if (!sid) return res.status(400).json({ error: 'Не передан заголовок X-Session-Id' });
    if (!SESSION_ID_RE.test(sid)) return res.status(400).json({ error: 'Некорректный X-Session-Id' });
    if (!sessions.has(sid)) sessions.set(sid, createEmptyCart());
    req.sessionId = sid;
    req.cart = sessions.get(sid);
    next();
  }

  function requireAuth(req, res, next) {
    const result = auth.authenticate(req.get('Authorization'));
    if (!result.ok) return res.status(401).json({ error: result.error });
    req.user = result.user;
    req.token = result.token;
    next();
  }

  function optionalAuth(req, res, next) {
    if (!req.get('Authorization')) return next();
    return requireAuth(req, res, next);
  }

  function sendCartResult(req, res, result) {
    if (!result.ok) return res.status(400).json({ error: result.error });
    sessions.set(req.sessionId, result.cart);
    return res.json(cartResponse(result.cart));
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/products', (_req, res) => {
    res.json(listProducts());
  });

  app.get('/api/cart', withSession, (req, res) => {
    res.json(cartResponse(req.cart));
  });

  app.post('/api/cart/items', withSession, (req, res) => {
    const { productId, quantity = 1 } = req.body || {};
    sendCartResult(req, res, addItem(req.cart, productId, quantity));
  });

  app.patch('/api/cart/items/:productId', withSession, (req, res) => {
    const { quantity } = req.body || {};
    sendCartResult(req, res, updateQuantity(req.cart, req.params.productId, quantity));
  });

  app.post('/api/cart/promo', withSession, (req, res) => {
    const { code } = req.body || {};
    sendCartResult(req, res, applyPromo(req.cart, code));
  });

  app.delete('/api/cart/promo', withSession, (req, res) => {
    sendCartResult(req, res, removePromo(req.cart));
  });

  app.post('/api/cart/reset', withSession, (req, res) => {
    sessions.set(req.sessionId, createEmptyCart());
    res.json({ ok: true });
  });

  app.post('/api/checkout', withSession, optionalAuth, (req, res) => {
    const clientTotal = req.body?.total;
    const serverTotals = calculateTotals(req.cart);
    if (clientTotal !== undefined && clientTotal !== serverTotals.total) {
      return res.status(400).json({
        error: 'Сумма заказа не совпадает с серверным расчётом',
        expectedTotal: serverTotals.total,
      });
    }

    const result = checkout(req.cart);
    if (!result.ok) return res.status(400).json({ error: result.error });

    if (req.user) {
      const orders = ordersByUser.get(req.user.id) || [];
      orders.push(result.order);
      ordersByUser.set(req.user.id, orders);
    }
    sessions.set(req.sessionId, createEmptyCart());
    return res.status(201).json(result.order);
  });

  app.post('/api/auth/register', (req, res, next) => {
    auth.register(req.body).then((result) => {
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.status(201).json(result.user);
    }, next);
  });

  app.post('/api/auth/login', (req, res, next) => {
    auth.login(req.body).then((result) => {
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json(result.body);
    }, next);
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    auth.logout(req.token);
    res.status(204).end();
  });

  app.get('/api/profile', requireAuth, (req, res) => {
    const orders = ordersByUser.get(req.user.id) || [];
    res.json({ ...req.user, ordersCount: orders.length });
  });

  app.get('/api/orders', requireAuth, (req, res) => {
    res.json({ orders: ordersByUser.get(req.user.id) || [] });
  });

  for (const [route, methods] of ROUTES) {
    const allow = methods.includes('GET') ? [...methods, 'HEAD'] : methods;
    app.all(route, (req, res) => {
      res.set('Allow', allow.join(', '));
      if (req.method === 'OPTIONS') return res.status(204).end();
      return res.status(405).json({ error: `Метод ${req.method} не поддерживается` });
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ресурс не найден' });
  });

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Страница не найдена');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Слишком большое тело запроса' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  app.locals.resetSessions = () => sessions.clear();
  app.locals.auth = auth;
  return app;
}

module.exports = { createApp, SESSION_ID_RE };
