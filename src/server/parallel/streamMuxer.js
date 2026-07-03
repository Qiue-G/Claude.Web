/**
 * Stream Muxer — 多路输出流复用器
 *
 * 将多个模型的输出流合并为一条有序流，
 * 每个数据块附带 modelId 标签。
 */

class StreamMuxer {
  constructor() {
    this.streams = new Map(); // modelId → { buffer, done }
    this.order = [];
    this._flushTimer = null;
    this._onChunk = null;
  }

  /**
   * 注册一个模型输出流
   */
  addStream(modelId) {
    if (!this.streams.has(modelId)) {
      this.streams.set(modelId, { buffer: [], done: false });
      this.order.push(modelId);
    }
  }

  /**
   * 写入数据块
   */
  write(modelId, text) {
    const stream = this.streams.get(modelId);
    if (!stream) return;

    stream.buffer.push(text);
    this._flush();
  }

  /**
   * 标记流完成
   */
  end(modelId) {
    const stream = this.streams.get(modelId);
    if (stream) {
      stream.done = true;
      // 即使 buffer 为空也发送完成信号
      if (stream.buffer.length === 0 && this._onChunk) {
        this._onChunk({ modelId, text: '', done: true });
      }
      this._flush();
    }
  }

  /**
   * 设置回调
   */
  onChunk(fn) {
    this._onChunk = fn;
    return this;
  }

  /**
   * 刷新缓冲区
   */
  _flush() {
    if (this._flushTimer) return;

    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;

      for (const modelId of this.order) {
        const stream = this.streams.get(modelId);
        if (!stream || stream.buffer.length === 0) continue;

        const text = stream.buffer.join('');
        stream.buffer = [];

        if (this._onChunk) {
          this._onChunk({
            modelId,
            text,
            done: stream.done,
          });
        }
      }
    }, 50); // 50ms 批量窗口
  }

  /**
   * 清理
   */
  dispose() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this.streams.clear();
    this.order = [];
  }
}

export { StreamMuxer };
