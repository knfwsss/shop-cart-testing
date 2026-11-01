# Корзина интернет-магазина — тестирование ПО (ЛР1–ЛР6)

Учебное веб-приложение (Node.js + Express) и все автотесты к лабораторным работам
по тестированию ПО. СибГУ им. М. Ф. Решетнёва, группа БПА23-02:
А. О. Гарбузова, А. П. Лукавенко.

## Что умеет приложение

- каталог из 4 товаров с остатками на складе;
- корзина: добавление товара, изменение количества, промокоды `SALE10` (10 %) и `EXPIRED` (просрочен);
- оформление заказа с серверным пересчётом суммы;
- регистрация, вход по токену, профиль и история заказов.

## Запуск

```bash
npm install
npx playwright install chromium
npm start            # http://localhost:3000
```

## Тесты по лабораторным

| Лабораторная | Папка | Команда | Что внутри |
|---|---|---|---|
| ЛР1 | `tests/lr1_unit`, `tests/lr1_integration` | `npm test` | unit-тесты логики корзины и интеграционные тесты API (`node:test`) |
| ЛР2 | — | — | проектирование тестов, только отчёт |
| ЛР3 | `tests/lr3_ui` | `npm run test:ui` | 10 UI-тестов Playwright, Page Object `CartPage` |
| ЛР4 | `tests/lr4_api` | `npm run test:api`, `npm run test:postman` | API-тесты Playwright, JSON-схемы ответов, связка API + UI, Postman-коллекция и Newman |
| ЛР5 | `tests/lr5_load` | `npm run load:test` и др. | сценарии k6: smoke, load, stress, spike; результаты в `results/` |
| ЛР6 | `tests/lr6_security` | `npm run test:security` | security-тесты: SQLi, XSS, хранение паролей, доступ без токена, политика паролей, утечки |

Все Playwright-тесты разом: `npx playwright test`, отчёт: `npm run report`.
Окно браузера с замедлением: `SLOWMO=700 npx playwright test --project=ui --headed --workers=1`.

## CI

`.github/workflows/ci.yml` запускается при push в `main` и на pull request:
ESLint с правилами безопасности (SAST), аудит зависимостей, тесты ЛР1, ЛР4, ЛР6, ЛР3,
затем короткий нагрузочный прогон k6 с порогами SLA. Отчёты прикладываются к прогону
как артефакт `test-reports`.

## API

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `GET /api/health` | все | проверка, что сервер жив |
| `GET /api/products` | все | каталог |
| `GET /api/cart` | `X-Session-Id` | корзина сессии |
| `POST /api/cart/items` | `X-Session-Id` | добавить товар `{ productId, quantity }` |
| `PATCH /api/cart/items/:id` | `X-Session-Id` | изменить количество `{ quantity }`, 0 — удалить |
| `POST /api/cart/promo`, `DELETE /api/cart/promo` | `X-Session-Id` | применить / отменить промокод |
| `POST /api/checkout` | `X-Session-Id`, токен по желанию | оформить заказ; с токеном заказ попадает в историю |
| `POST /api/auth/register` | все | регистрация `{ email, password }` |
| `POST /api/auth/login` | все | вход, ответ `{ token, tokenType, expiresIn }` |
| `POST /api/auth/logout` | токен | отзыв токена |
| `GET /api/profile`, `GET /api/orders` | токен | профиль и история заказов |

`X-Session-Id` — случайный идентификатор корзины (16–64 символа: латиница, цифры, дефис).
Токен передаётся заголовком `Authorization: Bearer <token>`.
