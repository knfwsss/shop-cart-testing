/** Справочник промокодов */
const PROMO_CODES = {
  SALE10: { discountPercent: 10, expiresAt: '2030-12-31' },
  WELCOME20: { discountPercent: 20, expiresAt: '2026-06-30' },
  EXPIRED: { discountPercent: 15, expiresAt: '2025-01-01' },
};

function isPromoExpired(expiresAt, now = new Date()) {
  return new Date(expiresAt) < now;
}

function validatePromoCode(code, now = new Date()) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Промокод не указан' };
  }

  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(normalized)) {
    return { valid: false, error: 'Неверный формат промокода' };
  }

  const promo = PROMO_CODES[normalized];
  if (!promo) {
    return { valid: false, error: 'Промокод недействителен' };
  }

  if (isPromoExpired(promo.expiresAt, now)) {
    return { valid: false, error: 'Срок действия промокода истёк' };
  }

  return {
    valid: true,
    code: normalized,
    discountPercent: promo.discountPercent,
  };
}

module.exports = { PROMO_CODES, isPromoExpired, validatePromoCode };
