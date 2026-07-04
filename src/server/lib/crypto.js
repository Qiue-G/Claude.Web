/**
 * AES-256-GCM 加密/解密模块
 * 用于 API Key 等敏感数据的加密存储
 *
 * 环境变量要求:
 *   ENCRYPTION_KEY - 64字符十六进制字符串（32字节密钥）
 *   可通过 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// 加密值前缀，用于区分已加密和明文数据
export const ENC_PREFIX = 'enc:';

/**
 * 获取加密密钥（从环境变量）
 * 返回 null 表示未配置密钥，应跳过加密
 */
function getEncryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) return null;
  try {
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== 32) {
      console.warn('[CRYPTO] ENCRYPTION_KEY 长度不正确（需要32字节/64十六进制字符），已跳过加密');
      return null;
    }
    return key;
  } catch {
    console.warn('[CRYPTO] ENCRYPTION_KEY 格式无效，已跳过加密');
    return null;
  }
}

/**
 * 检查文本是否已被加密
 */
export function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  return text.startsWith(ENC_PREFIX);
}

/**
 * 加密文本
 * @param {string} text - 明文
 * @returns {string|null} 加密后的 base64 字符串（带 enc: 前缀），失败返回原文
 */
export function encrypt(text) {
  if (!text || typeof text !== 'string') return text;

  // 如果已经加密，直接返回
  if (isEncrypted(text)) return text;

  const key = getEncryptionKey();
  if (!key) {
    console.warn('[CRYPTO] ENCRYPTION_KEY 未配置，API Key 将以明文存储');
    return text;
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // 格式: iv(16) + tag(16) + encrypted
    const result = Buffer.concat([iv, tag, encrypted]).toString('base64');
    return ENC_PREFIX + result;
  } catch (e) {
    console.error('[CRYPTO] 加密失败:', e.message);
    return text;
  }
}

/**
 * 解密文本
 * @param {string} encryptedText - 加密后的字符串（带 enc: 前缀）
 * @returns {string|null} 解密后的明文，失败返回原文
 */
export function decrypt(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string') return encryptedText;

  // 如果未加密，直接返回（兼容旧数据）
  if (!isEncrypted(encryptedText)) return encryptedText;

  const key = getEncryptionKey();
  if (!key) {
    console.warn('[CRYPTO] ENCRYPTION_KEY 未配置，无法解密，返回密文');
    return encryptedText;
  }

  try {
    const data = Buffer.from(encryptedText.slice(ENC_PREFIX.length), 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[CRYPTO] 解密失败:', e.message);
    return encryptedText;
  }
}
