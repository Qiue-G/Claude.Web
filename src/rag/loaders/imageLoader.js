/**
 * 图片 OCR 加载器
 *
 * 通过外部 OCR API（OpenAI Vision / 其他）提取图片中的文字。
 *
 * 环境变量：
 *   OCR_API_URL — OCR 服务地址（默认使用 OpenAI Vision API）
 *   OCR_API_KEY — OCR 服务 API Key（默认复用 OPENAI_API_KEY）
 *   OCR_MODEL  — OCR 模型名（默认 gpt-4o-mini）
 *
 * 策略：
 *   1. 将图片 base64 编码
 *   2. 调用 OpenAI Vision API 提取文字
 *   3. 返回提取的文本内容
 */
import fs from 'fs';
import path from 'path';

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|bmp|webp|tiff?)$/i;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

function getMimeType(ext) {
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
  };
  return map[ext.toLowerCase()] || 'image/png';
}

export class ImageLoader {
  canHandle(filePath) {
    return IMAGE_EXTENSIONS.test(filePath);
  }

  extensions() {
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
  }

  async load(filePath) {
    const fileName = path.basename(filePath);
    const stat = fs.statSync(filePath);

    if (stat.size > MAX_IMAGE_SIZE) {
      return {
        content: '',
        metadata: {
          source: filePath,
          type: 'image',
          error: `Image too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max 20MB)`,
        },
      };
    }

    const ext = path.extname(filePath);
    const mime = getMimeType(ext);

    try {
      const text = await this.#ocrImage(filePath, mime);
      return {
        content: text || '(no text extracted)',
        metadata: {
          source: filePath,
          type: 'image',
          ocr: true,
          charCount: text?.length || 0,
        },
      };
    } catch (err) {
      return {
        content: '',
        metadata: {
          source: filePath,
          type: 'image',
          error: `OCR failed: ${err.message}`,
        },
      };
    }
  }

  async #ocrImage(filePath, mime) {
    const apiKey = process.env.OCR_API_KEY || process.env.OPENAI_API_KEY;
    const apiUrl = process.env.OCR_API_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.OCR_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
      throw new Error('OCR requires OCR_API_KEY or OPENAI_API_KEY');
    }

    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all text from this image. Return only the extracted text, no commentary.' },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OCR API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
}