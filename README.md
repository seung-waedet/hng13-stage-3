# 📝 Meeting Transcript Analyzer

**An intelligent meeting transcript analysis assistant powered by Mastra AI**

Meeting Transcript Analyzer is an AI-powered agent that provides deep insights into meeting transcripts, extracting summaries, action items, key decisions, and participant information. Built with Mastra.ai framework, it uses Google's Gemini 2.5 Flash model to deliver intelligent transcript analysis through natural conversation.

## ✨ Features

- 🤖 **AI-Powered Analysis**: Leverages Google Gemini 2.5 Flash for intelligent meeting insights
- 📝 **Transcript Processing**: Extracts key information from meeting transcripts
- 📋 **Action Item Extraction**: Identifies and lists action items with responsible parties
- 🎯 **Key Decision Tracking**: Captures important decisions made during meetings
- 👥 **Participant Identification**: Automatically identifies meeting participants
- 💬 **Natural Conversation**: Chat naturally with the agent to analyze meeting transcripts
- 🧠 **Memory System**: Maintains conversation context using LibSQL storage
- 🌐 **Agent-to-Agent Protocol**: Supports A2A (Agent-to-Agent) communication via JSON-RPC 2.0
- 📊 **Observability**: Built-in AI tracing and monitoring

## 🏗️ Architecture

The project is structured around the Mastra framework:

```
src/mastra/
├── index.ts                    # Main Mastra configuration
├── agents/
│   └── transcript-agent.ts     # Meeting transcript analysis agent
├── tools/
│   └── transcript-tools.ts     # Transcript processing tools
├── routes/
│   └── a2aRoute.ts            # Agent-to-Agent API endpoint
├── utils/
│   └── definitions.ts         # TypeScript type definitions
└── workflows/
    └── transcript-workflow.ts  # Analysis workflows (future use)
```

## 🚀 Getting Started

### Prerequisites

- **Node.js**: Version 20.9.0 or higher
- **pnpm**: Package manager (recommended for faster installs)

```bash
git clone https://github.com/seung-waedet/hng13-stage-3
cd meeting-transcript-analyzer
npm install
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Add your Gemini API key
# Get it from: https://aistudio.google.com/app/apikey
```

Edit `.env`:
```env
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key_here
PORT=3000
```

### 3. Run Development Server

```bash
npm run dev
```

Server starts at `http://localhost:3000`

### 4. Test It

```bash
# Health check
curl http://localhost:3000/health

# Swagger UI (Interactive API Documentation)
# Visit http://localhost:3000/api-docs in your browser
```
---

## 📡 API Reference

### Swagger Documentation

Access the interactive API documentation at:
```
http://localhost:3000/api-docs
```

### Endpoints

#### A2A Transcript Analysis
```
POST /api/a2a/transcript-analyzer
Content-Type: application/json
```

### Request Format (A2A Protocol)

```json
{
  "jsonrpc": "2.0",
  "method": "a2a.task.execute",
  "params": {
    "message": {
      "role": "user",
      "parts": [{
        "text": "Your meeting transcript here..."
      }]
    },
    "taskId": "optional-task-id",
    "conversationId": "optional-conversation-id"
  },
  "id": "request-id"
}
```

### Response Format

```json
{
  "jsonrpc": "2.0",
  "result": {
    "message": {
      "role": "agent",
      "parts": [{
        "text": "## Meeting Summary\n...\n## Action Items\n..."
      }]
    },
    "artifacts": [{
      "type": "text/markdown",
      "title": "Meeting Analysis",
      "content": "Full formatted analysis",
      "metadata": {
        "generatedAt": "2025-10-30T12:00:00Z",
        "wordCount": 250
      }
    }],
    "context": {
      "taskId": "task-123",
      "conversationId": "conv-456"
    }
  },
  "id": "request-id"
}
```

---

## Testing Examples

### Example 1: Quick Standup

**Input:**
```json
{
  "text": "Daily standup. Mike finished the login feature. Sarah is stuck on the API integration and needs help. John will review Mike's code this afternoon."
}
```

**Output:**
```markdown
## Meeting Summary
The team held their daily standup meeting...

## Action Items
- [ ] John to review Mike's login feature code this afternoon
- [ ] Sarah needs assistance with API integration

## Key Decisions
- Login feature marked as complete
```
---
