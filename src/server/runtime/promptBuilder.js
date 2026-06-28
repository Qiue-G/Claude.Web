const TOOL_SECTION_TITLES = {
  file_analysis: 'File Analysis',
  code_interpreter: 'Code Interpreter',
  web_search: 'Web Search Results'
};

function sectionTitleForTool(tool) {
  return TOOL_SECTION_TITLES[tool] || String(tool || 'Tool Result').replace(/_/g, ' ');
}

function appendToolResultSections(sections, toolResults = []) {
  for (const result of toolResults) {
    if (!result || !result.ok || !result.content || !String(result.content).trim()) continue;
    const title = sectionTitleForTool(result.tool);
    sections.push(`[${title}]\n${String(result.content).trim()}`);
  }
}

export function buildPrompt({ toolInstructions = '', toolResults = [], userMessage = '', history = [] } = {}) {
  const sections = [];

  if (toolInstructions && toolInstructions.trim()) {
    sections.push(`[System Instructions]\nYou have the following tools available:\n${toolInstructions.trim()}`);
  }

  appendToolResultSections(sections, toolResults);

  if (Array.isArray(history) && history.length > 0) {
    const historyLines = [];
    let totalLen = 0;
    const MAX_HISTORY_CHARS = 8000;
    // 取最近的消息，从最旧到最新排列
    const recent = history.slice(-20);
    for (const msg of recent) {
      const line = (msg.role || 'user') + ': ' + (msg.content || '');
      if (totalLen + line.length > MAX_HISTORY_CHARS) {
        historyLines.push('(conversation history truncated)');
        break;
      }
      historyLines.push(line);
      totalLen += line.length;
    }
    if (historyLines.length > 0) {
      sections.push('[Conversation History]\n' + historyLines.join('\n'));
    }
  }

  sections.push(`[User Message]\n${String(userMessage || '').trim()}`);

  return sections.join('\n\n');
}