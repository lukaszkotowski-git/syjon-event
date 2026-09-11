# SyjonEvent — MVP portalu rejestracyjnego

Implementacja specyfikacji z `docs/SPEC.md` (wersja 2.0). Monorepo npm workspaces:

```
apps/api        Express 4 + TypeScript + Prisma + zod
apps/web        React 18 + Vite + Tailwind
packages/shared typy pól, walidatory zod i DTO wspólne dla API i frontendu
prisma          schema.prisma, migracja inicjalna, seed adminów
```

## Uruchomienie lokalne (bez Dockera)

```bash
cp .env.example .env          # uzupełnij SESSION_SECRET, ADMIN_USERS, klucze Paynow
npm install
npx prisma migrate deploy --schema prisma/schema.prisma
npm run build -w @syjonevent/shared
npm run seed:admins           # czyta ADMIN_USERS z .env
npm run dev:api               # http://localhost:4000
npm run dev:web               # http://localhost:5173 (proxy /api -> :4000)
```

Wymagany działający PostgreSQL 16 pod `DATABASE_URL`.

## Uruchomienie w Dockerze (dev)

```bash
cp .env.example .env
docker compose up --build
docker compose exec api npm run seed:admins
```

## Produkcja (Dokploy)

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Zmienne ustawiasz w panelu Dokploy (nie w repo). Domenę kierujesz na usługę `web` (port 80);
nginx proxy'uje `/api` do kontenera `api`, więc webhook Paynow jest pod
`https://twoja-domena/api/webhooks/paynow`. Ten adres wpisujesz w Panelu Merchanta Paynow.
Po pierwszym deployu: `docker compose -f docker-compose.prod.yml exec api npm run seed:admins`.

## Testy

```bash
npm test -w @syjonevent/api    # podpis Paynow, maszyna statusów, walidacja pól, CSV
npm run typecheck            # cały monorepo
```

## Zaimplementowane milestone'y

| Milestone | Status | Gdzie |
|---|---|---|
| M0 szkielet | gotowe | monorepo, `prisma/migrations`, `GET /health`, compose |
| M1 auth | gotowe | `src/auth/*`, `src/routes/auth.ts`, `prisma/seed-admins.ts` |
| M2 panel formularzy | gotowe (API + UI) | `src/routes/admin-forms.ts`, `apps/web/src/pages/AdminFormEditor.tsx` |
| M3 publiczna rejestracja | gotowe | `src/services/registration.ts`, `src/services/capacity.ts`, `apps/web/src/pages/PublicForm.tsx` |
| M4 Paynow outbound | gotowe (do testu w sandboxie) | `src/paynow/client.ts`, `src/services/payments.ts` |
| M5 Paynow inbound | gotowe (do testu w sandboxie) | `src/routes/webhook.ts`, `src/paynow/status.ts` |
| M6 operacje admina | gotowe | lista/szczegóły zgłoszeń, CSV ze snapshotów |
| M7 produkcja | konfiguracja gotowa, deploy po Twojej stronie | `docker-compose.prod.yml`, `apps/web/nginx.conf` |

## Kluczowe decyzje w kodzie

- **Advisory lock**: `pg_advisory_xact_lock(hashtext(form_id))` w `src/services/capacity.ts`.
  Sprawdzenie limitów i utworzenie rezerwacji dzieje się w jednej transakcji.
- **Rezerwacja**: `submissions.reservation_expires_at`, wygasanie materializowane leniwie
  (`materializeExpiry`) — poprawność limitów nie zależy od crona.
- **`validityTime` Paynow** = tyle, ile realnie zostało lokalnej rezerwacji (min. 60 s wg API).
- **Webhook**: `express.raw` zarejestrowany **przed** `express.json()` (`src/app.ts`), podpis
  HMAC-SHA256 z surowego body, porównanie `timingSafeEqual`.
- **Idempotencja i kolejność**: `decideStatusUpdate` — `CONFIRMED` jest terminalny, starsza
  notyfikacja (`modifiedAt`) nie cofa stanu, duplikat zapisuje tylko ślad audytowy.
- **Snapshoty**: `ticket_name_snapshot`, `ticket_price_cents`, `payload_json`,
  `schema_snapshot_json`, wersje regulaminu — edycja formularza nie rusza historii.
- **Token publiczny**: losowy, w bazie tylko HMAC (`public_token_hash`); status i retry wymagają
  poprawnego tokenu.
- **Brak hard-delete**: formularz → `ARCHIVED`, bilet → `is_active=false`.

## Świadome odstępstwa od SPEC

1. **Brak `react-hook-form`** — formularze są na kontrolowanym stanie React, a walidacja i tak
   pochodzi z `@syjonevent/shared` (ten sam kod co na serwerze). Mniej zależności, zero dryfu.
   Jeśli builder urośnie o pola warunkowe, warto wrócić do RHF.
2. **`requirePhone` per formularz** (kolumna `forms.require_phone`) — SPEC zostawiał tę decyzję
   otwartą; konfiguracja per wydarzenie jest tańsza niż zmiana globalna później.
3. **Kolejność montowania webhooka** — zamiast osobnej aplikacji, jeden Express z raw body tylko
   na `/api/webhooks/*`.

## Do zrobienia przed produkcją

- [ ] Klucze sandboxa Paynow w `.env` i pełny test E2E (BLIK 111111 / 222222 / 333333 / 444444).
- [ ] Potwierdzenie w sandboxie mechanizmu retry (własna próba vs Payment Recovery Paynow).
- [ ] Adres notyfikacji w Panelu Merchanta.
- [ ] Treść i hosting regulaminu oraz polityki prywatności (kod zapisuje tylko wersje).
- [ ] Backup PostgreSQL w Dokploy.
