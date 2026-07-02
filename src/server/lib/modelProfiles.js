/**
 * Model Profiles — 模型能力描述文件
 *
 * 定义每个模型在不同任务类型上的能力评分（0-100）
 * 用于智能路由决策：根据任务类型选择最优模型
 */
const modelProfiles = {
  // ===== 代码能力 =====
  'anthropic/claude-sonnet-4':         { code: 95,  writing: 90, analysis: 92, qa: 88, speed: 70, cost: 30 },
  'anthropic/claude-opus-4':           { code: 96,  writing: 95, analysis: 95, qa: 90, speed: 50, cost: 20 },
  'anthropic/claude-haiku-4.5':        { code: 85,  writing: 80, analysis: 82, qa: 85, speed: 95, cost: 60 },
  'claude-sonnet-4-20250514':          { code: 95,  writing: 90, analysis: 92, qa: 88, speed: 70, cost: 30 },
  'claude-opus-4-20250514':            { code: 96,  writing: 95, analysis: 95, qa: 90, speed: 50, cost: 20 },
  'claude-3-5-haiku-20241022':         { code: 82,  writing: 78, analysis: 80, qa: 83, speed: 95, cost: 60 },
  'claude-3-5-sonnet-20241022':        { code: 93,  writing: 88, analysis: 90, qa: 87, speed: 70, cost: 30 },

  // ===== OpenAI =====
  'gpt-4o':                            { code: 88,  writing: 90, analysis: 90, qa: 92, speed: 75, cost: 25 },
  'gpt-4o-mini':                       { code: 80,  writing: 82, analysis: 80, qa: 85, speed: 90, cost: 80 },
  'gpt-4.1':                           { code: 92,  writing: 91, analysis: 93, qa: 90, speed: 65, cost: 22 },
  'o3-mini':                           { code: 90,  writing: 75, analysis: 88, qa: 86, speed: 60, cost: 35 },

  // ===== DeepSeek =====
  'deepseek-chat':                     { code: 88,  writing: 82, analysis: 85, qa: 84, speed: 80, cost: 50 },
  'deepseek-reasoner':                 { code: 92,  writing: 78, analysis: 90, qa: 82, speed: 55, cost: 35 },
  'deepseek/deepseek-chat-v3-0324:free': { code: 85, writing: 80, analysis: 83, qa: 82, speed: 75, cost: 100 },

  // ===== Free Models =====
  'google/gemini-2.0-flash-lite-001':  { code: 70,  writing: 72, analysis: 68, qa: 75, speed: 98, cost: 100 },
  'meta-llama/llama-4-maverick:free':  { code: 72,  writing: 70, analysis: 70, qa: 73, speed: 85, cost: 100 },
  'nvidia/nemotron-3-ultra-550b-a55b:free': { code: 68, writing: 65, analysis: 65, qa: 70, speed: 80, cost: 100 },
  'google/gemini-2.5-pro':            { code: 88,  writing: 85, analysis: 90, qa: 88, speed: 60, cost: 20 },
  'openai/gpt-4.1':                    { code: 92,  writing: 91, analysis: 93, qa: 90, speed: 65, cost: 22 },
};

/**
 * 获取模型能力评分
 */
export function getModelProfile(modelId) {
  return modelProfiles[modelId] || { code: 75, writing: 75, analysis: 75, qa: 75, speed: 70, cost: 50 };
}

/**
 * 按任务类型对模型排序
 */
export function rankModelsByTask(modelIds, taskType) {
  const dimension = taskType; // 'code' | 'writing' | 'analysis' | 'qa'
  return [...modelIds]
    .map(id => ({ id, profile: getModelProfile(id) }))
    .sort((a, b) => (b.profile[dimension] || 50) - (a.profile[dimension] || 50))
    .map(m => m.id);
}

export { modelProfiles };
