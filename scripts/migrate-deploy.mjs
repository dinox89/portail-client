import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const maxAttempts = Number(process.env.PRISMA_MIGRATE_DEPLOY_RETRIES ?? 8);
const baseDelayMs = Number(process.env.PRISMA_MIGRATE_DEPLOY_DELAY_MS ?? 1500);
const maxDelayMs = Number(process.env.PRISMA_MIGRATE_DEPLOY_DELAY_MAX_MS ?? 15000);

const buildEnv = () => {
  const env = { ...process.env };

  // Neon poolers sometimes error without advisory locks; keep prior behavior.
  env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK = env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK || "1";

  // Optional: use a direct endpoint for migrations only.
  // If provided, it overrides DATABASE_URL for the migrate process.
  if (env.DIRECT_URL && !env.DATABASE_URL?.trim()) {
    // If DATABASE_URL isn't set, Prisma would fail anyway; keep env as-is.
    // This branch is mainly to avoid surprising overrides.
  } else if (env.DIRECT_URL && env.DATABASE_URL) {
    env.DATABASE_URL = env.DIRECT_URL;
  }

  return env;
};

const runMigrateDeployOnce = async () => {
  const env = buildEnv();

  return await new Promise((resolve) => {
    const child = spawn("prisma", ["migrate", "deploy"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => resolve({ code: typeof code === "number" ? code : 1, output }));
  });
};

const isReachabilityError = (output) => {
  const text = String(output || "");
  return (
    text.includes("P1001") ||
    text.includes("Can't reach database server") ||
    text.includes("ECONNREFUSED") ||
    text.includes("ETIMEDOUT") ||
    text.includes("ENOTFOUND")
  );
};

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const { code, output } = await runMigrateDeployOnce();

  if (code === 0) {
    process.exit(0);
  }

  if (!isReachabilityError(output) || attempt === maxAttempts) {
    process.exit(code);
  }

  const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
  process.stderr.write(
    `\n[prisma] migrate deploy failed (attempt ${attempt}/${maxAttempts}). Retrying in ${Math.round(delay / 1000)}s...\n`
  );
  await sleep(delay);
}

process.exit(1);
