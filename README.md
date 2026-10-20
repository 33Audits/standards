# 33Labs standards

Shared rules for every 33Labs repo, by stack, published as
`@33audits/standards` on GitHub Packages.

```
profiles/<stack>/        rules (AGENTS.md) and the lint config that enforces them
starters/<stack>/        files `init` writes into a project
bin/cli.mjs              `33labs-standards init` and `guard-secrets`
docs/decisions/          why a standard is what it is
.github/workflows/       reusable CI per stack, and the release workflow
```

Stacks: `frontend` (Next.js) and `backend` (NestJS). Solidity and Rust come
next.

## One-time setup per machine

Installs come from GitHub Packages, which needs a token:

1. Create a GitHub token with `read:packages`.
2. Add `export NPM_TOKEN=<token>` to your shell profile.

## New project

```bash
npx create-next-app@16 my-app        # or: npx @nestjs/cli new my-api
cd my-app && git init && git add -A && git commit -m init
npx github:33Audits/standards init frontend   # or: backend
npm install
```

`init` adds the profile import to `AGENTS.md`, the lint config, Husky hooks,
CI, Dependabot, `.npmrc` and the `verify` script. It extends `AGENTS.md`,
`CLAUDE.md` and `.npmrc` rather than overwriting them, and refuses to run on
uncommitted changes, so its result is one reviewable diff. Running it again
changes nothing.

Then:

- Fill in the product section of `AGENTS.md`.
- Add `NPM_TOKEN` to the Vercel project's environment variables.

## Existing project

Same command. Commit first, run `init`, read the diff. Anything the project
deliberately does differently goes under "Exceptions" in its `AGENTS.md`.

## After adoption

- **Rules reach the agent** through the `AGENTS.md` import (Claude Code reads
  it once `npm install` has run).
- **ESLint** enforces the banned libraries.
- **Pre-commit** blocks secrets; **pre-push** and **CI** run `npm run verify`.
- **Dependabot** opens a PR when a new standards release ships. Add a
  `DEPENDABOT_NPM_TOKEN` secret (Settings → Secrets → Dependabot) for it to
  reach GitHub Packages.

## Changing a standard

1. Open a PR here. A ban changes both the profile's `AGENTS.md` and its
   `eslint.config.mjs`; longer reasoning goes in `docs/decisions/`.
2. Bump `version` in `package.json`, merge, and push a matching tag
   (`v1.2.0`). The release workflow publishes the package and moves the `v1`
   tag that product CI calls.
3. Product repos pick it up through Dependabot.

## GitHub settings this needs

- **Package access:** in the package's settings, give product repos read
  access, so their CI's `GITHUB_TOKEN` can install it.
- **Actions access:** Settings → Actions → General → "Accessible from
  repositories in the organization", so product repos can call the shared
  workflows.
