import { spawn } from "node:child_process";

const env = { ...process.env, NODE_ENV: "production" };

const run = (cmd, args, opts = {}) => {
  return spawn(cmd, args, {
    env,
    stdio: "inherit",
    ...opts,
  });
};

// Start the server ASAP so platform healthchecks can pass.
const server = run("tsx", ["server.ts"]);

// Run migrations in the background (retry logic is handled by migrate-deploy.mjs).
// If migrations fail, we keep the server running; logs will show the error.
setTimeout(() => {
  const migrate = run("node", ["scripts/migrate-deploy.mjs"]);
  migrate.on("exit", (code) => {
    if (code === 0) return;
    console.error(`[migrate] exited with code ${code}`);
  });
}, 500);

server.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(typeof code === "number" ? code : 1);
});
