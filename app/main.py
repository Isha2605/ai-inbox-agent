# app/main.py

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from openai import OpenAI
from dotenv import load_dotenv
import os
import json

# Load environment variables from .env in project root
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set in .env")

client = OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI(title="AI Inbox Agent")

# Allow frontend (Live Server typically runs on 5500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Pydantic models ----------

class MessageRequest(BaseModel):
    message: str


class MessageAnalysisResponse(BaseModel):
    classification: str
    summary: str
    tasks: List[str]
    suggested_reply: str


class RewriteRequest(BaseModel):
    original_message: str
    base_reply: str
    style: str  # "polished" | "short" | "friendly"


class RewriteResponse(BaseModel):
    rewritten_reply: str


# ---------- System prompts ----------

ANALYSIS_SYSTEM_PROMPT = """
You are an AI inbox copilot for a busy professional.

Your job is to read ONE incoming message (email, Slack, etc.) and return:
- classification: exactly ONE of these:
    - "Urgent"
    - "Request"
    - "Follow-Up"
    - "Reminder"
    - "Informational"
- summary: 1–2 sentence summary
- tasks: a list of concrete action items (can be empty)
- suggested_reply: a reply the user could send

CLASSIFICATION RULES (VERY IMPORTANT):

1. Urgent
   - Only if the message is truly time-critical (needs action within a few hours),
     OR explicitly says ASAP, "right away", "immediately", "today if possible",
     OR it clearly blocks important work.
   - Deadlines like "by tomorrow", "before tomorrow's stand-up", "later this week"
     are NOT urgent by default.

2. Request
   - The sender is asking the user to do something:
     review, update, fix, send, approve, create, schedule, complete, etc.
   - Includes tasks with deadlines (today, tomorrow, this week) that are not
     explicitly critical or blocking.
   - Example: "Can you review the new API docs before tomorrow’s stand-up?"
     => classification should be "Request", not "Urgent".

3. Follow-Up
   - The sender is checking on a previous message or work.
   - Look for phrases like "just checking in", "any update", "following up",
     "wanted to circle back".

4. Reminder
   - The sender is reminding the user about something upcoming or overdue.
   - Soft nudges, not true fire-drills.

5. Informational
   - Primarily FYI or status updates.
   - No clear action required from the user.

Always choose EXACTLY ONE category. Do not invent others.

Return a JSON object with this exact structure:
{
  "classification": "Urgent | Request | Follow-Up | Reminder | Informational",
  "summary": "short summary here",
  "tasks": ["task 1", "task 2"],
  "suggested_reply": "reply text here"
}
"""

REWRITE_SYSTEM_PROMPT = """
You rewrite email/Slack replies into different styles.

You will receive:
- original_message: the message the user received
- base_reply: a reasonable reply the user could send
- style: one of "polished", "short", "friendly"

Your job:
- Preserve the meaning of the base_reply.
- Adjust tone and length based on style:

  - polished:
      professional, clear, confident, complete sentences.
      Appropriate for executives or clients.

  - short:
      very concise, direct, minimal words.
      No fluff, but still polite.

  - friendly:
      warm, approachable, collaborative tone.
      Still professional, no slang.

Return ONLY a JSON object:
{
  "rewritten_reply": "..."
}
"""


# ---------- Routes ----------

@app.post("/analyze_message", response_model=MessageAnalysisResponse)
async def analyze_message(request: MessageRequest):
    """
    Analyze a message: classification, summary, tasks, suggested reply.
    """
    try:
        completion = client.chat.completions.create(
            model="gpt-4.1-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                {"role": "user", "content": request.message},
            ],
        )

        content = completion.choices[0].message.content
        data = json.loads(content)

        classification = data.get("classification", "Informational")
        summary = data.get("summary", "")
        tasks = data.get("tasks", [])
        suggested_reply = data.get("suggested_reply", "")

        if not isinstance(tasks, list):
            tasks = []

        return MessageAnalysisResponse(
            classification=classification,
            summary=summary,
            tasks=tasks,
            suggested_reply=suggested_reply,
        )

    except Exception as e:
        print("Error in /analyze_message:", repr(e))
        raise HTTPException(status_code=500, detail="Error analyzing message")


@app.post("/rewrite_reply", response_model=RewriteResponse)
async def rewrite_reply(request: RewriteRequest):
    """
    Rewrite an existing reply in a different style.
    """
    try:
        payload = {
            "original_message": request.original_message,
            "base_reply": request.base_reply,
            "style": request.style,
        }

        completion = client.chat.completions.create(
            model="gpt-4.1-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": REWRITE_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload)},
            ],
        )

        content = completion.choices[0].message.content
        data = json.loads(content)
        rewritten = data.get("rewritten_reply", request.base_reply)

        return RewriteResponse(rewritten_reply=rewritten)

    except Exception as e:
        print("Error in /rewrite_reply:", repr(e))
        raise HTTPException(status_code=500, detail="Error rewriting reply")
