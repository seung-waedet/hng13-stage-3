import { mastra } from "./mastra";
import a2aRouter from "./mastra/routes/a2aRoute";

// Register the A2A router
mastra.app.route("/a2a", a2aRouter);

console.log("Meeting Transcript Analyzer - Running with Mastra");
console.log(`Server available at http://localhost:${process.env.PORT || 4111}`);
