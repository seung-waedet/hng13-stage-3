import { mastra } from "./mastra";
import a2aRouter from "./mastra/routes/a2aRoute";

// Register the A2A router
mastra.app.route("/a2a", a2aRouter);

// Add health check endpoint
mastra.app.get("/health", (c) => c.json({ status: "ok" }));

console.log("Meeting Transcript Analyzer - Running with Mastra");
console.log("Server available at http://localhost:4111");
