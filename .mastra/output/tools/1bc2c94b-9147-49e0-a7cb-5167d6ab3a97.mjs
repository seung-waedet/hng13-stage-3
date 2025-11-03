import { z } from 'zod';

const analyzeTranscript = {
  id: "analyze-transcript",
  description: "Analyzes a meeting transcript to extract summary and action items",
  inputSchema: z.object({
    transcript: z.string().describe("The raw meeting transcript text")
  }),
  execute: async ({ context }) => {
    const { transcript } = context;
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

export { analyzeTranscript };
