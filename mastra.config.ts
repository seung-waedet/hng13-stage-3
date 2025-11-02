import { Mastra } from "@mastra/core";
import { transcriptAgent } from "./src/mastra/agents/transcript-agent";

export const mastra = new Mastra({
  agents: {
    transcriptAgent,
  },
  server: {
    port: 4111,
  },
  telemetry: {
    enabled: false,
  },
});

export default mastra;
