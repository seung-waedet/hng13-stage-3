// Meeting transcript analysis types
export type TranscriptAnalysis = {
  summary: string;
  actionItems: string[];
  keyDecisions: string[];
  participants: string[];
  wordCount: number;
  duration?: string;
  topics: string[];
  analysisTimestamp: string;
};

export type MeetingMetadata = {
  title?: string;
  date?: string;
  duration?: string;
  attendees?: string[];
  meetingType?: string;
  location?: string;
};

export type TranscriptSegment = {
  speaker?: string;
  timestamp?: string;
  content: string;
  duration?: number;
};

export type ActionItem = {
  id: string;
  description: string;
  assignee?: string;
  dueDate?: string;
  priority?: 'high' | 'medium' | 'low';
  status?: 'pending' | 'in-progress' | 'completed';
};

export type KeyDecision = {
  id: string;
  decision: string;
  context?: string;
  participants?: string[];
  timestamp?: string;
  impact?: string;
};

export type MeetingInsights = {
  participationLevel: 'high' | 'medium' | 'low';
  sentimentAnalysis?: 'positive' | 'neutral' | 'negative';
  keyTopics: string[];
  followUpRequired: boolean;
  meetingEffectiveness?: number; // 1-10 scale
};