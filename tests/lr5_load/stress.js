// Stress: ступенчатый рост выше нормы — 50 → 100 → 200 → 400 → 600 пользователей
// (×1, ×2, ×4, ×8, ×12 от load), на каждой ступени удержание 1 мин.
// Пороги те же, что в load: цель — увидеть, на какой ступени SLA перестаёт выполняться.
import { SLA_THRESHOLDS, registerUsers, browse, shop } from './lib.js';

export { browse, shop };

const steps = (share) => [50, 100, 200, 400, 600].flatMap((total) => [
  { duration: '30s', target: Math.round(total * share) },
  { duration: '1m', target: Math.round(total * share) },
]).concat([{ duration: '30s', target: 0 }]);

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', exec: 'browse', startVUs: 0, stages: steps(0.6) },
    shop: { executor: 'ramping-vus', exec: 'shop', startVUs: 0, stages: steps(0.4) },
  },
  thresholds: SLA_THRESHOLDS,
};

export function setup() {
  return registerUsers();
}
