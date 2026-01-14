import { $, spawn } from "bun";
import { existsSync, readFileSync } from "fs";

export const PI_PATH = (await $`which pi`.text()).trim();

export const timestamp = () => new Date().toLocaleString();

export const hasUncommittedChanges = async () =>
  (await $`git status --porcelain`.text()).trim().length > 0;

export const recentCommit = async (withinMs = 15_000) => {
  try {
    const ts = parseInt(await $`git log -1 --format=%ct`.text()) * 1000;
    return Date.now() - ts < withinMs;
  } catch {
    return false;
  }
};

export const getCommitCount = async () => {
    try {
        return parseInt(await $`git rev-list --count HEAD`.text()) || 0;
    } catch {
        return 0;
    }
}

export async function runAgent(prompt: string, timeoutMs: number): Promise<void> {
  if (!PI_PATH) {
    throw new Error("Could not find 'pi' in PATH");
  }

  const proc = spawn([PI_PATH, "-p", prompt], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const timeout = setTimeout(() => {
    console.log(`\n⏰ Timed out after ${timeoutMs / 1000}s`);
    proc.kill();
  }, timeoutMs);

  await proc.exited;
  clearTimeout(timeout);
}

export async function push(): Promise<void> {
  console.log("🚀 Pushing to GitHub...");
  await $`git push origin main`;
}
