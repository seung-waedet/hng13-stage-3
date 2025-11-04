import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { transcriptAgent } from "./agents/transcript-agent";
import { a2aAgentRoute } from "./routes/a2aRoute";

export const mastra = new Mastra({
  agents: { 
    transcriptAgent: transcriptAgent 
  },
  storage: new LibSQLStore({
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  server: {
    apiRoutes: [a2aAgentRoute],
  },
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    enabled: false,
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: { enabled: true },
  },
});
