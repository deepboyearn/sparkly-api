const fs = require("node:fs");
const path = require("node:path");
const { BridgeServer } = require("../dist-electron/main/bridgeServer.js");

async function main() {
  const configPath = path.join(process.env.APPDATA || "", "sparkly-api", "bridge-config.json");
  const raw = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(raw);
  const server = new BridgeServer();

  await server.start(config);
  const stats = server.getStats();
  console.log(JSON.stringify({
    started: true,
    localBaseUrl: stats.localBaseUrl,
    selectedModel: config.selectedModel,
    upstreamBaseUrl: config.upstreamBaseUrl,
  }, null, 2));

  process.on("SIGINT", async () => {
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
