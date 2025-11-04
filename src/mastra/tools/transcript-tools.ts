import { createTool } from "@mastra/core";
import { z } from "zod";

export const transcriptTool = createTool({
  id: "transcript-info",
  description: "Analyze a meeting transcript to extract key information",
  inputSchema: z.object({
    transcript: z.string().describe("The raw meeting transcript text"),
  }),
  outputSchema: z.object({
    summary: z.string(),
    actionItems: z.array(z.string()),
    keyDecisions: z.array(z.string()),
    participants: z.array(z.string()),
    wordCount: z.number(),
    duration: z.string().optional(),
    topics: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    return await analyzeTranscriptContent(context.transcript);
  },
});

const analyzeTranscriptContent = async (transcript: string) => {
  // Validate input
  if (!transcript || transcript.trim().length < 50) {
    throw new Error("Transcript too short. Please provide a meaningful meeting transcript (at least 50 characters).");
  }

  const wordCount = transcript.split(/\s+/).length;
  
  // Extract participants (simple heuristic - look for names followed by colons)
  const participantMatches = transcript.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*:/g);
  const participants = participantMatches 
    ? [...new Set(participantMatches.map(match => match.replace(':', '').trim()))]
    : [];

  // Extract action items (look for phrases like "will do", "needs to", "action:", etc.)
  const actionItemPatterns = [
    /(?:action|todo|task|will|need(?:s)? to|should|must)\s+([^.!?]+)/gi,
    /([^.!?]*(?:by|before|due)\s+[^.!?]+)/gi
  ];
  
  let actionItems: string[] = [];
  actionItemPatterns.forEach(pattern => {
    const matches = transcript.match(pattern);
    if (matches) {
      actionItems.push(...matches.map(match => match.trim()));
    }
  });
  
  // Remove duplicates and clean up
  actionItems = [...new Set(actionItems)].slice(0, 10); // Limit to 10 items

  // Extract key decisions (look for decision-related keywords)
  const decisionPatterns = [
    /(?:decided|agreed|concluded|determined|resolved)\s+([^.!?]+)/gi,
    /(?:decision|agreement|conclusion)\s*:?\s*([^.!?]+)/gi
  ];
  
  let keyDecisions: string[] = [];
  decisionPatterns.forEach(pattern => {
    const matches = transcript.match(pattern);
    if (matches) {
      keyDecisions.push(...matches.map(match => match.trim()));
    }
  });
  
  keyDecisions = [...new Set(keyDecisions)].slice(0, 5); // Limit to 5 decisions

  // Extract topics (simple keyword extraction)
  const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'a', 'an'];
  const words = transcript.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const wordFreq = words.reduce((acc: Record<string, number>, word) => {
    if (!commonWords.includes(word)) {
      acc[word] = (acc[word] || 0) + 1;
    }
    return acc;
  }, {});
  
  const topics = Object.entries(wordFreq)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 8)
    .map(([word]) => word);

  // Estimate duration based on word count (average speaking rate: 150 words per minute)
  const estimatedMinutes = Math.round(wordCount / 150);
  const duration = estimatedMinutes > 0 ? `~${estimatedMinutes} minutes` : "< 1 minute";

  // Generate summary (first few sentences or key points)
  const sentences = transcript.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const summary = sentences.slice(0, 3).join('. ').trim() + (sentences.length > 3 ? '...' : '');

  return {
    summary: summary || "Meeting transcript provided for analysis.",
    actionItems: actionItems.length > 0 ? actionItems : ["No clear action items identified"],
    keyDecisions: keyDecisions.length > 0 ? keyDecisions : ["No explicit decisions recorded"],
    participants: participants.length > 0 ? participants : ["Participants not clearly identified"],
    wordCount,
    duration,
    topics: topics.length > 0 ? topics : ["General discussion"],
  };
};