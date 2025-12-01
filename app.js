// frontend/app.js

const API_BASE = "http://127.0.0.1:8000";

// Grab DOM elements
const messageInput = document.getElementById("userMessage");
const analyzeButton = document.getElementById("analyzeBtn");
const loadingState = document.getElementById("loading");
const resultsContainer = document.getElementById("results");

const classificationBadge = document.getElementById("classificationBadge");
const summaryText = document.getElementById("summaryText");
const tasksList = document.getElementById("tasksList");
const replyText = document.getElementById("replyText");
const rewriteStatus = document.getElementById("rewriteStatus");

const rewriteFriendly = document.getElementById("rewriteFriendly");
const rewriteFormal = document.getElementById("rewriteFormal");
const rewriteShort = document.getElementById("rewriteShort");
const copyReplyBtn = document.getElementById("copyReply");

const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistory");

let currentAnalysis = null;
let history = [];

/* ---------- Helpers ---------- */

function setLoading(isLoading) {
  if (isLoading) {
    loadingState.classList.remove("hidden");
    resultsContainer.classList.add("hidden");
    analyzeButton.disabled = true;
    analyzeButton.style.opacity = "0.7";
  } else {
    loadingState.classList.add("hidden");
    analyzeButton.disabled = false;
    analyzeButton.style.opacity = "1";
  }
}

function showResults() {
  loadingState.classList.add("hidden");
  resultsContainer.classList.remove("hidden");
}

function normalizeClassification(label) {
  if (!label) return "Informational";
  const lower = label.toLowerCase().trim();
  if (lower.includes("urgent")) return "Urgent";
  if (lower.includes("request")) return "Request";
  if (lower.includes("follow")) return "Follow-Up";
  if (lower.includes("reminder")) return "Reminder";
  return "Informational";
}

function classificationToBadgeClass(label) {
  const normalized = normalizeClassification(label);
  switch (normalized) {
    case "Urgent":
      return "badge badge-urgent";
    case "Request":
      return "badge badge-request";
    case "Follow-Up":
      return "badge badge-followup";
    case "Reminder":
      return "badge badge-reminder";
    case "Informational":
    default:
      return "badge badge-info";
  }
}

function updateHistory(message, classification) {
  const preview = message.length > 90 ? message.slice(0, 87) + "…" : message;
  history.unshift({
    id: Date.now(),
    preview,
    classification: normalizeClassification(classification),
  });
  if (history.length > 10) history = history.slice(0, 10);
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = "";
  if (history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No recent analyses yet.";
    historyList.appendChild(empty);
    return;
  }

  history.forEach((item) => {
    const div = document.createElement("div");
    div.className = "history-item";

    const title = document.createElement("div");
    title.className = "history-item-title";
    title.textContent = item.classification;

    const meta = document.createElement("div");
    meta.className = "history-item-meta";
    meta.textContent = item.preview;

    div.appendChild(title);
    div.appendChild(meta);

    historyList.appendChild(div);
  });
}

function setRewriteButtonsDisabled(disabled) {
  [rewriteFriendly, rewriteFormal, rewriteShort].forEach((btn) => {
    btn.disabled = disabled;
  });
}

/* ---------- Analyze message ---------- */

async function handleAnalyze() {
  const message = messageInput.value.trim();
  if (!message) {
    alert("Please paste a message first.");
    return;
  }

  // reset previous state
  rewriteStatus.classList.add("hidden");
  rewriteStatus.textContent = "";
  replyText.textContent = "";

  setLoading(true);

  try {
    const res = await fetch(`${API_BASE}/analyze_message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      throw new Error(`Backend error: ${res.status}`);
    }

    const data = await res.json();
    const classification = normalizeClassification(data.classification);

    // Category badge
    classificationBadge.className = classificationToBadgeClass(classification);
    classificationBadge.textContent = classification.toUpperCase();

    // Summary
    summaryText.textContent = data.summary || "No summary returned.";

    // Tasks
    tasksList.innerHTML = "";
    if (data.tasks && data.tasks.length > 0) {
      data.tasks.forEach((task) => {
        const li = document.createElement("li");
        li.textContent = task;
        tasksList.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      li.textContent = "No explicit tasks detected.";
      tasksList.appendChild(li);
    }

    // Reply
    replyText.textContent =
      data.suggested_reply || "No suggested reply generated.";
    rewriteStatus.textContent = "Default reply from the agent.";
    rewriteStatus.classList.remove("hidden");

    currentAnalysis = {
      message,
      classification,
      summary: data.summary,
      tasks: data.tasks || [],
      suggested_reply: data.suggested_reply,
    };

    updateHistory(message, classification);
    showResults();
  } catch (err) {
    console.error(err);
    alert("Something went wrong talking to the backend.");
  } finally {
    setLoading(false);
  }
}

/* ---------- Rewrite reply ---------- */

async function requestRewrite(style) {
  if (!currentAnalysis || !currentAnalysis.suggested_reply) {
    alert("Analyze a message first, then you can rewrite the reply.");
    return;
  }

  setRewriteButtonsDisabled(true);

  const styleLabel =
    style === "polished"
      ? "polished"
      : style === "short"
      ? "short"
      : "friendly";

  rewriteStatus.textContent = `Generating a ${styleLabel} reply… please wait.`;
  rewriteStatus.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/rewrite_reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        original_message: currentAnalysis.message,
        base_reply: currentAnalysis.suggested_reply,
        style,
      }),
    });

    if (!res.ok) {
      throw new Error(`Backend error: ${res.status}`);
    }

    const data = await res.json();
    replyText.textContent = data.rewritten_reply;
    currentAnalysis.suggested_reply = data.rewritten_reply;

    rewriteStatus.textContent = `Showing ${styleLabel} reply.`;
  } catch (err) {
    console.error(err);
    rewriteStatus.textContent = "Failed to rewrite reply. Showing last version.";
  } finally {
    setRewriteButtonsDisabled(false);
  }
}

/* ---------- Copy reply ---------- */

async function handleCopyReply() {
  const text = replyText.textContent.trim();
  if (!text) {
    alert("No reply to copy yet.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    const original = copyReplyBtn.textContent;
    copyReplyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyReplyBtn.textContent = original;
    }, 1200);
  } catch (err) {
    console.error(err);
    alert("Could not copy to clipboard.");
  }
}

/* ---------- Clear history ---------- */

function handleClearHistory() {
  history = [];
  renderHistory();
}

/* ---------- Event bindings ---------- */

analyzeButton.addEventListener("click", handleAnalyze);
rewriteFriendly.addEventListener("click", () => requestRewrite("friendly"));
rewriteFormal.addEventListener("click", () => requestRewrite("polished"));
rewriteShort.addEventListener("click", () => requestRewrite("short"));
copyReplyBtn.addEventListener("click", handleCopyReply);
clearHistoryBtn.addEventListener("click", handleClearHistory);

// Ctrl+Enter / Cmd+Enter shortcut
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    handleAnalyze();
  }
});

/* ---------- Initial render ---------- */

setLoading(false);      // ensure loading text is hidden on first load
resultsContainer.classList.add("hidden"); // hide results until first analysis
renderHistory();
