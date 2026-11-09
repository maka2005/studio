# Security operations runbook

This runbook contains response steps only. Never paste active tokens, passwords, recovery keys, or service-role keys into issues, chat, screenshots, or Git.

## Suspected credential or data exposure

1. Record what was exposed, where, and when. Preserve relevant deployment and Supabase logs.
2. If a Telegram bot token may be exposed, revoke it with BotFather, set the new `TELEGRAM_BOT_TOKEN` in Supabase Edge Function secrets, and set the webhook again with the existing webhook URL and a newly generated `TELEGRAM_WEBHOOK_SECRET`.
3. If a Supabase service-role/secret key may be exposed, rotate it in Supabase API settings, update Edge Function secrets and deployment environments, redeploy functions, then verify public booking, Telegram notifications, owner login, and uploads.
4. Revoke affected owner/staff sessions from Supabase Auth. If the owner cannot sign in, use the Supabase project administrator account; the account recovery key only works after it was generated and saved.
5. Do not rotate keys just because a scanner reports a placeholder or public anon/publishable key. Rotate only the credential that was actually exposed.

## Suspected personal-data incident

1. Restrict the affected account or deployment and stop ongoing access where practical.
2. Preserve audit events and logs; do not delete evidence.
3. Notify the studio owner and the person responsible for privacy/legal decisions. Determine affected data, people, time range, and whether access or exfiltration occurred.
4. The data controller decides notification to affected people and authorities under applicable law. Record the decision and timeline.
5. Rotate exposed credentials, revoke sessions, patch the cause, and document verification before restoring access.

## Owner and staff access

- Owner/staff passwords are stored by Supabase Auth, not in this repository.
- Staff can receive a one-time temporary password from an owner/manager. Pass it to the employee privately; they must change it at first sign-in.
- Each user should create and privately save a recovery key in **Мой доступ**. It is shown once and is not emailed.
- If both the owner password and recovery key are lost and no second administrator can reset it, recover the owner through the Supabase project administrator account.
- Review **История** after adding/removing staff, changing roles, or resetting passwords.

## Required project-owner checks

- In Supabase Auth settings, enable TOTP MFA for owner accounts, require the strongest supported assurance level, enroll each owner, and test a fresh login before enforcing it for the project. Do not enforce AAL2 until owners can complete the challenge flow.
- Enable leaked-password protection if available on the current Supabase plan. Check password minimum length and rate limits.
- Confirm the Supabase backup/point-in-time recovery plan and retention in the project dashboard. Test restore only into an isolated Supabase project/branch; never test by overwriting production.
- Configure alerts in the hosting/database monitoring service for 429/403 spikes, failed Edge Functions/webhooks, and LLM budget usage. Edge Function logs and the `llm_budget` table are the initial investigation sources.
- Confirm the studio's chosen retention period in its privacy policy and **Документы**. Automated anonymization runs only when `retention_days` is configured; the owner must choose a period that matches its policy and applicable obligations.

## Current architecture notes

- Owner and staff sessions use same-origin `HttpOnly`, `Secure` (production), `SameSite=Strict` cookies through `/api/owner`; owner access and refresh tokens are not returned to browser JavaScript. The endpoint proxies only allowlisted RPCs and authenticated owner functions.
- Customer profile sessions still use the Supabase browser client and browser storage. This is separate from owner/staff access and retains the usual XSS exposure for those customer sessions.
- After deploying the cookie flow, verify owner login, refresh after expiry, logout, staff role limits, reports, service edits, and image upload/removal on the production domain. If a browser still carries a legacy owner Supabase session, signing in through the new flow removes that matching browser session.
- CSP remains in Report-Only. It records violations but does not block scripts; review reports and resolve app-origin violations before considering an enforcing policy.
