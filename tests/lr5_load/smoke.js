// Короткий прогон для CI: 5 покупателей и 5 «смотрящих» в течение 30 секунд.
import { SLA_THRESHOLDS, registerUsers, browse, shop } from './lib.js';

export { browse, shop };

export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', exec: 'browse', vus: 5, duration: '30s' },
    shop: { executor: 'constant-vus', exec: 'shop', vus: 5, duration: '30s' },
  },
  thresholds: SLA_THRESHOLDS,
};

export function setup() {
  return registerUsers();
}
