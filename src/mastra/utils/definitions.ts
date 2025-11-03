// TypeScript type definitions for the project

// Transcript analysis result type
export interface TranscriptAnalysisResult {
  transcript: string;
  length: number;
  wordCount: number;
}

// Error response type
export interface ErrorResponse {
  error: string;
}

// A2A message format
export interface A2AMessage {
  role: string;
  parts: Array<{
    kind: string;
    text: string;
  }>;
}

// A2A request format (JSON-RPC 2.0)
export interface A2ARequest {
  jsonrpc: string;
  id: string;
  method: string;
  params: {
    message: A2AMessage;
  };
}