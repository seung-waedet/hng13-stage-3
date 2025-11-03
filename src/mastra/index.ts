import { Mastra } from "@mastra/core";
import { transcriptAgent } from "./agents/transcript-agent";
import { LibSQLStore } from "@mastra/libsql";

// Initialize Mastra with our agent - export as named export 'mastra' as required by CLI
export const mastra = new Mastra({
  agents: {
    transcriptAgent
  },
  storage: new LibSQLStore({
    url: ":memory:"
  }),
  observability: {
    default: { enabled: true }
  }
});
