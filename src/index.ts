import "dotenv/config"; // Ensure environment variables are loaded
import express from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { transcriptAgent, mastra } from "./mastra";

// Swagger configuration
const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Meeting Transcript Analyzer API",
      version: "1.0.0",
      description:
        "A2A Protocol compliant API for analyzing meeting transcripts with Mastra",
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3000}`,
        description: "Development server",
      },
    ],
  },
  apis: ["./src/index.ts"],
};

const app = express();
app.use(express.json());

const specs = swaggerJsdoc(options);

// Swagger UI middleware
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

/**
 * @swagger
 * /api/a2a/transcript-analyzer:
 *   post:
 *     summary: Analyze meeting transcript
 *     description: Accepts a meeting transcript and returns structured analysis including summary, action items, and key decisions
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jsonrpc:
 *                 type: string
 *                 example: "2.0"
 *               method:
 *                 type: string
 *                 example: "a2a.task.execute"
 *               params:
 *                 type: object
 *                 properties:
 *                   message:
 *                     type: object
 *                     properties:
 *                       parts:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             text:
 *                               type: string
 *                               example: "Meeting transcript content here..."
 *                   taskId:
 *                     type: string
 *                     example: "task-123"
 *                   conversationId:
 *                     type: string
 *                     example: "conv-456"
 *               id:
 *                 type: string
 *                 example: "request-id-789"
 *     responses:
 *       200:
 *         description: Successful response with analysis
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jsonrpc:
 *                   type: string
 *                   example: "2.0"
 *                 result:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: object
 *                       properties:
 *                         role:
 *                           type: string
 *                           example: "agent"
 *                         parts:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               text:
 *                                 type: string
 *                                 example: "## Meeting Summary\n..."
 *                     artifacts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                             example: "text/markdown"
 *                           title:
 *                             type: string
 *                             example: "Meeting Analysis"
 *                           content:
 *                             type: string
 *                             example: "## Meeting Summary\n..."
 *                           metadata:
 *                             type: object
 *                             properties:
 *                               generatedAt:
 *                                 type: string
 *                                 example: "2025-10-30T12:00:00Z"
 *                               wordCount:
 *                                 type: number
 *                                 example: 250
 *                               analysisLength:
 *                                 type: number
 *                                 example: 500
 *                     context:
 *                       type: object
 *                       properties:
 *                         taskId:
 *                           type: string
 *                           example: "task-123"
 *                         conversationId:
 *                           type: string
 *                           example: "conv-456"
 *                 id:
 *                   type: string
 *                   example: "request-id-789"
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jsonrpc:
 *                   type: string
 *                   example: "2.0"
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: number
 *                       example: -32600
 *                     message:
 *                       type: string
 *                       example: "Invalid Request"
 *                 id:
 *                   type: string
 *                   example: null
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jsonrpc:
 *                   type: string
 *                   example: "2.0"
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: number
 *                       example: -32603
 *                     message:
 *                       type: string
 *                       example: "Internal error"
 *                     data:
 *                       type: string
 *                       example: "Error details"
 *                 id:
 *                   type: string
 *                   example: null
 */

// A2A endpoint handler
app.post("/api/a2a/transcript-analyzer", async (req, res) => {
  try {
    const { jsonrpc, method, params, id } = req.body;

    // Validate JSON-RPC 2.0 format
    if (jsonrpc !== "2.0" || method !== "a2a.task.execute") {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid Request",
        },
        id: id || null,
      });
    }

    // Extract user message
    const userMessage = params?.message?.parts?.[0]?.text || "";

    if (!userMessage) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32602,
          message: "Invalid params: message text required",
        },
        id: id || null,
      });
    }

    // Generate the transcript analysis using the agent
    const result = await transcriptAgent.generate(
      `Please analyze this meeting transcript:\n\n${userMessage}`,
      {
        onStepFinish: (step: any) => {
          console.log("Step finished:", step?.text);
        },
      },
    );

    // Extract the response text
    const analysisText = result.text || "Unable to generate analysis.";

    // Create A2A compliant response with artifacts
    const a2aResponse = {
      jsonrpc: "2.0",
      result: {
        message: {
          role: "agent",
          parts: [
            {
              text: analysisText,
            },
          ],
        },
        artifacts: [
          {
            type: "text/markdown",
            title: "Meeting Analysis",
            content: analysisText,
            metadata: {
              generatedAt: new Date().toISOString(),
              wordCount: userMessage.split(/\s+/).length,
              analysisLength: analysisText.length,
            },
          },
        ],
        context: {
          taskId: params.taskId || `task-${Date.now()}`,
          conversationId: params.conversationId || `conv-${Date.now()}`,
        },
      },
      id,
    };

    res.json(a2aResponse);
  } catch (error: any) {
    console.error("Error processing A2A request:", error);

    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal error",
        data: error.message,
      },
      id: req.body.id || null,
    });
  }
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the health status of the service
 *     responses:
 *       200:
 *         description: Service is operational
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 agent:
 *                   type: string
 *                   example: "Meeting Transcript Analyzer"
 */

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", agent: "Meeting Transcript Analyzer" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Meeting Transcript Analyzer A2A endpoint running on port ${PORT}`,
  );
});

export default app;
