import { defineConfig } from "@mastra/core";

export default defineConfig({
  server: {
    port: 4111,
  },
  telemetry: {
    enabled: false,
  },
});
