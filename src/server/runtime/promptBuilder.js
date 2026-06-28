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

export function buildPrompt({ toolInstructions = '', toolResults = [], userMessage = '' } = {}) {
  const sections = [];

  if (toolInstructions && toolInstructions.trim()) {
    sections.push(`[System Instructions]\nYou have the following tools available:\n${toolInstructions.trim()}`);
  }

  appendToolResultSections(sections, toolResults);

  sections.push(`[User Message]\n${String(userMessage || '').trim()}`);

  return sections.join('\n\n');
}