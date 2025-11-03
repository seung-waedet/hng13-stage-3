import { defineConfig } from "@mastra/core";

export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "4111"),
    host: "0.0.0.0",
    hostname: "0.0.0.0",
  },
  telemetry: {
    enabled: false,
  },
});
