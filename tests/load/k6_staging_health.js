// SAFE opt-in load test. Never target production or a third-party host.
// Install k6, and supply a staging URL that you own.
// k6 run -e DRIVE_STAGING_URL=https://staging.yourdomain.example tests/load/k6_staging_health.js
import http from 'k6/http';
import {check, sleep} from 'k6';
import {Trend, Rate} from 'k6/metrics';

const base = (__ENV.DRIVE_STAGING_URL || '').replace(/\/$/, '');
if (!/^https:\/\/staging[.-][a-zA-Z0-9.-]+$/.test(base)) {
  throw new Error('Set DRIVE_STAGING_URL to your OWN HTTPS staging hostname starting with staging. or staging-');
}

const durationMs = new Trend('drive_staging_health_latency_ms');
const errors = new Rate('drive_staging_health_error_rate');
export const options = {
  scenarios: {health: {
    executor: 'constant-vus', vus: 5, duration: '60s',
    gracefulStop: '10s',
  }},
  thresholds: {
    drive_staging_health_error_rate: ['rate<0.01'],
    drive_staging_health_latency_ms: ['p(95)<500'],
  },
};

export default function () {
  const response = http.get(base + '/healthz', {
    headers: {'Cache-Control': 'no-cache'}, timeout: '5s',
  });
  check(response, {'edge health responds 200': r => r.status === 200});
  durationMs.add(response.timings.duration);
  errors.add(response.status !== 200);
  sleep(2);
}
