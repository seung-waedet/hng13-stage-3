import { createTool, Agent, Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { z } from 'zod';
import { registerApiRoute } from '@mastra/core/server';
import { randomUUID } from 'crypto';

const transcriptTool = createTool({
  id: "transcript-info",
  description: "Analyze a meeting transcript to extract key information",
  inputSchema: z.object({
    transcript: z.string().describe("The raw meeting transcript text")
  }),
  outputSchema: z.object({
    summary: z.string(),
    actionItems: z.array(z.string()),
    keyDecisions: z.array(z.string()),
    participants: z.array(z.string()),
    wordCount: z.number(),
    duration: z.string().optional(),
    topics: z.array(z.string())
  }),
  execute: async ({ context }) => {
    return await analyzeTranscriptContent(context.transcript);
  }
});
const analyzeTranscriptContent = async (transcript) => {
  if (!transcript || transcript.trim().length < 50) {
    throw new Error("Transcript too short. Please provide a meaningful meeting transcript (at least 50 characters).");
  }
  const wordCount = transcript.split(/\s+/).length;
  const participantMatches = transcript.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*:/g);
  const participants = participantMatches ? [...new Set(participantMatches.map((match) => match.replace(":", "").trim()))] : [];
  const actionItemPatterns = [
    /(?:action|todo|task|will|need(?:s)? to|should|must)\s+([^.!?]+)/gi,
    /([^.!?]*(?:by|before|due)\s+[^.!?]+)/gi
  ];
  let actionItems = [];
  actionItemPatterns.forEach((pattern) => {
    const matches = transcript.match(pattern);
    if (matches) {
      actionItems.push(...matches.map((match) => match.trim()));
    }
  });
  actionItems = [...new Set(actionItems)].slice(0, 10);
  const decisionPatterns = [
    /(?:decided|agreed|concluded|determined|resolved)\s+([^.!?]+)/gi,
    /(?:decision|agreement|conclusion)\s*:?\s*([^.!?]+)/gi
  ];
  let keyDecisions = [];
  decisionPatterns.forEach((pattern) => {
    const matches = transcript.match(pattern);
    if (matches) {
      keyDecisions.push(...matches.map((match) => match.trim()));
    }
  });
  keyDecisions = [...new Set(keyDecisions)].slice(0, 5);
  const commonWords = ["the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "this", "that", "these", "those", "a", "an"];
  const words = transcript.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const wordFreq = words.reduce((acc, word) => {
    if (!commonWords.includes(word)) {
      acc[word] = (acc[word] || 0) + 1;
    }
    return acc;
  }, {});
  const topics = Object.entries(wordFreq).sort(([, a], [, b]) => b - a).slice(0, 8).map(([word]) => word);
  const estimatedMinutes = Math.round(wordCount / 150);
  const duration = estimatedMinutes > 0 ? `~${estimatedMinutes} minutes` : "< 1 minute";
  const sentences = transcript.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const summary = sentences.slice(0, 3).join(". ").trim() + (sentences.length > 3 ? "..." : "");
  return {
    summary: summary || "Meeting transcript provided for analysis.",
    actionItems: actionItems.length > 0 ? actionItems : ["No clear action items identified"],
    keyDecisions: keyDecisions.length > 0 ? keyDecisions : ["No explicit decisions recorded"],
    participants: participants.length > 0 ? participants : ["Participants not clearly identified"],
    wordCount,
    duration,
    topics: topics.length > 0 ? topics : ["General discussion"]
  };
};

const DEFAULT_TRANSCRIPT_AGENT_NAME = "Meeting Transcript Analyzer";
const transcriptAgent = new Agent({
  name: DEFAULT_TRANSCRIPT_AGENT_NAME,
  instructions: `You are a professional meeting analyst that provides insights and analysis on meeting transcripts.

Your primary function is to help users understand meeting content by extracting key information. When responding:

- Always ask for a meeting transcript if none is provided
- If the transcript is too short or unclear, please inform the user
- Keep responses concise but informative
- Use the transcriptTool to analyze transcript data
- If the user asks for specific insights, provide them based on the transcript content
- If the user asks for action items, extract them clearly with responsible parties when mentioned
- Be friendly and professional in your responses
- Make sure to give reasonable insights based on the data you have
- Don't make up data or insights that you cannot support with the transcript content
- Provide a summary of key insights at the end

Format your response as:

## Meeting Summary
[2-3 paragraphs summarizing the key discussion points, decisions made, and main topics covered]

## Action Items
- [ ] Action item 1 (if responsible person mentioned, include their name)
- [ ] Action item 2
- [ ] Action item 3

## Key Decisions
[List any important decisions made during the meeting]

Use the transcriptTool to analyze transcript data.`,
  model: "google/gemini-2.5-flash",
  tools: { transcriptTool },
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:../mastra.db"
    })
  })
});

const a2aAgentRoute = registerApiRoute("/a2a/agent/:agentId", {
  method: "POST",
  handler: async (c) => {
    try {
      const mastra = c.get("mastra");
      const agentId = c.req.param("agentId");
      const body = await c.req.json();
      const { jsonrpc, id: requestId, params } = body;
      if (jsonrpc !== "2.0" || !requestId) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId || null,
            error: {
              code: -32600,
              message: 'Invalid Request: jsonrpc must be "2.0" and id is required'
            }
          },
          400
        );
      }
      const agent = mastra.getAgent(agentId);
      if (!agent) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32602,
              message: `Agent '${agentId}' not found`
            }
          },
          404
        );
      }
      const { message, messages, contextId, taskId} = params || {};
      let messagesList = [];
      if (message) {
        messagesList = [message];
      } else if (messages && Array.isArray(messages)) {
        messagesList = messages;
      }
      const mastraMessages = messagesList.map((msg) => ({
        role: msg.role,
        content: msg.parts?.map((part) => {
          if (part.kind === "text") return part.text;
          if (part.kind === "data") return JSON.stringify(part.data);
          return "";
        }).join("\n") || ""
      }));
      const response = await agent.generate(mastraMessages);
      const agentText = response.text || "";
      const artifacts = [
        {
          artifactId: randomUUID(),
          name: `${agentId}Response`,
          parts: [{ kind: "text", text: agentText }]
        }
      ];
      if (response.toolResults && response.toolResults.length > 0) {
        artifacts.push({
          artifactId: randomUUID(),
          name: "ToolResults",
          // @ts-ignore
          parts: response.toolResults.map((result) => ({
            kind: "data",
            data: result
          }))
        });
      }
      const history = [
        ...messagesList.map((msg) => ({
          kind: "message",
          role: msg.role,
          parts: msg.parts,
          messageId: msg.messageId || randomUUID(),
          taskId: msg.taskId || taskId || randomUUID()
        })),
        {
          kind: "message",
          role: "agent",
          parts: [{ kind: "text", text: agentText }],
          messageId: randomUUID(),
          taskId: taskId || randomUUID()
        }
      ];
      return c.json({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          id: taskId || randomUUID(),
          contextId: contextId || randomUUID(),
          status: {
            state: "completed",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            message: {
              messageId: randomUUID(),
              role: "agent",
              parts: [{ kind: "text", text: agentText }],
              kind: "message"
            }
          },
          artifacts,
          history,
          kind: "task"
        }
      });
    } catch (error) {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: "Internal error",
            data: { details: error.message }
          }
        },
        500
      );
    }
  }
});

const mastra = new Mastra({
  agents: {
    transcriptAgent
  },
  storage: new LibSQLStore({
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:"
  }),
  server: {
    apiRoutes: [a2aAgentRoute]
  },
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    enabled: false
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: {
      enabled: true
    }
  }
});

export { mastra };
