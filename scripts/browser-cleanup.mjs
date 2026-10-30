import { spawnSync } from "node:child_process";

/** Chrome can finish every assertion and hang during DevTools shutdown.
 * Bound cleanup of this test's own browser; verdicts and exit codes remain
 * entirely the caller's. Never kill an unrelated interactive browser. */
export async function closeBrowser(browser) {
  const proc = browser.process();
  let timer;
  const closed = await Promise.race([
    browser.close().then(() => true, () => false),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), 10_000); }),
  ]);
  clearTimeout(timer);
  if (closed) return;
  console.warn("[verify] Chrome shutdown stalled; cleaning up this test's browser.");
  if (proc?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", timeout: 5000 });
    else { try { proc.kill("SIGKILL"); } catch { /* already exited */ } }
  }
  await browser.disconnect().catch(() => {});
}
