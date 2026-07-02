/**
 * Model Router — 模型智能路由器
 *
 * 功能：
 * 1. 任务类型分类（代码/写作/分析/问答）
 * 2. 根据任务推荐最优模型
 * 3. 成本感知路由（简单任务 → 低成本模型）
 * 4. 故障转移（主模型不可用时自动切换）
 *
 * 使用示例：
 *   const router = new ModelRouter(agentConfig);
 *   const task = router.classifyTask(prompt);
 *   const recommended = router.recommend(task, { preferFree: true });
 */
import { getModelProfile, rankModelsByTask } from './modelProfiles.js';
import { CacheManager } from './cacheManager.js';

class ModelRouter {
  constructor(agentConfig) {
    this.agentConfig = agentConfig;
    this._taskCache = new CacheManager({ ttl: 300000, maxSize: 100 }); // 5min TTL, 100 entries
  }

  /**
   * 分类任务类型
   * @param {string} prompt - 用户输入
   * @returns {{ type: string, confidence: number, detail: string }}
   *
   * 类型: 'code' | 'writing' | 'analysis' | 'qa'
   */
  classifyTask(prompt) {
    if (!prompt || prompt.length < 5) {
      return { type: 'qa', confidence: 0.5, detail: 'too short, default to QA' };
    }

    // 缓存命中（CacheManager 自动处理 TTL 过期和 LRU 淘汰）
    const hash = prompt.slice(0, 100);
    const cached = this._taskCache.get(hash);
    if (cached !== null) return cached;

    const result = this._classify(prompt);
    this._taskCache.set(hash, result);
    return result;
  }

  /**
   * 推荐最优模型
   * @param {Object} task - classifyTask 返回值
   * @param {Object} options
   * @param {boolean} options.preferFree - 是否优先免费模型
   * @param {string} options.provider - 限制特定提供商
   * @param {number} options.minSpeed - 最低速度评分
   * @returns {Array<{modelId: string, score: number, reason: string}>}
   */
  recommend(task, options = {}) {
    const { preferFree = false, provider = null, minSpeed = 0 } = options;
    const allModels = this._getAllModels(provider);
    const scored = [];

    for (const model of allModels) {
      const profile = getModelProfile(model.id);
      const dimension = task.type;

      // 基础能力分
      let score = profile[dimension] || 50;

      // 速度加权
      if (profile.speed >= minSpeed) {
        score += 5;
      }

      // 成本加权
      if (preferFree) {
        if (model.tier === 'free') {
          score += 15;
        } else {
          score -= 10;
        }
      }

      // 上下文窗口奖励
      if (model.context) {
        const ctxScore = Math.min(model.context / 100000, 1) * 5;
        score += ctxScore;
      }

      scored.push({
        modelId: model.id,
        name: model.name,
        tier: model.tier,
        score: Math.round(score * 10) / 10,
        reason: `${task.type}(${profile[dimension]}) + speed(${profile.speed})`,
      });
    }

    // 按分数降序排列
    scored.sort((a, b) => b.score - a.score);

    // 前 3 个带推荐理由
    return scored.slice(0, 5).map((m, i) => ({
      ...m,
      reason: i === 0 ? `Best match for ${task.type}` : m.reason,
    }));
  }

  /**
   * 获取故障转移模型
   * @param {string} failedModelId - 失败的模型 ID
   * @param {Object} task - 任务类型
   * @returns {string|null} 推荐的故障转移模型 ID
   */
  getFallback(failedModelId, task) {
    const allModels = this._getAllModels();
    const ranked = allModels
      .filter(m => m.id !== failedModelId)
      .sort((a, b) => {
        const pa = getModelProfile(a.id);
        const pb = getModelProfile(b.id);
        return (pb[task.type] || 50) - (pa[task.type] || 50);
      });

    return ranked.length > 0 ? ranked[0].id : null;
  }

  /**
   * 获取所有可用模型
   */
  _getAllModels(providerFilter = null) {
    const providers = this.agentConfig?.providers || {};
    const all = [];

    for (const [providerName, config] of Object.entries(providers)) {
      if (providerFilter && providerName !== providerFilter) continue;
      const models = config.models || [];
      for (const m of models) {
        all.push({ ...m, provider: providerName });
      }
    }

    return all;
  }

  /**
   * 基于规则的任务分类（不使用 LLM，保持轻量）
   */
  _classify(prompt) {
    const lower = prompt.toLowerCase();

    // 代码特征
    const codePatterns = [
      /\b(function|class|const|let|var|import|export|def |async|await)\b/,
      /\b(return|if\s*\(|for\s*\(|while\s*\()/,
      /```\w*\n/,
      /\.(js|py|ts|jsx|tsx|rs|go|java|cpp|rb)\b/,
      /\b(fix|bug|error|debug|compile|syntax|refactor)\b/,
      /\b(git|npm|yarn|docker|deploy|build|test)\b/,
      /\b(fetch|axios|query|database|api|endpoint)\b/,
    ];
    let codeScore = 0;
    for (const p of codePatterns) {
      if (p.test(lower)) codeScore += 15;
    }

    // 写作特征
    const writingPatterns = [
      /\b(write|draft|compose|essay|article|blog|story|poem)\b/,
      /\b(translate|summarize|rewrite|paraphrase|explain)\b/,
      /\b(improve|proofread|grammar|style|tone)\b/,
      /\b(outline|intro|conclusion|paragraph|thesis)\b/,
      /^.{200,}$/s, // 长文本
    ];
    let writingScore = 0;
    for (const p of writingPatterns) {
      if (p.test(lower)) writingScore += 15;
    }

    // 分析特征
    const analysisPatterns = [
      /\b(analyze|compare|contrast|evaluate|assess|examine)\b/,
      /\b(pros|cons|advantages|disadvantages|trade.?offs)\b/,
      /\b(cause|effect|impact|correlation|statistics)\b/,
      /\b(review|cases? study|research|data|findings)\b/,
      /\b(diagram|flowchart|architecture|design pattern)\b/,
    ];
    let analysisScore = 0;
    for (const p of analysisPatterns) {
      if (p.test(lower)) analysisScore += 15;
    }

    // 问答特征
    const qaPatterns = [
      /^what|^how|^why|^can|^does|^is |^are |^do |^when|^where/,
      /\?/,
      /\b(meaning|definition|example|difference between)\b/,
      /^.{10,200}$/s, // 中短文本
    ];
    let qaScore = 0;
    for (const p of qaPatterns) {
      if (p.test(lower)) qaScore += 15;
    }

    // 取最高分
    const scores = [
      { type: 'code', score: codeScore },
      { type: 'writing', score: writingScore },
      { type: 'analysis', score: analysisScore },
      { type: 'qa', score: qaScore },
    ];

    scores.sort((a, b) => b.score - a.score);
    const top = scores[0];
    const second = scores[1];

    // 如果最高分和第二名差距很小，标记为混合类型
    const isMixed = top.score - second.score < 15 && second.score > 0;
    const confidence = Math.min(top.score / 60, 1);

    return {
      type: top.type,
      confidence: isMixed ? confidence * 0.8 : confidence,
      detail: isMixed
        ? `${top.type}-${second.type} mixed`
        : `${top.type} (top features: ${top.score})`,
    };
  }
}

export { ModelRouter };
