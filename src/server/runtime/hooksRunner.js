/**
 * 轻量 Agent 钩子执行器
 *
 * 在 wsHandler 的消息/工具处理流程中插入可配置行为。
 * 插件在 agent-config.json 的 plugins 字段中声明。
 * 支持的阶段: onUserPrompt, preToolUse, postToolUse
 *
 * 每个钩子可带:
 *   - instruction: 追加到 prompt/result 的文本
 *   - matcher: glob 模式（仅 postToolUse/preToolUse 生效）
 */

function globMatch(pattern, name) {
  if (!pattern || pattern === '*') return true;
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return regex.test(name);
}

/**
 * 执行指定阶段的所有钩子
 * @param {string} phase - 阶段名: onUserPrompt | preToolUse | postToolUse
 * @param {object} context - 当前上下文 { prompt?, toolName?, arguments?, result? }
 * @param {object} pluginsConfig - agent-config.json 的 plugins 字段
 * @returns {object} 修改后的上下文
 */
export function runHooks(phase, context, pluginsConfig = {}) {
  const entries = Object.entries(pluginsConfig).filter(
    ([, p]) => p.enabled && p.hooks?.[phase]
  );
  if (entries.length === 0) return context;

  let ctx = { ...context };

  for (const [, plugin] of entries) {
    const hook = plugin.hooks[phase];

    // 工具匹配过滤
    if (hook.matcher && ctx.toolName) {
      if (!globMatch(hook.matcher, ctx.toolName)) continue;
    }

    // 应用钩子指令
    if (hook.instruction) {
      switch (phase) {
        case 'onUserPrompt':
          ctx.prompt = (ctx.prompt || '') + '\n' + hook.instruction;
          break;
        case 'preToolUse':
          ctx.arguments = {
            ...(ctx.arguments || {}),
            _instruction: hook.instruction
          };
          break;
        case 'postToolUse':
          ctx.result = ctx.result
            ? ctx.result + '\n---\n' + hook.instruction
            : hook.instruction;
          break;
      }
    }
  }

  return ctx;
}
