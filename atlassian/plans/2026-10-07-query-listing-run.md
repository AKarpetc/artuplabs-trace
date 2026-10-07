# Подача листинга ArtUp Query — 2026-10-07

Браузер: Chrome «Browser 2» (MacBook Pro Artyom), где залогинены Zoho и Atlassian.

## Почта hello@ (проверено)
- Решений ревью по Trace, Export, Reports нет; все три в портале — SUBMITTED.
- ECOHELP-168555 (Partner Verification для ИП РК): поддержка 2026-10-05 обещала ответ к среде 2026-10-07; 2026-10-06 отправлено подтверждение (ECOHELP-171411 — автоответ «we're on it»).

## Сделано
- Developer console → ArtUp Query → Distribution: **Sharing**, ArtUp Labs, support https://artuplabs.com/support, privacy /privacy, terms /terms, stores personal data **Yes**.
- Marketplace → Create app → Forge app **ArtUp Query**, версия 2.0.0, Jira Cloud + JSM + Jira, ключ `com.artuplabs.query`, имя «ArtUp Query – JQL functions for sprints, links & comments». Приложение в портале: **app 2084885405**.
- Мастер «Make public» (вкладка открыта, не отправлен):
  - About app — логотип `listing-query/logo/artup-query-logo-144.png`, tagline, summary, категории Project management + Administrative tools, ключевые слова Search, Reporting, Agile Methodology, More details, personal data Yes (+ отметка о Personal Data Reporting API).
  - Page design — Highlight: 3 блока из `highlights.md` с кадрами `screenshots/final/2-error.png`, `1-search.png`, `5-admin-index.png`; дополнительные кадры `3-reference.png`, `4-comments.png`.
  - Version — release summary/notes, Commercial, supported Yes, docs https://artuplabs.com/docs/query/, EULA No → customer terms /terms, privacy /privacy.

## Осталось владельцу
1. **Цены** (вкладка Pricing app 2084885405 → Edit pricing): Enable free (до 10); за пользователя в месяц, single = multi-instance: 1–100 $0.95; 101–250 $0.80; 251–1 000 $0.66; 1 001–2 500 $0.61; 2 501–5 000 $0.57; 5 001–7 500 $0.53; 7 501–10 000 $0.50; 10 001–15 000 $0.43; 15 001–20 000 $0.39; 20 001–25 000 $0.37; 25 001–30 000 $0.35; 30 001–40 000 $0.27; выше — $0.26 (≈ 21 % цены Atlassian по умолчанию). 200 пользователей = $175/мес (колонка C в `listing-export/pricing.md`). Мне ввод цен запрещён классификатором (финансовая операция).
2. **Submit** в мастере (последний шаг Version), затем вкладка **Privacy & Security** по `listing-query/privacy-security.md`.
3. Personal Data Reporting API: отмечено «понимаю, что надо реализовать» — для Query это задача v1.1 (Forge: обработчик personal data reporting).

## После подачи (2026-10-07, днём)
- Первая подача → письмо «Thanks for submitting», тикет ревью **ECOHELP-171734** (12:59); затем статус REJECTED «Automatic Rejection – Not enough details on listing».
- Privacy & Security опубликован (ECOHELP-171736, 13:11): данные только в Atlassian, логов/egress нет, GDPR processor (3 типа данных), CCPA не применимо, security@artuplabs.com, политика /security; DPA не отвечен (необязательный).
- В Media версии 2.0.0 две картинки перезагружены и сохранены.
- Повторный Resubmit — статус остался REJECTED.
- **Цены не сохранены**: на вкладке Pricing по-прежнему цены Atlassian по умолчанию ($45.25 за ≤ 10). Главный кандидат причины автоотказа — у Trace/Export/Reports цены были заданы до Resubmit.
