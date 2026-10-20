#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
const STACKS = ["frontend", "backend"];

const VERIFY = {
  frontend: "33labs-standards guard-secrets && eslint && next typegen && tsc --noEmit",
  backend: '33labs-standards guard-secrets && eslint "{src,test}/**/*.ts" && tsc --noEmit && jest --passWithNoTests',
};

function init(argv) {
  const stack = argv.find((a) => !a.startsWith("--"));
  const force = argv.includes("--force");
  if (!STACKS.includes(stack)) fail(`pick a stack: ${STACKS.join(", ")}`);

  const root = process.cwd();
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) fail("no package.json here — run this from the project root");
  // Files below get replaced; a dirty tree would make that diff unreadable.
  if (!force && gitDirty(root)) fail("commit or stash your changes first (or pass --force)");

  const report = [];
  for (const dir of ["shared", stack]) {
    const base = join(PKG_ROOT, "starters", dir);
    for (const src of walk(base)) {
      const rel = relative(base, src).split("/").map((p) => p.replace(/^_/, ".")).join("/");
      report.push(`${place(join(root, rel), readFileSync(src, "utf8"), rel)}  ${rel}`);
    }
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.devDependencies = { ...pkg.devDependencies, [PKG.name]: `^${PKG.version}`, husky: pkg.devDependencies?.husky ?? "^9.1.7" };
  pkg.scripts ??= {};
  pkg.scripts.prepare ??= "husky";
  if (!pkg.scripts.verify) pkg.scripts.verify = VERIFY[stack];
  else if (pkg.scripts.verify !== VERIFY[stack]) report.push(`kept      package.json "verify" — profile default is: ${VERIFY[stack]}`);
  if (stack === "backend") {
    pkg.prettier = `${PKG.name}/profiles/backend/prettier.json`;
    dropDuplicatePrettierrc(root, report);
    voidNestBootstrap(root, report);
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  report.push("updated   package.json");

  console.log(report.join("\n"));
  console.log(`
Next:
  1. export NPM_TOKEN=<GitHub token with read:packages>   (once, in your shell profile)
  2. npm install
  3. Fill in the product section of AGENTS.md.
  4. On Vercel, add NPM_TOKEN as an environment variable so builds can install ${PKG.name}.`);
}

// Returns a short verb for the report.
function place(dest, content, rel) {
  const exists = existsSync(dest);
  const current = exists ? readFileSync(dest, "utf8") : "";
  if (current === content) return "same    ";

  const merged = exists ? merge(rel, current, content) : content;
  if (merged === null) return "kept    ";
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, merged);
  if (rel.startsWith(".husky/")) chmodSync(dest, 0o755);
  if (!exists) return "created ";
  return merged === content ? "replaced" : "merged  ";
}

// Product-owned files are extended, never overwritten.
function merge(rel, current, starter) {
  const firstLine = starter.split("\n")[0];
  if (rel === "AGENTS.md" || rel === "CLAUDE.md") {
    return current.includes(firstLine) ? null : `${firstLine}\n\n${current}`;
  }
  if (rel === ".npmrc") {
    const missing = starter.split("\n").filter((l) => l && !current.includes(l));
    return missing.length ? `${current.trimEnd()}\n${missing.join("\n")}\n` : null;
  }
  if (rel === ".nvmrc") return null;
  return starter;
}

function dropDuplicatePrettierrc(root, report) {
  const rc = join(root, ".prettierrc");
  if (!existsSync(rc)) return;
  const ours = JSON.parse(readFileSync(join(PKG_ROOT, "profiles/backend/prettier.json"), "utf8"));
  try {
    if (JSON.stringify(JSON.parse(readFileSync(rc, "utf8"))) === JSON.stringify(ours)) {
      rmSync(rc);
      report.push("removed   .prettierrc (same as the shared config)");
      return;
    }
  } catch {}
  report.push("kept      .prettierrc — it differs from the shared config and wins over package.json; reconcile by hand");
}

// `nest new` ends main.ts with a bare `bootstrap();`, which no-floating-promises rejects.
function voidNestBootstrap(root, report) {
  const main = join(root, "src/main.ts");
  if (!existsSync(main)) return;
  const src = readFileSync(main, "utf8");
  const fixed = src.replace(/^bootstrap\(\);$/m, "void bootstrap();");
  if (fixed === src) return;
  writeFileSync(main, fixed);
  report.push("patched   src/main.ts (void bootstrap())");
}

const SECRET_PATTERNS = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Stripe live key", /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/],
  ["OpenAI key", /\bsk-proj-[A-Za-z0-9_-]{20,}/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}/],
];
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
const ENV_FILE = /^\.env(\..+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template)$/;
const ALLOW = "standards-allow-secret";

function guardSecrets(argv) {
  const staged = argv.includes("--staged");
  const files = staged
    ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    : git(["ls-files"]);
  const findings = [];

  for (const file of files) {
    const name = basename(file);
    if (ENV_FILE.test(name) && !ENV_TEMPLATE.test(name)) {
      findings.push(`${file}: env file is tracked — keep it out of git`);
      continue;
    }
    const text = staged ? gitShow(file) : readTracked(file);
    if (text === null) continue;
    text.split("\n").forEach((line, i) => {
      if (line.includes(ALLOW)) return;
      for (const [kind, re] of SECRET_PATTERNS) {
        if (re.test(line)) findings.push(`${file}:${i + 1}: ${kind}`);
      }
      for (const m of line.matchAll(JWT)) {
        if (jwtRole(m[1]) === "service_role") findings.push(`${file}:${i + 1}: Supabase service-role JWT`);
      }
    });
  }

  if (findings.length) {
    console.error(`Secrets found (${staged ? "staged" : "tracked"} files):\n  ${findings.join("\n  ")}`);
    console.error(`\nRemove them. For a deliberate test fixture, add "${ALLOW}" to that line.`);
    process.exit(1);
  }
}

function jwtRole(payload) {
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
  } catch {
    return undefined;
  }
}

function readTracked(file) {
  try {
    if (statSync(file).size > 1_000_000) return null;
    const buf = readFileSync(file);
    return buf.includes(0) ? null : buf.toString("utf8");
  } catch {
    return null; // deleted in the worktree but still in the index
  }
}

function gitShow(file) {
  try {
    const buf = execFileSync("git", ["show", `:${file}`], { maxBuffer: 10_000_000 });
    return buf.includes(0) ? null : buf.toString("utf8");
  } catch {
    return null;
  }
}

function git(argv) {
  return execFileSync("git", argv, { encoding: "utf8", maxBuffer: 100_000_000 }).split("\n").filter(Boolean);
}

function gitDirty(root) {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "";
  } catch {
    return false; // not a git repo
  }
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Last, so every constant above is initialised before a command runs.
const [command, ...args] = process.argv.slice(2);
if (command === "init") init(args);
else if (command === "guard-secrets") guardSecrets(args);
else {
  console.log(`usage:
  33labs-standards init <${STACKS.join("|")}> [--force]   add a stack profile to this repo
  33labs-standards guard-secrets [--staged]            fail if a secret is committed`);
  process.exit(command ? 1 : 0);
}
