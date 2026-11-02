// Имитация атаки подбора пароля. Запускать только против своего учебного стенда.
// node tests/lr6_security/attack/brute-force-attack.js <baseUrl> dictionary|spray
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const MODE = process.argv[3] || 'dictionary';
const VICTIM_PASSWORD = 'Summer2026';

const post = async (path, body, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json().catch(() => ({})) };
};

// Словарь атакующего: популярные слова в типичных вариантах написания.
function buildDictionary() {
  const words = ['password', 'qwerty', 'admin', 'welcome', 'dragon', 'monkey', 'letmein', 'master', 'hello',
    'freedom', 'shop', 'sunshine', 'princess', 'football', 'winter', 'autumn', 'spring', 'summer', 'iloveyou', 'secret'];
  const list = [];
  for (const word of words) {
    const cap = word[0].toUpperCase() + word.slice(1);
    list.push(`${word}123`, `${cap}123`, `${word}1234`, `${cap}1!`);
    for (const year of [2022, 2023, 2024, 2025, 2026]) list.push(`${word}${year}`, `${cap}${year}`);
  }
  return list;
}

const fmt = (ms) => `${(ms / 1000).toFixed(1)} с`;
const histogram = (statuses) => Object.entries(
  statuses.reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {}),
).map(([code, n]) => `${code} × ${n}`).join(', ');

async function dictionaryAttack() {
  const victim = `victim.${Date.now()}@shop.ru`;
  await post('/api/auth/register', { email: victim, password: VICTIM_PASSWORD });
  const dictionary = buildDictionary();
  console.log(`Жертва: ${victim}`);
  console.log(`Словарь атакующего: ${dictionary.length} паролей (настоящий пароль — №${dictionary.indexOf(VICTIM_PASSWORD) + 1})`);
  console.log('');

  const started = Date.now();
  const statuses = [];
  let found = null;
  let retryAfter = null;
  for (const [i, candidate] of dictionary.entries()) {
    const res = await post('/api/auth/login', { email: victim, password: candidate });
    statuses.push(res.status);
    if (res.retryAfter) retryAfter = res.retryAfter;
    if (i < 7 || res.status === 200 || (i + 1) % 40 === 0) {
      console.log(`попытка ${String(i + 1).padStart(3)}: ${candidate.padEnd(14)} → ${res.status}${res.retryAfter ? ` (Retry-After: ${res.retryAfter} с)` : ''}`);
    }
    if (res.status === 200) {
      found = { candidate, attempt: i + 1, token: res.body.token };
      break;
    }
  }
  const elapsed = Date.now() - started;

  console.log('');
  console.log('ИТОГ');
  console.log(`  попыток: ${statuses.length} за ${fmt(elapsed)}`);
  console.log(`  ответы: ${histogram(statuses)}`);
  if (found) {
    console.log(`  ПАРОЛЬ ПОДОБРАН: «${found.candidate}» с попытки №${found.attempt}, получен токен ${found.token.slice(0, 12)}…`);
  } else {
    const perWindow = 5;
    const hours = (Math.ceil(dictionary.length / perWindow) * 15) / 60;
    console.log('  пароль НЕ подобран: после 5 ошибок аккаунт заблокирован');
    console.log(`  блокировка: ${retryAfter} с; чтобы перебрать весь словарь по 5 попыток за 15 минут, нужно ≈ ${hours.toFixed(0)} ч`);
    console.log(`  словарь из 10 000 паролей занял бы ≈ ${((10000 / perWindow) * 15 / 60 / 24).toFixed(0)} суток`);
  }
}

async function sprayAttack() {
  const total = 120;
  const target = 110;
  const tag = Date.now();
  console.log(`Подготовка: регистрируем ${total} покупателей, у №${target} пароль «${VICTIM_PASSWORD}»…`);
  const emails = [];
  for (let i = 1; i <= total; i += 1) {
    const email = `buyer${i}.${tag}@shop.ru`;
    const password = i === target ? VICTIM_PASSWORD : `Strong${tag}x${i}`;
    await post('/api/auth/register', { email, password });
    emails.push(email);
  }
  console.log(`Атака: один пароль «${VICTIM_PASSWORD}» по ${total} аккаунтам с одного IP`);
  console.log('');

  const started = Date.now();
  const statuses = [];
  let found = null;
  for (const [i, email] of emails.entries()) {
    const res = await post('/api/auth/login', { email, password: VICTIM_PASSWORD });
    statuses.push(res.status);
    if (i < 3 || res.status !== 401 || (i + 1) % 25 === 0) {
      if (res.status === 429 && statuses.filter((s) => s === 429).length > 3) continue;
      console.log(`аккаунт ${String(i + 1).padStart(3)}: ${email.padEnd(30)} → ${res.status}`);
    }
    if (res.status === 200) {
      found = { email, attempt: i + 1 };
      break;
    }
  }
  const elapsed = Date.now() - started;

  console.log('');
  console.log('ИТОГ');
  console.log(`  попыток: ${statuses.length} за ${fmt(elapsed)}`);
  console.log(`  ответы: ${histogram(statuses)}`);
  console.log(found
    ? `  ВЗЛОМАН аккаунт ${found.email} с попытки №${found.attempt}`
    : `  ни один аккаунт не взломан: после 100 неудачных попыток IP заблокирован, до аккаунта №${target} атака не дошла`);
}

(MODE === 'spray' ? sprayAttack() : dictionaryAttack()).catch((err) => {
  console.error(err);
  process.exit(1);
});
