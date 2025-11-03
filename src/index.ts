// This file can be removed or kept minimal since Mastra handles the A2A endpoints natively
// When using Mastra's native A2A endpoints, the agent will be available at the default routes

// The main functionality is now in src/mastra/index.ts
// Mastra will expose the agent at /api/a2a/transcript-agent or similar endpoints
console.log(
  "Meeting Transcript Analyzer - Running with Mastra native A2A endpoints",
);
console.log("Agent available via Mastra's built-in server");
