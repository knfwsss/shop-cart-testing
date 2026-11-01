// Spike: «старт распродажи» — 10 пользователей, за 10 секунд скачок до 300 (×30),
// минута на пике, резкий спад и минута наблюдения за восстановлением.
import { SLA_THRESHOLDS, registerUsers, browse, shop } from './lib.js';

export { browse, shop };

const spike = (share) => [
  { duration: '30s', target: Math.round(10 * share) },
  { duration: '10s', target: Math.round(300 * share) },
  { duration: '1m', target: Math.round(300 * share) },
  { duration: '10s', target: Math.round(10 * share) },
  { duration: '1m', target: Math.round(10 * share) },
  { duration: '10s', target: 0 },
];

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', exec: 'browse', startVUs: 0, stages: spike(0.6) },
    shop: { executor: 'ramping-vus', exec: 'shop', startVUs: 0, stages: spike(0.4) },
  },
  thresholds: SLA_THRESHOLDS,
};

export function setup() {
  return registerUsers();
}
