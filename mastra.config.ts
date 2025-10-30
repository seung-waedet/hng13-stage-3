import { defineConfig } from '@mastra/core';

export default defineConfig({
  tools: {
    // Define your tools if any (though they're in the agent)
  },
  agents: {
    // The agents will be detected automatically from your mastra directory
  },
  server: {
    // Specify the path to your A2A endpoints if needed
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  }
});
