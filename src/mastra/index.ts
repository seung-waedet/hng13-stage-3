import { Agent, Mastra } from "@mastra/core";
import { google } from "@ai-sdk/google";
import { z } from "zod";

// ============================================
// 1. CREATE THE TRANSCRIPT ANALYZER TOOL
// ============================================
const analyzeTranscript = {
  id: "analyze-transcript",
  description:
    "Analyzes a meeting transcript to extract summary and action items",
  inputSchema: z.object({
    transcript: z.string().describe("The raw meeting transcript text"),
  }),
  execute: async ({ context }: { context: { transcript: string } }) => {
    const { transcript } = context;

    // Validate input
    if (!transcript || transcript.trim().length < 50) {
      return {
        error:
          "Transcript too short. Please provide a meaningful meeting transcript (at least 50 characters).",
      };
    }

    // Return the transcript for the agent to analyze
    return {
      transcript,
      length: transcript.length,
      wordCount: transcript.split(/\s+/).length,
    };
  },
};

// ============================================
// 2. CREATE THE MASTRA AGENT
// ============================================
const transcriptAgent = new Agent({
  name: "Meeting Transcript Analyzer",
  instructions: `You are a professional meeting analyst. Your task is to analyze meeting transcripts and provide:

1. **Concise Summary**: A brief 2-3 paragraph summary of the meeting's main points
2. **Action Items**: A clear list of action items extracted from the discussion

Format your response EXACTLY as follows:

## Meeting Summary
[2-3 paragraphs summarizing the key discussion points, decisions made, and main topics covered]

## Action Items
- [ ] Action item 1 (if responsible person mentioned, include their name)
- [ ] Action item 2
- [ ] Action item 3

## Key Decisions
[List any important decisions made during the meeting]

Be concise but comprehensive. Focus on actionable insights.`,

  model: google("gemini-2.5-flash"),

  tools: {
    analyzeTranscript,
  },
});

// ============================================
// 3. CREATE MASTRA INSTANCE
// ============================================
export const mastra = new Mastra({
  agents: { transcriptAgent },
  storage: undefined,
});

// Export the agent for other modules to use
export { transcriptAgent };

export default mastra;
