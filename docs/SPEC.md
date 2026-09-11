# SyjonEvent — specyfikacja architektury MVP

> **Wersja:** 2.0  
> **Data:** 2026-09-09  
> **Status:** zaakceptowany zakres funkcjonalny; dokument zrewidowany przed rozpoczęciem implementacji.  
> **Implementacja:** nie rozpoczęta.

---

## 1. Cel i granice MVP

SyjonEvent to portal rejestracyjny na wydarzenia z płatnymi i darmowymi biletami, działający w modelu:

1. Administrator tworzy wydarzenie/formularz rejestracyjny.
2. Administrator definiuje pola formularza i typy biletów.
3. Administrator publikuje formularz pod adresem `/f/:slug`.
4. Uczestnik wybiera jeden bilet, uzupełnia dane i — jeśli bilet jest płatny — przechodzi do płatności Paynow.
5. Aplikacja zapisuje zgłoszenie, obsługuje limity miejsc, utrzymuje rezerwację na czas płatności i aktualizuje status po webhooku Paynow.
6. Administrator przegląda zgłoszenia i eksportuje je do CSV.

### W zakresie MVP

- Panel administratora i logowanie e-mail + hasło.
- Co najmniej pięć kont administratorów, zarządzanych przez seed z env.
- Tworzenie, edycja, publikacja i archiwizacja formularzy.
- Prosty builder pól: tekst, e-mail, telefon, liczba, select, checkbox, data.
- Typy biletów per wydarzenie, ceny w PLN, limit globalny i limit per bilet.
- Publiczny formularz `/f/:slug` bez konta uczestnika.
- Rejestracja bezpłatna i płatna przez Paynow API v3.
- Sandbox Paynow na początku prac.
- Webhook Paynow z weryfikacją podpisu, idempotencją i ochroną przed notyfikacjami poza kolejnością.
- Powtórzenie płatności, jeśli rezerwacja miejsca nadal jest ważna.
- Strona potwierdzenia płatności z bezpiecznym tokenem publicznym.
- Lista zgłoszeń i CSV.
- Deploy przez Docker/Dokploy na VPS.

### Poza zakresem MVP

- Kody rabatowe i promocje.
- Konta uczestników, logowanie uczestników, historia zamówień uczestnika.
- E-maile transakcyjne.
- UI do dodawania adminów i resetowania haseł.
- Zwroty przez API (obsługa ręczna w Panelu Merchanta Paynow).
- Drag & drop w builderze.
- Rozbudowane wersjonowanie formularza w UI.
- Redis, kolejki, event sourcing, mikroserwisy i osobny serwis płatności.

---

## 2. Reguły biznesowe

### Formularze i publikacja

- Formularz ma status `DRAFT`, `PUBLISHED` lub `ARCHIVED`.
- Publiczny adres `/f/:slug` działa wyłącznie dla formularza `PUBLISHED` przed `closes_at`.
- Formularz `DRAFT`, `ARCHIVED` albo formularz po `closes_at` jest niedostępny publicznie.
- Formularz może być edytowany po wystąpieniu zgłoszeń.
- Dane historyczne zgłoszeń nie mogą zmieniać się wskutek edycji formularza, typu biletu, nazwy pola lub ceny.
- Nie wykonujemy hard delete formularzy ani biletów, które mogą mieć zgłoszenia. Używamy archiwizacji formularza i dezaktywacji biletu.

### Bilety

- Jedno zgłoszenie obejmuje dokładnie **jeden** bilet.
- Jedno wydarzenie może mieć wiele typów biletów, np. `Normalny`, `Ulgowy`, `Wolontariusz`.
- Bilet zawiera cenę w groszach oraz walutę `PLN`.
- Bilet o cenie `0` jest darmowy.
- Bilety płatne muszą mieć cenę minimum `100` groszy (1,00 PLN), zgodnie z ograniczeniem Paynow.
- Typ biletu może mieć indywidualny limit miejsc (`capacity`).
- Formularz może mieć globalny limit miejsc (`capacity_total`).
- `null` w limicie oznacza brak limitu.
- Dezaktywowany bilet nie jest dostępny w nowych rejestracjach, ale pozostaje widoczny w danych historycznych.

### Dane uczestnika

- Dane kupującego są stałą sekcją formularza, a nie polem opcjonalnie dodawanym przez builder.
- `buyer_email` jest zawsze obowiązkowy. Jest wykorzystywany przez Paynow, do wyszukiwania zgłoszeń i w eksporcie.
- `buyer_phone` jest przewidziany jako stałe pole opcjonalne lub wymagane na poziomie formularza. Jeśli jest wymagany, walidacja akceptuje polski format `+48` oraz dziewięć cyfr numeru krajowego.
- Dodatkowe pola definiuje administrator w builderze.
- Wymagane checkboxy regulaminu i polityki prywatności są stałe. Aplikacja zapisuje identyfikator wersji dokumentu oraz czas akceptacji.

### Rezerwacja i limity miejsc

Płatność jest asynchroniczna. Utworzenie zgłoszenia nie oznacza jeszcze sprzedaży biletu, ale przez ograniczony czas musi blokować miejsce.

- Płatne zgłoszenie powstaje ze stanem `RESERVED`.
- Przy utworzeniu ustawiana jest data `reservation_expires_at`, domyślnie 15 minut od momentu zapisu.
- Aktywna rezerwacja (`RESERVED` z `reservation_expires_at > now()`) blokuje miejsce identycznie jak zgłoszenie `PAID`.
- Paynow otrzymuje dokładnie ten sam czas ważności w parametrze `validityTime`.
- Miejsce jest dostępne, jeżeli ani limit globalny, ani limit wybranego typu biletu nie został osiągnięty przez zbiór: `PAID` + aktywne `RESERVED`.
- Sprawdzenie limitu i utworzenie rezerwacji odbywa się w jednej transakcji PostgreSQL z `pg_advisory_xact_lock` opartym o `form_id`.
- Dzięki lockowi dwa równoległe zgłoszenia nie mogą skutecznie zarezerwować tego samego ostatniego miejsca.
- Rezerwacja wygasa logicznie po `reservation_expires_at`; nie jest potrzebny cron do poprawności limitów. Każdy odczyt limitu i każde retry traktuje wygasłą rezerwację jako nieaktywną.
- Status `EXPIRED` może być materializowany przy odczycie, retry lub obsłudze webhooka. Cron może zostać dodany później tylko do celów porządkowych i raportowych.
- Zgłoszenie darmowe nie ma okresu oczekiwania: powstaje od razu jako `PAID`.

### Powtórzenie płatności

- Retry jest dostępne wyłącznie dla zgłoszenia `RESERVED`, którego `reservation_expires_at` jeszcze nie minął.
- Przed retry backend ponownie sprawdza status rezerwacji i dostępność w transakcji z advisory lockiem.
- Każda wewnętrzna próba płatności tworzy nowy rekord w `payments` oraz nowy `idempotency_key`.
- Wszystkie próby dotyczą tego samego `submission_id` i tego samego `externalId` po stronie Paynow.
- Dokładny sposób uruchomienia retry zostanie potwierdzony testem sandboxowym: własne utworzenie kolejnej płatności przez API albo mechanizm Payment Recovery Paynow.
- Aplikacja musi obsługiwać wiele `provider_payment_id` dla jednego zgłoszenia oraz status `ABANDONED` poprzedniej próby.
- Po wygaśnięciu rezerwacji retry nie może automatycznie odzyskać miejsca. Wymagałoby to nowej atomowej rezerwacji, dlatego MVP wyświetla komunikat o wygaśnięciu i kieruje użytkownika do formularza.

---

## 3. Architektura i stack

### Technologie

| Warstwa | Technologia |
|---|---|
| Backend | Node.js + TypeScript + Express 4 |
| Walidacja | zod |
| ORM / migracje | Prisma |
| Frontend | React + TypeScript + Vite |
| Formularze | react-hook-form |
| Style | Tailwind CSS |
| Baza danych | PostgreSQL 16 |
| Uwierzytelnianie admina | Sesje w httpOnly cookie, rekordy w PostgreSQL |
| Płatności | Paynow API v3 |
| Kontenery | Docker + docker-compose |
| Produkcja | Dokploy na VPS (`dokploy.enable=true`) |

### Zasady architektoniczne

- System jest modularnym monolitem: jedno API Express, jedna aplikacja React, jedna baza PostgreSQL.
- PostgreSQL jest jedynym źródłem prawdy dla formularzy, rezerwacji, zgłoszeń i płatności.
- Nie używamy Redisa ani kolejki w MVP.
- Operacje krytyczne dla limitów wykonujemy transakcyjnie w PostgreSQL.
- Frontend nigdy nie oblicza ostatecznej ceny, dostępności lub statusu płatności; backend zawsze pobiera i waliduje dane z bazy.
- Endpoint webhooka jest osobnym route'em Express z raw body, zarejestrowanym przed globalnym parserem JSON.
- Wszystkie wejścia API są walidowane po stronie serwera.

### Struktura repozytorium

```text
syjonevent/
├── apps/
│   ├── api/                    # Express, Prisma client, auth, Paynow
│   └── web/                    # Vite + React + Tailwind
├── packages/
│   └── shared/                 # typy domenowe, definicje pól, schematy zod
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed-admins.ts
├── docs/
│   └── SPEC.md                 # ten dokument
├── docker-compose.yml          # development
├── docker-compose.prod.yml     # Dokploy / produkcja
└── .env.example
```

### Współdzielone walidatory

`packages/shared` zawiera:

- definicję dozwolonych typów pól,
- format `schema_json` formularza,
- schematy zod dla konfiguracji formularza,
- generator walidacji odpowiedzi publicznego formularza,
- typy DTO używane przez API i frontend.

Frontend korzysta z tych definicji do renderowania i walidacji UX. Backend korzysta z tych samych definicji jako ostatecznej walidacji bezpieczeństwa i poprawności danych.

---

## 4. Model domenowy i dane

### Statusy

```text
FormStatus         = DRAFT | PUBLISHED | ARCHIVED
SubmissionStatus   = RESERVED | PAID | EXPIRED | CANCELLED
PaymentStatus      = NEW | PENDING | CONFIRMED | REJECTED | ERROR | ABANDONED | EXPIRED
```

Kluczowa zasada: `SubmissionStatus` opisuje **prawo do miejsca / stan rejestracji**, a `PaymentStatus` opisuje **konkretną próbę płatności**. Nie wolno mieszać obu pojęć w jednym enumie.

### admins

| Kolumna | Typ / ograniczenia | Znaczenie |
|---|---|---|
| id | UUID, PK | identyfikator admina |
| email | text, unique | e-mail logowania, normalizowany do lowercase |
| password_hash | text | hash bcryptjs |
| created_at | timestamptz | utworzenie |
| updated_at | timestamptz | ostatnia zmiana |
| disabled_at | timestamptz, null | opcjonalne wyłączenie konta bez kasowania |

### sessions

| Kolumna | Typ / ograniczenia | Znaczenie |
|---|---|---|
| id_hash | text, PK | hash losowego tokenu sesyjnego; token plaintext wyłącznie w cookie |
| admin_id | UUID, FK → admins | właściciel sesji |
| expires_at | timestamptz | czas wygaśnięcia |
| created_at | timestamptz | audyt |
| last_seen_at | timestamptz | audyt / opcjonalne odświeżanie |
| revoked_at | timestamptz, null | wylogowanie lub ręczne unieważnienie |

### forms

| Kolumna | Typ / ograniczenia | Znaczenie |
|---|---|---|
| id | UUID, PK | identyfikator formularza |
| slug | text, unique | publiczny identyfikator URL |
| title | text | tytuł wydarzenia |
| description | text, null | opis publiczny |
| status | FormStatus | DRAFT / PUBLISHED / ARCHIVED |
| schema_json | jsonb | konfiguracja pól dodatkowych buildera |
| capacity_total | integer, null | limit całego wydarzenia; null = bez limitu |
| closes_at | timestamptz | koniec publicznej rejestracji |
| terms_version | text | wersja regulaminu pokazywana uczestnikowi |
| privacy_policy_version | text | wersja polityki prywatności |
| created_at | timestamptz | utworzenie |
| updated_at | timestamptz | ostatnia zmiana |
| archived_at | timestamptz, null | data archiwizacji |

### ticket_types

| Kolumna | Typ / ograniczenia | Znaczenie |
|---|---|---|
| id | UUID, PK | identyfikator typu biletu |
| form_id | UUID, FK → forms, index | wydarzenie |
| name | text | np. `Normalny`, `Ulgowy` |
| price_cents | integer, >= 0 | cena w groszach |
| currency | char(3), default `PLN` | w MVP zawsze PLN |
| capacity | integer, null | limit typu; null = bez limitu |
| sort_order | integer | kolejność na formularzu |
| is_active | boolean, default true | dostępność dla nowych zgłoszeń |
| created_at | timestamptz | utworzenie |
| updated_at | timestamptz | ostatnia zmiana |

### submissions

| Kolumna | Typ / ograniczenia | Znaczenie |
|---|---|---|
| id | UUID, PK | identyfikator zgłoszenia; `externalId` w Paynow |
| form_id | UUID, FK → forms, index | wydarzenie |
| ticket_type_id | UUID, FK → ticket_types | bieżąca referencja do typu biletu |
| ticket_name_snapshot | text | nazwa biletu w chwili rejestracji |
| ticket_price_cents | integer | cena w chwili rejestracji |
| currency | char(3) | snapshot waluty |
| buyer_email | text, index | wymagany e-mail kupującego |
| buyer_phone | text, null | znormalizowany telefon, jeśli zebrany |
| payload_json | jsonb | snapshot odpowiedzi uczestnika |
| schema_snapshot_json | jsonb | snapshot definicji pól i etykiet dla danych historycznych |
| terms_version_accepted | text | zaakceptowana wersja regulaminu |
| privacy_policy_version_accepted | text | zaakceptowana wersja polityki prywatności |
| legal_accepted_at | timestamptz | timestamp akceptacji checkboxów |
| status | SubmissionStatus, index | RESERVED / PAID / EXPIRED / CANCELLED |
| reservation_expires_at | timestamptz, null, index | TTL rezerwacji; null dla biletu darmowego i PAID |
| public_token_hash | text, unique | hash tokenu używanego na stronie potwierdzenia |
| created_at | timestamptz | utworzenie |
| updated_at | timestamptz | ostatnia zmiana |

### payments

| Kolumna | Typ / ograniczenia | Znaczenie |
|---|---|---|
| id | UUID, PK | lokalny identyfikator próby |
| submission_id | UUID, FK → submissions, index | zgłoszenie; relacja 1:N |
| provider | text, default `paynow` | dostawca płatności |
| provider_payment_id | text, unique, null | `paymentId` z Paynow |
| idempotency_key | text, unique | maks. 45 znaków, unikalny per próba |
| amount_cents | integer | snapshot kwoty próby |
| currency | char(3) | snapshot waluty |
| status | PaymentStatus, index | status konkretnej próby |
| provider_modified_at | timestamptz, null | czas modyfikacji statusu przez Paynow |
| redirect_url | text, null | URL przekierowania do bramki |
| provider_payload_json | jsonb, null | ostatnia zweryfikowana notyfikacja / odpowiedź dostawcy |
| created_at | timestamptz | utworzenie |
| updated_at | timestamptz | ostatnia zmiana |

### Integralność i indeksy

- `forms.slug` jest unikalny globalnie.
- `payments.provider_payment_id` jest unikalny, gdy nie jest null.
- `payments.idempotency_key` jest unikalny.
- Indeksy: `submissions(form_id, status)`, `submissions(ticket_type_id, status)`, `submissions(reservation_expires_at)`, `submissions(buyer_email)`, `payments(submission_id, created_at desc)`.
- `ticket_price_cents` i `ticket_name_snapshot` nie są aktualizowane po utworzeniu zgłoszenia.
- `schema_snapshot_json` umożliwia poprawne wyświetlenie oraz eksport danych nawet po usunięciu lub zmianie pól w aktualnym formularzu.

---

## 5. Formularze, walidacja i UX

### Typy pól buildera

| Typ | Konfiguracja MVP | Walidacja |
|---|---|---|
| `text` | label, key, required, placeholder | string, required gdy skonfigurowane |
| `email` | label, key, required | poprawny e-mail |
| `tel` | label, key, required | polski numer z prefiksem `+48` |
| `number` | label, key, required | wartość liczbowa |
| `select` | label, key, required, options | jedna wartość z aktualnych opcji snapshotu |
| `checkbox` | label, key, required | boolean; `true`, gdy required |
| `date` | label, key, required | poprawny ISO date `YYYY-MM-DD` |

### Zasady buildera

- Builder jest listą pól z przyciskiem dodania i strzałkami góra/dół.
- Każde pole ma stabilny techniczny `key`, niezależny od etykiety.
- Klucze pól są unikalne w obrębie formularza.
- Administrator może zmienić etykietę, opcje i kolejność pól.
- Usunięte pole nie usuwa historycznych danych; jego wartość pozostaje w `payload_json` oraz `schema_snapshot_json` istniejących zgłoszeń.
- Formularz publiczny pokazuje najpierw stałą sekcję danych kupującego, następnie wybór biletu, potem pola dodatkowe i checkboxy prawne.

### Minimalne ekrany

**Panel admina:**

- Logowanie.
- Lista formularzy: status, slug, data zamknięcia, liczba opłaconych/rezerwowanych zgłoszeń.
- Tworzenie i edycja formularza.
- Zarządzanie typami biletów.
- Podgląd formularza publicznego.
- Lista zgłoszeń z filtrowaniem co najmniej po statusie i wyszukiwaniem po e-mailu.
- Szczegóły zgłoszenia: dane snapshotowe, wybrany bilet, próby płatności.
- Eksport CSV.

**Strefa publiczna:**

- Formularz `/f/:slug`.
- Komunikat o zamkniętej rejestracji.
- Komunikat o wyprzedaniu globalnym lub per typ biletu.
- Przekierowanie do Paynow dla płatności.
- Strona potwierdzenia: oczekiwanie / opłacono / płatność nieudana / rezerwacja wygasła.
- Przycisk retry wyłącznie w stanie aktywnej rezerwacji i przy nieudanej próbie.

---

## 6. API i przepływy

### Uwierzytelnianie administratora

| Metoda | Endpoint | Opis |
|---|---|---|
| POST | `/api/auth/login` | weryfikuje admina, tworzy sesję, ustawia httpOnly cookie |
| POST | `/api/auth/logout` | oznacza sesję jako `revoked_at` i czyści cookie |
| GET | `/api/auth/me` | zwraca zalogowanego admina |

### API administracyjne

Wszystkie endpointy wymagają sesji administratora.

| Metoda | Endpoint | Opis |
|---|---|---|
| GET | `/api/forms` | lista formularzy |
| POST | `/api/forms` | tworzenie formularza |
| GET | `/api/forms/:id` | szczegóły formularza |
| PATCH | `/api/forms/:id` | edycja formularza |
| POST | `/api/forms/:id/publish` | publikacja po walidacji kompletności |
| POST | `/api/forms/:id/archive` | archiwizacja bez kasowania danych |
| POST | `/api/forms/:id/tickets` | dodanie biletu |
| PATCH | `/api/forms/:id/tickets/:ticketId` | edycja biletu |
| POST | `/api/forms/:id/tickets/:ticketId/deactivate` | dezaktywacja biletu |
| GET | `/api/forms/:id/submissions` | lista zgłoszeń |
| GET | `/api/forms/:id/submissions/:submissionId` | szczegóły zgłoszenia i próby płatności |
| GET | `/api/forms/:id/submissions.csv` | eksport CSV |

### API publiczne

| Metoda | Endpoint | Opis |
|---|---|---|
| GET | `/api/public/f/:slug` | definicja opublikowanego, otwartego formularza i dostępnych biletów |
| POST | `/api/public/f/:slug/submissions` | walidacja, atomowa rezerwacja, zgłoszenie darmowe albo rozpoczęcie płatności |
| GET | `/api/public/submissions/:id/status?token=...` | bezpieczny status publiczny zgłoszenia |
| POST | `/api/public/submissions/:id/retry` | retry; wymaga tokenu publicznego w body lub nagłówku |

### Webhook

| Metoda | Endpoint | Opis |
|---|---|---|
| POST | `/api/webhooks/paynow` | raw body, weryfikacja HMAC, atomowa aktualizacja płatności i zgłoszenia |

### Przepływ: bilet darmowy

1. Uczestnik otwiera opublikowany formularz przed `closes_at`.
2. Wybiera aktywny bilet darmowy i wysyła formularz.
3. Backend waliduje payload oraz limity w transakcji z advisory lockiem.
4. Backend tworzy `submission` jako `PAID`, z ceną snapshotową `0`.
5. Backend tworzy bezpieczny token publiczny i zwraca URL strony potwierdzenia.
6. Nie powstaje rekord `payments` i nie ma komunikacji z Paynow.

### Przepływ: bilet płatny

1. Uczestnik wysyła formularz z aktywnym biletem płatnym.
2. Backend waliduje dane, status formularza, datę zamknięcia, aktywność biletu i cenę minimum 100 groszy.
3. Backend pod `pg_advisory_xact_lock(form_id)` sprawdza limity globalne i limit biletu.
4. Backend tworzy `submission` o statusie `RESERVED` z `reservation_expires_at = now() + 15 min`.
5. Backend generuje token publiczny, tworzy rekord `payments` z nowym Idempotency-Key oraz statusem `NEW`.
6. Backend wywołuje Paynow `POST /v3/payments`, przekazując m.in. `externalId = submission.id`, `buyer.email`, kwotę snapshotową i `validityTime = 900`.
7. Po odpowiedzi zapisuje `provider_payment_id`, `redirect_url` i status płatności, następnie przekierowuje użytkownika do `redirect_url`.
8. Jeżeli wywołanie Paynow zakończy się timeoutem lub błędem przejściowym, aplikacja zachowuje rekord próby oraz jego Idempotency-Key. Ponowienie do Paynow używa dokładnie tego samego klucza.

### Przepływ: webhook Paynow

1. Endpoint odbiera surowe body żądania.
2. Backend przed parsowaniem biznesowym weryfikuje `Signature` przez HMAC-SHA256 + Base64 przy użyciu `PAYNOW_SIGNATURE_KEY`.
3. Brak lub niepoprawny podpis daje odpowiedź 4xx i nie zmienia bazy.
4. Backend odnajduje rekord `payments` po `provider_payment_id`.
5. Backend zapisuje webhook tylko, jeżeli jego `provider_modified_at` jest nowszy niż już zapisany czas modyfikacji dla tej płatności.
6. `CONFIRMED` jest terminalny: starsza lub mniej końcowa notyfikacja nie może obniżyć potwierdzonej płatności.
7. Po poprawnym `CONFIRMED` powiązane zgłoszenie `RESERVED` przechodzi na `PAID`.
8. Po `REJECTED`, `ERROR`, `ABANDONED` lub `EXPIRED` aktualizowany jest status tej próby. Zgłoszenie zachowuje `RESERVED` do czasu `reservation_expires_at`, aby retry było możliwe tylko w pozostałym czasie rezerwacji.
9. Powtórzony webhook nie wywołuje ponownie efektów ubocznych i zwraca 200 lub 202 po trwałym zapisie.

### Przepływ: powrót użytkownika i fallback

- `continueUrl` Paynow prowadzi na frontendową stronę potwierdzenia z identyfikatorem zgłoszenia i tokenem publicznym.
- Parametry powrotu nie są samodzielnym dowodem opłacenia.
- Frontend pyta własne API o status zgłoszenia.
- Jeśli webhook jeszcze nie dotarł, API może wykonać serwerowe odpytanie Paynow o status konkretnej płatności, zweryfikować podpis odpowiedzi i zaktualizować lokalny stan zgodnie z regułami webhooka.
- Stan `PAID` jest prezentowany użytkownikowi wyłącznie po zweryfikowanym webhooku albo po zweryfikowanym serwerowym status-checku Paynow.

---

## 7. Integracja Paynow, bezpieczeństwo i deploy

### Paynow API v3

- Rozpocząć od środowiska Sandbox.
- Sekrety Paynow nigdy nie trafiają do frontendu ani repozytorium.
- Tworzenie płatności: `POST /v3/payments`.
- `Idempotency-Key` jest obowiązkowy, unikalny per lokalna próba i ma maksymalnie 45 znaków.
- `buyer.email` jest wymagany.
- Płatna kwota musi być co najmniej 100 groszy; bilet za 0 zł jest obsługiwany poza Paynow.
- Żądanie tworzenia płatności i odpowiedzi API są podpisywane/zweryfikowane zgodnie z dokumentacją Paynow.
- Powiadomienia Paynow mogą wystąpić wielokrotnie i poza kolejnością; aplikacja uwzględnia czas `modifiedAt` oraz terminalność `CONFIRMED`.
- Endpoint notyfikacji jest skonfigurowany w Panelu Merchanta jako:

```text
https://<PUBLIC_APP_URL>/api/webhooks/paynow
```

- Lokalny test webhooków wymaga publicznego tunelu HTTPS albo środowiska stagingowego.

### Zmienne środowiskowe

| Zmienna | Opis |
|---|---|
| `NODE_ENV` | `development` / `production` |
| `DATABASE_URL` | connection string PostgreSQL |
| `SESSION_SECRET` | sekret podpisu / ochrony sesji |
| `ADMIN_USERS` | lista kont do seeda (nigdy nie logowana) |
| `PAYNOW_API_KEY` | Api-Key dla sandbox/produkcji |
| `PAYNOW_SIGNATURE_KEY` | klucz weryfikacji podpisu |
| `PAYNOW_ENV` | `sandbox` albo `production` |
| `APP_BASE_URL` | publiczny adres aplikacji |
| `PAYNOW_VALIDITY_SECONDS` | domyślnie `900`; ten sam TTL co rezerwacja |
| `CORS_ORIGIN` | dozwolony origin frontendu |

### Sesje i admini

- Admini są seedowani przez polecenie `npm run seed:admins` na podstawie `ADMIN_USERS`.
- Seed hashuje hasła bcryptjs przed zapisem.
- W produkcji cookie ma flagi `HttpOnly`, `Secure`, `SameSite=Lax` oraz odpowiedni `Path`.
- Token sesji jest losowy, długi i przechowywany w bazie wyłącznie jako hash.
- Wszystkie endpointy `/api/forms/*` są chronione middlewarem sesji.
- Brak UI zarządzania administratorami i resetu haseł jest świadomym ograniczeniem MVP.

### Bezpieczeństwo publiczne

- `helmet` na API.
- CORS wyłącznie dla własnej domeny aplikacji.
- Rate limiting przynajmniej na logowaniu, utworzeniu zgłoszenia i retry płatności.
- Walidacja zod po stronie serwera dla każdego requestu.
- Limity długości payloadu i liczby pól formularza.
- Token publiczny zgłoszenia jest generowany kryptograficznie, pokazany użytkownikowi tylko w URL strony potwierdzenia, a w bazie przechowywany jako hash.
- Publiczne endpointy statusu i retry wymagają jednocześnie `submissionId` i prawidłowego tokenu.
- Webhook jest weryfikowany przed wszelką zmianą stanu.
- Logi nie mogą zawierać haseł, kluczy Paynow, pełnych danych osobowych ani tokenów sesji/publicznych.

### Dane osobowe

- Dane zgłoszeń są danymi osobowymi i muszą być chronione zgodnie z obowiązkami organizatora.
- Formularz wymaga akceptacji regulaminu i polityki prywatności; aplikacja zapisuje wersje oraz timestamp akceptacji.
- Treść regulaminu, polityki retencji danych oraz właściwą podstawę prawną przetwarzania powinien zatwierdzić administrator danych lub prawnik.
- MVP nie wprowadza automatycznego usuwania danych. Polityka retencji i obsługa żądań osób, których dane dotyczą, muszą zostać ustalone przed produkcyjnym startem.

### Docker i Dokploy

- Development: `docker-compose.yml` z PostgreSQL, API i frontendem.
- Produkcja: `docker-compose.prod.yml` zgodny z Dokploy.
- API posiada endpoint healthcheck, np. `GET /health`.
- PostgreSQL ma trwały wolumen i regularny backup skonfigurowany na poziomie VPS/Dokploy.
- TLS i reverse proxy obsługuje Dokploy.
- Sekrety produkcyjne są ustawiane w Dokploy, nie w pliku repozytorium.

---

## 8. Plan prac i kryteria akceptacji

| Milestone | Zakres | Warunek ukończenia |
|---|---|---|
| M0 | Szkielet projektu | Monorepo, Docker dev, PostgreSQL, Prisma, migracje, healthcheck, `.env.example` |
| M1 | Auth admina | Seed min. 5 adminów, login/logout/me, chronione endpointy, sesje jako hashe tokenów |
| M2 | Panel formularzy | CRUD bez hard-delete, publikacja/archiwizacja, builder pól, typy biletów, walidacja ceny i limitów |
| M3 | Publiczna rejestracja | `/f/:slug`, walidacja, dane kupującego, snapshoty, darmowe bilety, limity oraz atomowa rezerwacja |
| M4 | Paynow outbound | Sandbox, utworzenie płatności, Idempotency-Key, redirect, `validityTime` zgodny z TTL |
| M5 | Paynow inbound | Raw webhook, podpis, idempotencja, webhooki poza kolejnością, fallback status-check, retry |
| M6 | Operacje admina | Lista i szczegóły zgłoszeń, historia prób płatności, CSV z danych snapshotowych |
| M7 | Produkcja | Dokploy, HTTPS, webhook w Panelu Merchanta, backup bazy, testy E2E na sandboxie |

### Obowiązkowe scenariusze akceptacyjne

1. Dwa równoległe zgłoszenia na ostatnie miejsce nie mogą jednocześnie utworzyć aktywnej rezerwacji.
2. Bilet darmowy tworzy od razu `PAID`, nie tworzy rekordu `payments` i nie wywołuje Paynow.
3. Płatny bilet poniżej 1,00 PLN nie może zostać zapisany ani opłacony.
4. Utworzenie płatności ma `validityTime` identyczne jak lokalny TTL rezerwacji.
5. Powtórzenie tego samego webhooka nie zmienia danych ani nie tworzy nowej płatności.
6. Starsza notyfikacja Paynow nie może cofnąć płatności `CONFIRMED`.
7. `CONFIRMED` aktualizuje aktywne zgłoszenie na `PAID`.
8. `REJECTED` lub `ERROR` umożliwia retry wyłącznie przed `reservation_expires_at`.
9. Po wygaśnięciu rezerwacji retry nie może płatnie odzyskać miejsca bez ponownego sprawdzenia dostępności.
10. Zmiana ceny, nazwy biletu, etykiety pola lub usunięcie pola nie zmienia danych już utworzonego zgłoszenia ani jego CSV.
11. Status i retry zgłoszenia nie działają bez prawidłowego tokenu publicznego.
12. Formularz `DRAFT`, `ARCHIVED` lub po `closes_at` nie jest publicznie dostępny.
13. Dezaktywacja biletu nie usuwa danych historycznych, ale blokuje nowe zgłoszenia dla tego biletu.
14. CSV zawiera dane snapshotowe zgłoszenia, także dla później usuniętych pól.
15. Webhook z niepoprawnym podpisem nie zmienia żadnego rekordu.

---

## 9. Świadome kompromisy MVP

| Obszar | Decyzja MVP | Uzasadnienie / przyszłe rozszerzenie |
|---|---|---|
| Skalowanie limitów | PostgreSQL advisory lock per formularz | Wystarcza dla MVP; przy bardzo dużym flash-sale można dodać kolejkę/rezerwacje w kolejce |
| Wygasanie rezerwacji | Logiczne wygasanie przez `reservation_expires_at`, bez crona | Poprawność nie zależy od background workera; cron można dodać dla porządków |
| Retry | Jedynie przed wygaśnięciem pierwotnej rezerwacji | Chroni limity; zaawansowane odzyskanie miejsca poza MVP |
| Formularze po sprzedaży | Snapshot payloadu, schematu i biletu | Pełne wersjonowanie formularzy niepotrzebne w MVP |
| Admini | Seed z env, bez UI | Prostota przy kilku kontach; UI administracji później |
| Zwroty | Ręcznie w Paynow | API refundów poza zakresem |
| E-maile | Brak | Strona potwierdzenia jest jedynym automatycznym potwierdzeniem; później np. pg-boss + provider e-mail |
| Płatności | Wyłącznie Paynow i PLN | Architektura `payments.provider` pozwala później dodać dostawcę bez zmiany modelu zgłoszeń |

---

## 10. Decyzje przed kodem

Przed implementacją M0 należy potwierdzić operacyjnie:

1. Docelową domenę produkcyjną i subdomenę, pod którą będzie działał formularz oraz webhook.
2. Konto Sandbox Paynow, Api-Key i Signature-Key.
3. Czy telefon ma być obowiązkowy dla wszystkich wydarzeń czy konfigurowalny per formularz.
4. Ostateczny czas rezerwacji: w tej specyfikacji 15 minut (`900` sekund).
5. Tekst i hosting regulaminu oraz polityki prywatności, wraz z identyfikatorami ich wersji.
6. Metodę regularnego backupu PostgreSQL w Dokploy/VPS.
7. Zachowanie Paynow Payment Recovery w sandboxie i wybór finalnego wariantu retry.

---

*Koniec specyfikacji v2.0. Implementację należy rozpocząć od M0 dopiero po akceptacji tej wersji dokumentu.*
