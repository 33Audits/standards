# 0001 — PostHog for product analytics

**Status:** Proposed · **Date:** 2026-10-20 · **Applies to:** product apps (DM-frontend, dm-backend, and any new product)

## Decision

We stay on PostHog for product analytics and fix how we identify people and
firms. We do not switch vendors.

- **One id per person, everywhere:** the bare auth user id. The frontend
  `identify()`s with it; the backend sends the same id.
- **Firms are a group, not a person.** Every event carries the firm as
  `groups: { firm: <firmId> }` and as a `firm_id` property.
- **No fake people.** Events with no user (workers, cron) are sent without a
  person profile.
- **Frontend and backend are linked** through the PostHog session id, sent as
  a header on every API call.
- **Session replay and autocapture stay off** in product apps. They handle
  legal and financial documents, and a recording captures what is on screen.

Marketing sites keep GA4 behind the cookie banner; error tracking (Sentry) is a
separate decision.

## Why

PostHog's plumbing in dm-backend is sound: events flush before Vercel freezes
the function, callers cannot choose who they are attributed to, and event
names are constants. What is wrong is attribution, and it makes the numbers
misleading:

1. **Firms are tracked as people.** Events go to `firm:<id>`, `user:<sub>` or
   `system:dm-backend`, and PostHog counts each as a person.
2. **The same event lands on different subjects.** `safeCapture` prefers the
   request's user over the firm passed in, so an AI failure during a request
   goes to the user and the same failure in a worker goes to the firm. "Unique
   persons = affected firms" is wrong for every request-time failure.
3. **Every system event lands on one fake person**, `system:dm-backend`.
4. **The frontend is not connected.** DM-frontend has no PostHog. Adding it the
   standard way would identify users by bare id while the backend uses
   `user:<id>`, so every person would appear twice.

Switching vendors fixes none of this: Mixpanel and Amplitude model people and
organisations the same way. Moving would also throw away two working
integrations (dm-backend and spend).

## Open question: Group Analytics

PostHog's Group Analytics is a paid add-on, billed from when it is enabled on
the billing page. The fixes below send the firm both ways — as a group and as
a `firm_id` property — so:

- **Without the add-on:** count affected firms by unique `firm_id`. Correct,
  but no firm profiles or per-firm charts.
- **With it:** the same events light up firm-level reporting with no code
  change.

Owner to decide before dashboards are rebuilt. Confirm in a test project that
events with `groups` ingest normally while the add-on is off.

## Fixes

### dm-backend

1. **`src/analytics/distinct-id.ts`** — `userDistinctId(sub)` returns the bare
   `sub`. Remove `firmDistinctId` as a subject.
2. **`subjectFor` / `safeCapture`** — the subject is the verified user when
   there is one. With no user, send the event with
   `$process_person_profile: false` instead of minting a firm or system person.
   The request context sets the user; it no longer silently replaces the
   subject a caller passed.
3. **Every capture** adds `groups: { firm: firmId }` and a `firm_id` property
   when a firm is known.
4. **`src/auth/guards/supabase-auth.guard.ts`** — keep stripping PostHog
   headers on public routes, and keep overwriting the distinct id with the
   verified user, now in the bare form.
5. **Session link** — `PostHogInterceptor` already reads
   `x-posthog-session-id` into request context. Confirm on the first test event
   that backend events carry `$session_id`; if not, add it in `safeCapture`.
   CORS needs no change: no `allowedHeaders` list is set, so the browser's
   requested headers are allowed.
6. **Dashboards** — anything counting "unique persons" as firms switches to
   unique `firm_id` (or groups). Note the cutover date: person history before
   it uses the old ids and is not merged.
7. Update `distinct-id.spec.ts` and `analytics.service.spec.ts` for the new
   subjects.

### DM-frontend

1. Add `posthog-js`, initialised in one client provider with autocapture off,
   session recording off, and page views captured on route change.
2. **Only `lib/analytics/` imports `posthog-js`**, through one `track()`
   wrapper that strips sensitive properties, with event names as constants —
   the same shape as dm-backend.
3. After sign-in: `posthog.identify(sub)` with the same bare id the backend
   uses, then `posthog.group('firm', firmId)`. On sign-out: `posthog.reset()`.
4. **`apiClient`** sends `x-posthog-session-id` (from
   `posthog.get_session_id()`) on every request to dm-backend. Do not rely on
   posthog-js's `__add_tracing_headers` option — its own config reference marks
   it preview and not for production.
5. Clients (parties to a matter) are identified the same way; their firm group
   is the firm of the matter they are viewing.

### Order

Ship dm-backend fixes 1–4 first: they correct the numbers on their own. Then
DM-frontend, then the session link (backend 5).

## References

- PostHog: [group analytics](https://posthog.com/docs/product-analytics/group-analytics),
  [sessions](https://posthog.com/docs/data/sessions),
  [posthog-js config](https://posthog.com/docs/references/posthog-js-1.283.0/types/PostHogConfig)
- dm-backend: `src/analytics/`, `src/auth/guards/supabase-auth.guard.ts`
