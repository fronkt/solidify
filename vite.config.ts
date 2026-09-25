import { defineConfig } from "vite";
import { resolve } from "path";
import { execSync } from "node:child_process";

/**
 * The build a figure export names in its provenance (src/main.ts BUILD, U2):
 * the commit, "+local" when the tree had uncommitted changes, or Vercel's own
 * commit variable where there is no .git; "dev" when neither answers.
 */
function buildId(): string {
  const sh = (cmd: string) => execSync(cmd, { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    const sha = sh("git rev-parse --short HEAD");
    return sh("git status --porcelain --untracked-files=no") ? `${sha}+local` : sha;
  } catch {
    return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
  }
}

export default defineConfig({
  base: "./",
  define: { __SOLIDIFY_BUILD__: JSON.stringify(buildId()) },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app/index.html"),
        science: resolve(__dirname, "science/index.html"),
        contact: resolve(__dirname, "contact/index.html"),
      },
    },
  },
});
