import fs from "node:fs/promises";
import config from "./cloudflare.config.ts";
// This dependency-free Worker needs no bundler. Emit cf's validated Build
// Output Specification so deployments use the same reviewed source file.
const out = new URL("./.cloudflare/output/v0/", import.meta.url);
const bundle = new URL("workers/default/bundle/", out);
await fs.mkdir(bundle, { recursive: true });
const { entrypoint, ...worker } = config.worker;
await fs.copyFile(
  new URL(entrypoint, import.meta.url),
  new URL("index.js", bundle),
);
await fs.writeFile(
  new URL("config.json", out),
  JSON.stringify({
    accountId: config.accountId,
    buildContext: { isPreview: false },
  }),
);
await fs.writeFile(
  new URL("workers/default/worker.config.json", out),
  JSON.stringify({
    ...worker,
    manifest: {
      type: "complete",
      mainModule: "index.js",
      modules: { "index.js": { type: "esm" } },
    },
  }),
);
