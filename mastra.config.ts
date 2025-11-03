import { defineConfig } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    // Removed custom port to use Mastra's default (4111)
  },
  observability: {
    default: { enabled: true }, // Enables DefaultExporter and CloudExporter
  },
  storage: new LibSQLStore({
    url: ":memory:", // In-memory storage for local testing
  }),
});
