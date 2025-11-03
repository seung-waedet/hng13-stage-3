import { defineConfig } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";

export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "4111"),
    host: "0.0.0.0",
  },
  telemetry: {
    enabled: false,
  },
  storage: new LibSQLStore({
    url: ":memory:", // In-memory storage for local testing
  }),
});
