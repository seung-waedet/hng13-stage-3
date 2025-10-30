# Meeting Transcript Analyzer

An A2A (Agent-to-Agent) protocol agent that analyzes meeting transcripts to extract summaries, action items, and key decisions. Built with Mastra, Express, and Google Gemini AI.

---

## What It Does

This agent accepts raw meeting transcripts and returns:

- **Concise Summary**: 2-3 paragraph overview of key discussion points
- **Action Items**: Checkbox list of tasks with responsible parties
- **Key Decisions**: Important decisions made during the meeting
- **Topics**: Main discussion themes

---

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
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
