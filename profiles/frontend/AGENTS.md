# Frontend profile — Next.js apps

Applies to every 33Labs Next.js repo. A repo's own `AGENTS.md` adds product
context and documented exceptions; where the two disagree, the repo file wins
only if it says *why*.

Anything a linter can check lives in `eslint.config.mjs` beside this file, not
here. Exact versions live in the repo template's `package.json`.

## Baseline

- **Next.js 16, React 19, TypeScript `strict`, Tailwind v4, Node 22, npm.**
- This Next.js has breaking changes from most training data. Read the relevant
  guide in `node_modules/next/dist/docs/` before writing routing, caching or
  request-interception code.
- Request interception is **`proxy.ts`**. `middleware.ts` is deprecated — never
  create one.
- App Router only. Server components by default; add `"use client"` where the
  component needs state, effects or browser APIs, not at the top of a tree.

## Libraries

One default per category. **Allowed** needs a reason in the PR. Anything not
listed needs approval before it is added. *(house)* marks a 33Labs convention
rather than an industry default.

| Category | Default | Allowed | Banned |
|---|---|---|---|
| UI primitives | shadcn on Base UI (`@base-ui/react`) | Radix, in repos already on it | Headless UI, MUI, Chakra |
| Icons *(house)* | `@phosphor-icons/react` or `@tabler/icons-react` — one per repo, named in its `AGENTS.md` | Lineicons, `@heroicons/react`, `@radix-ui/react-icons`; `lucide-react` in repos already on it, not in new ones | `react-icons`, hand-written SVG icons |
| Styling | Tailwind v4, `@theme` tokens in `globals.css` | — | CSS-in-JS, `tailwind.config.*` (v3) |
| Class merging | `cn()` from `@/lib/utils` | the `cn` package (shadcn's drop-in for `clsx` + `tailwind-merge`) | |
| Server state | TanStack Query over `fetch` | `axios` — prefer `fetch`, which Next caches and dedupes | |
| API client (apps with a backend) | `openapi-fetch` + types from `openapi-typescript` | — | |
| Client state | context or `useState` | `zustand` for genuinely shared client state | Redux |
| Validation | `zod` v4 | — | `yup` |
| Forms | `react-hook-form` + `@hookform/resolvers/zod` | `@tanstack/react-form` | |
| Dates | `date-fns` | — | `moment`, `dayjs` |
| Toasts | `sonner` | — | `react-hot-toast`, `react-toastify` |
| Animation | `tw-animate-css`; `motion` for JS-driven animation | `gsap` on marketing sites | `framer-motion` (renamed `motion`), `tailwindcss-animate` (v3 only) |
| Theming | `next-themes` | — | |
| Charts | `recharts` | — | |
| Product analytics | `posthog-js`, set up per `docs/decisions/0001-posthog.md`; replay and autocapture off | — | |
| Website analytics (marketing sites) | GA4 with Consent Mode v2 behind the shared cookie banner | Vercel Analytics; Plausible or Umami where no ads run | |
| Auth | Supabase Auth via `@supabase/ssr` | Clerk, Better Auth | auth written from scratch |
| Database access | through the backend; `@supabase/supabase-js` for Auth only | Prisma, when the app owns its database | |
| Lint / format | ESLint 9 + `eslint-config-next` | Prettier for formatting | Biome |
| Unit tests | `vitest` | invariant scripts in `npm run verify` *(house — see DM-frontend)* | Jest |

## Patterns

- **Auth is enforced in server layouts, not components.** `proxy.ts` may
  refresh and redirect; the layout's check is the boundary. Role checks read
  one policy file, never `role === "…"` literals in pages.
- **Only `lib/auth/` imports the auth provider's SDK.** Components and pages
  read the user through it, so changing provider touches one folder.
- **Decide on verified claims only.** With Supabase that means
  `supabase.auth.getClaims()`; `getSession()` reads an unverified cookie —
  fine for forwarding a token, never for deciding.
- **No service-role key in a frontend repo.** If an app has a backend, tenant
  data goes through it; no Next route handler reads tenant data directly.
- **API types are generated, not hand-written.** Run `openapi-typescript` on
  a committed snapshot of the backend's `/docs-json`, and call the backend
  through `openapi-fetch`, so a wrong path or body is a compile error. Where
  the spec has no response type yet, hand-write it beside the hook that uses
  it and ask the backend to declare it.
- **One query-key factory per app** (`lib/query/keys.ts`) and one hook per
  domain resource in `hooks/`. Components get a hook, not a client — the hook
  is what absorbs a backend change.
- **Reshape data only where the UI needs a different shape** (parsed dates,
  labels, merged responses), inside the hook or TanStack Query's `select`. No
  separate mapping layer.
- **Never call an endpoint you have not confirmed exists.**

## Checks

- `npm run verify` is the single gate: secret guard → lint → `next typegen`
  → `tsc --noEmit` → any `check:*` scripts. Pre-push and CI both run it, so
  they cannot drift. `next typegen` is what makes `tsc` pass on a fresh
  checkout: Next 16's route types (`LayoutProps`, `PageProps`) are generated.
- Pre-commit runs secret guards only, and stays under a second *(house)*.
- Hooks are read-only — nothing with `--fix`. Use Husky; never write to
  `.git/hooks/`.
- CI calls the shared `frontend-ci` workflow.

## Reference code

New code should look like DM-frontend:

- `lib/auth/access.ts` + `lib/auth/session.ts` — one policy, two layers
- `lib/api/` — the client and its error envelope (not the hand-written types
  or mapper; see the API types pattern)
- `lib/query/keys.ts` and `hooks/use-*-api.ts` — query keys and resource hooks
- `CONTRIBUTING.md` — hooks, `verify`, and their time budgets

## Exceptions

A repo that differs states it in its own `AGENTS.md`: what, why, and who owns
the decision. An exception without a reason is a bug in the repo.
