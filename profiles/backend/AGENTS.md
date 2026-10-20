# Backend profile — NestJS services

Applies to every 33Labs Node backend. A repo's own `AGENTS.md` adds product
context and documented exceptions; where the two disagree, the repo file wins
only if it says *why*.

Anything a linter can check lives in `eslint.config.mjs` beside this file, not
here. Exact versions live in the repo template's `package.json`.

## Baseline

- **NestJS 11, TypeScript, Node 22, npm.** New repos use `strict: true`.
- Prisma 7 on Postgres (Supabase), through the `pg` driver adapter.
- Every route lives under `/api/v1`. Swagger serves the spec at `/docs-json`;
  frontends generate their types from it, so a route rename is a breaking
  change.
- **Every endpoint declares its response** with `@ApiOkResponse({ type })`
  (or `@ApiCreatedResponse`) and a response DTO class. Returning a Prisma
  object leaves the spec empty and forces frontends to hand-write types.
- **Serve the spec from `nest build` output.** The `@nestjs/swagger` plugin
  that fills in DTO fields runs only inside `nest build`; a Vercel entry that
  imports `src/` directly ships a spec with empty schemas.

## Libraries

One default per category. **Allowed** needs a reason in the PR. Anything not
listed needs approval before it is added. *(house)* marks a 33Labs convention
rather than an industry default.

| Category | Default | Allowed | Banned |
|---|---|---|---|
| Framework | NestJS on Express | — | bare Express/Fastify apps, Hono |
| Database | Prisma 7 + `@prisma/adapter-pg` | `prisma.$queryRaw` inside the tenant transaction, for what Prisma cannot express; Drizzle, with its own tenant-transaction wrapper | TypeORM, Sequelize, Mongoose, Knex, a separate `pg` client for tenant data |
| Request validation | `class-validator` + `class-transformer` DTOs | — | hand-rolled `if` checks in controllers |
| External-input validation | `zod` v4 for model output, webhooks, third-party payloads | — | `yup`, `joi` |
| Identity provider | Supabase Auth | Clerk, Better Auth; Convex needs its own profile | auth written from scratch |
| Token verification | the provider's server SDK (`@supabase/server`, `@clerk/backend`) | `passport-jwt` + `jwks-rsa`, issuer and JWKS URL from config | HS256 shared-secret JWT verification |
| Config | `@nestjs/config` | — | reading `process.env` outside config |
| Logging | Nest `Logger` | — | `console.*` |
| Background work *(house)* | Vercel Queues + an outbox column + cron | — | Redis/BullMQ without approval |
| API docs | `@nestjs/swagger` | — | |
| Email *(house)* | Resend | — | |
| Analytics / errors *(house)* | PostHog (`posthog-node`), set up per `docs/decisions/0001-posthog.md` | — | |
| Dates | `date-fns` | — | `moment`, `dayjs` |
| Tests | Jest + `ts-jest`, `supertest` for e2e | — | |
| Lint / format | ESLint 9 + `typescript-eslint` type-checked, Prettier | — | Biome |

## Patterns

- **Auth runs in global guards, in this order:** verify the JWT → check
  `@Roles` → check tenant scope. Roles and tenant ids come from
  server-controlled claims (Supabase `app_metadata`, Clerk org claims), never
  user-editable metadata. A token with no role — or, on a tenant route, no
  tenant — is rejected; there is no default role.
- **Provider claims are mapped in one place.** The auth guard turns the
  provider's token into an internal `{ userId, firmId, role }`; roles, scoping
  and `set_config` read only that. Changing provider means a new mapping, not
  a rewrite.
- **Postgres RLS is the tenant boundary.** Every tenant-owned table has
  policies comparing its tenant column (or its parent's) to
  `nullif(current_setting('app.firm_id', true), '')` — after a transaction
  the setting reads `''`, which a `::uuid` cast rejects with an error. An
  unset tenant matches no rows, and
  a bug in app code — a nested write, a raw query — still cannot reach
  another firm's data. Guards reject early; RLS is what holds.
- **A Prisma Client extension sets the tenant.** It runs each query in a
  transaction that first calls `set_config('app.firm_id', <firm from the
  verified token>, true)`. It may also add the tenant to `where` for readable
  queries and index use; that filter is a convenience, not the boundary.
- **Cross-firm work uses a separate, named client.** Queue consumers, cron
  jobs and platform admins get it from one injectable, backed by a role that
  bypasses RLS. Platform-admin access through it is audit-logged.
- **A missing record and another tenant's record both return 404.** Never
  leak that something exists.
- **No repository layer over Prisma** *(house)*. Services call the extended
  Prisma client directly.
- **One module per domain resource**, with request shapes in its `dto/`
  folder.
- **Errors are Nest `HttpException`s, returned as RFC 9457 Problem Details**
  (`application/problem+json`), with per-field validation errors in an
  `errors` extension member. The global `ValidationPipe` runs with
  `whitelist`, `forbidNonWhitelisted` and `transform`, and its
  `exceptionFactory` builds that shape.
- **Tenant-scoped responses send `Cache-Control: no-store`.**
- **Never leave a promise unawaited.** In a serverless runtime it is a write
  that silently never happens.

## Database

- **Local `DATABASE_URL` points at a local or dev database, never
  production.**
- **Generate migrations, then review the SQL:**
  `npx prisma migrate dev --create-only --name <change>` against that
  database. Add what Prisma cannot express (RLS, backfills) to the generated
  file, with a one-line header saying why.
- **The app connects as its own role, never `postgres`.** That role lacks
  `BYPASSRLS`; only the cross-firm role has it.
- **Every new table enables RLS** (`ENABLE` and `FORCE ROW LEVEL SECURITY`)
  **and ships its policies in the same migration** — tenant policies for
  tenant data, an explicit read policy for global tables. Prisma generates
  neither.
- **Supabase only:** `anon` and `authenticated` get no grants, because
  Supabase exposes tables through PostgREST and nothing should use it.
- **Never run `migrate dev`, `migrate reset` or `db push` against a shared or
  production database.** Production gets `prisma migrate deploy`, run by the
  repo owner; say when a migration is unapplied.
- After a schema change: `npx prisma format && npx prisma validate && npx
  prisma generate`.
- Runtime uses the pooled URL (`DATABASE_URL`); migrations use the direct URL
  (`DIRECT_URL`) in `prisma.config.ts`. Keep the pool small.

## Checks

- `npm run verify` is the single gate: secret guard → lint → `tsc --noEmit` →
  Jest. Pre-push and CI both run it.
- **A cross-tenant test covers every tenant-owned table:** as firm A, firm
  B's rows must be invisible. A new table without one fails review.
- Lint runs **without `--cache`**: type-aware rules depend on other files, so
  a cached run can report a false green.
- Pre-commit runs the secret guard only *(house)*. Hooks are read-only; Husky, never
  `.git/hooks/`.
- CI calls the shared `backend-ci` workflow, which adds `nest build` and a
  check that `schema.prisma` matches the migration history.

## Reference code

New code should look like dm-backend:

- `src/auth/` — guards, strategies and the roles decorator
- `MatterScopeService` *(house)* — explicit, per-call tenant scoping; it
  predates the RLS rule and shows the check, not the mechanism
- `src/common/validation-exception-factory.ts` — how to hook the
  `exceptionFactory`; its `{ code, details }` shape predates the RFC 9457 rule
- `ARCHITECTURE.md` §6 — the queue, outbox and reconciler pattern

## Exceptions

A repo that differs states it in its own `AGENTS.md`: what, why, and who owns
the decision. An exception without a reason is a bug in the repo.
