import { defineConfig } from "@mastra/core";

export default defineConfig({
  server: {
    port: 4111,
    host: "0.0.0.0",
  },
  telemetry: {
    enabled: false,
  },
});
