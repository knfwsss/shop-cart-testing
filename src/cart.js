const crypto = require('crypto');
const { getProduct } = require('./products');
const { validatePromoCode } = require('./promo');

function createEmptyCart() {
  return {
    items: [],
    promoCode: null,
    promoApplied: false,
  };
}

function addItem(cart, productId, quantity = 1) {
  const product = getProduct(productId);
  if (!product) {
    return { ok: false, error: 'Товар не найден', cart };
  }
  if (product.stock <= 0) {
    return { ok: false, error: 'Товар отсутствует на складе', cart };
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, error: 'Количество должно быть целым числом ≥ 1', cart };
  }
  if (quantity > product.stock) {
    return { ok: false, error: `Доступно только ${product.stock} шт.`, cart };
  }

  const next = cloneCart(cart);
  const existing = next.items.find((i) => i.productId === productId);
  const newQty = (existing?.quantity || 0) + quantity;

  if (newQty > product.stock) {
    return { ok: false, error: `Доступно только ${product.stock} шт.`, cart };
  }

  if (existing) {
    existing.quantity = newQty;
  } else {
    next.items.push({
      productId,
      name: product.name,
      unitPrice: product.price,
      quantity: newQty,
    });
  }

  return { ok: true, cart: next };
}

function updateQuantity(cart, productId, quantity) {
  const product = getProduct(productId);
  if (!product) {
    return { ok: false, error: 'Товар не найден', cart };
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { ok: false, error: 'Количество должно быть целым числом ≥ 0', cart };
  }

  const next = cloneCart(cart);
  const idx = next.items.findIndex((i) => i.productId === productId);
  if (idx === -1) {
    return { ok: false, error: 'Товар не в корзине', cart };
  }

  if (quantity === 0) {
    next.items.splice(idx, 1);
    return { ok: true, cart: next };
  }

  if (quantity > product.stock) {
    return { ok: false, error: `Доступно только ${product.stock} шт.`, cart };
  }

  next.items[idx].quantity = quantity;
  return { ok: true, cart: next };
}

function applyPromo(cart, code, now = new Date()) {
  const validation = validatePromoCode(code, now);
  if (!validation.valid) {
    return { ok: false, error: validation.error, cart };
  }

  const next = cloneCart(cart);
  next.promoCode = validation.code;
  next.promoApplied = true;
  next.discountPercent = validation.discountPercent;
  return { ok: true, cart: next };
}

function removePromo(cart) {
  const next = cloneCart(cart);
  next.promoCode = null;
  next.promoApplied = false;
  delete next.discountPercent;
  return { ok: true, cart: next };
}

function calculateSubtotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

function calculateTotals(cart) {
  const subtotal = calculateSubtotal(cart);
  const discountPercent = cart.promoApplied ? cart.discountPercent || 0 : 0;
  const discount = Math.round(subtotal * (discountPercent / 100));
  const total = subtotal - discount;

  return { subtotal, discountPercent, discount, total };
}

function checkout(cart) {
  if (!cart.items.length) {
    return { ok: false, error: 'Корзина пуста' };
  }

  for (const item of cart.items) {
    const product = getProduct(item.productId);
    if (!product || item.quantity > product.stock) {
      return { ok: false, error: `Недостаточно товара: ${item.name}` };
    }
  }

  const totals = calculateTotals(cart);
  const orderId = `ORD-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  return {
    ok: true,
    order: {
      id: orderId,
      items: cart.items.map((i) => ({ ...i })),
      promoCode: cart.promoCode,
      ...totals,
      createdAt: new Date().toISOString(),
    },
  };
}

function cloneCart(cart) {
  return {
    ...cart,
    items: cart.items.map((i) => ({ ...i })),
  };
}

module.exports = {
  createEmptyCart,
  addItem,
  updateQuantity,
  applyPromo,
  removePromo,
  calculateSubtotal,
  calculateTotals,
  checkout,
};
