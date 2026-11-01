// Load: ожидаемая рабочая нагрузка — 50 одновременных пользователей
// (30 просматривают каталог, 20 покупают), рост 1 мин, удержание 4 мин, спад 30 с.
import { SLA_THRESHOLDS, registerUsers, browse, shop } from './lib.js';

export { browse, shop };

const profile = (target) => [
  { duration: '1m', target },
  { duration: '4m', target },
  { duration: '30s', target: 0 },
];

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', exec: 'browse', startVUs: 0, stages: profile(30) },
    shop: { executor: 'ramping-vus', exec: 'shop', startVUs: 0, stages: profile(20) },
  },
  thresholds: SLA_THRESHOLDS,
};

export function setup() {
  return registerUsers();
}
