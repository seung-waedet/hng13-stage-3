import { Hono } from "hono";
import { transcriptAgent } from "../agents/transcript-agent";

// Create a router for A2A communication
const a2aRouter = new Hono();

// Set up the A2A endpoint for the transcript agent
a2aRouter.post("/agent/transcriptAgent", async (c) => {
  const body = await c.req.json();
  
  // Process the A2A request using JSON-RPC 2.0 format
  if (body.method === "generate") {
    const result = await transcriptAgent.generate(body.params.message);
    
    return c.json({
      jsonrpc: "2.0",
      id: body.id,
      result
    });
  }
  
  return c.json({
    jsonrpc: "2.0",
    id: body.id,
    error: {
      code: -32601,
      message: "Method not found"
    }
  }, 400);
});

export default a2aRouter;