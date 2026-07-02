/**
 * Aggregator — 并行结果聚合与对比摘要生成
 */
class Aggregator {
  /**
   * 聚合多模型结果
   */
  aggregate(results, summary) {
    return {
      results: this._formatResults(results),
      summary,
      differences: this._detectDifferences(results),
    };
  }

  /**
   * 格式化结果
   */
  _formatResults(results) {
    const formatted = {};
    for (const [modelId, result] of Object.entries(results)) {
      formatted[modelId] = {
        status: result.status,
        text: result.text,
        textLength: result.text?.length || 0,
        latency: result.latency,
        tokens: result.tokens,
        error: result.error,
      };
    }
    return formatted;
  }

  /**
   * 检测模型输出之间的差异
   * 使用简单文本比较，不引入额外 LLM 调用
   */
  _detectDifferences(results) {
    const successful = Object.entries(results).filter(([_, r]) => r.status === 'done' && r.text);
    if (successful.length < 2) return null;

    // 找出所有模型的共同内容
    const texts = successful.map(([id, r]) => ({
      modelId: id,
      text: r.text,
      lines: r.text.split('\n'),
    }));

    // 行级差异分析
    const lineDiff = this._lineDiff(texts);

    return {
      modelCount: successful.length,
      commonLineCount: lineDiff.common,
      uniqueLinesPerModel: lineDiff.unique,
      hasSignificantDifferences: lineDiff.unique.some(u => u.count > 3),
    };
  }

  /**
   * 行级差异分析
   */
  _lineDiff(texts) {
    if (texts.length < 2) return { common: 0, unique: [] };

    // 取最短文本作为基准
    const baseIdx = texts.reduce((min, t, i) => t.lines.length < texts[min].lines.length ? i : min, 0);
    const base = texts[baseIdx];
    const others = texts.filter((_, i) => i !== baseIdx);

    // 统计基准文本中的行是否出现在其他模型中
    let commonCount = 0;
    const uniquePerModel = [];

    for (const line of base.lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const appearsInAll = others.every(other =>
        other.lines.some(l => l.trim() === trimmed)
      );

      if (appearsInAll) {
        commonCount++;
      }
    }

    // 统计每个模型的独有行
    for (const text of texts) {
      let uniqueCount = 0;
      const otherTexts = texts.filter(t => t.modelId !== text.modelId);

      for (const line of text.lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const appearsInOthers = otherTexts.some(other =>
          other.lines.some(l => l.trim() === trimmed)
        );

        if (!appearsInOthers) {
          uniqueCount++;
        }
      }

      uniquePerModel.push({
        modelId: text.modelId,
        count: uniqueCount,
      });
    }

    return { common: commonCount, unique: uniquePerModel };
  }
}

export { Aggregator };
