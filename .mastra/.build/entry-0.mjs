import { Agent, Mastra } from '@mastra/core';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { LibSQLStore } from '@mastra/libsql';

const analyzeTranscript = {
  id: "analyze-transcript",
  description: "Analyzes a meeting transcript to extract summary and action items",
  inputSchema: z.object({
    transcript: z.string().describe("The raw meeting transcript text")
  }),
  execute: async ({
    context
  }) => {
    const {
      transcript
    } = context;
    if (!transcript || transcript.trim().length < 50) {
      return {
        error: "Transcript too short. Please provide a meaningful meeting transcript (at least 50 characters)."
      };
    }
    return {
      transcript,
      length: transcript.length,
      wordCount: transcript.split(/\s+/).length
    };
  }
};
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
    analyzeTranscript
  }
});
const mastra = new Mastra({
  agents: {
    transcriptAgent
  },
  server: {
    port: 4111
  },
  telemetry: {
    enabled: false
    // Disable telemetry to avoid the bundling issue
  },
  storage: new LibSQLStore({
    url: ":memory:"
    // In-memory storage for local testing (non-persistent)
  })
});

export { mastra, transcriptAgent };
