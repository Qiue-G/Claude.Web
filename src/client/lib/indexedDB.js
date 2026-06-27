/**
 * IndexedDB 封装库
 * 提供 Promise-based API 用于存储会话数据
 */

const DB_NAME = 'FreeCodeDB';
const DB_VERSION = 1;
export const STORES = {
  CHAT_SESSIONS: 'chatSessions',
  MESSAGES: 'messages'
};

let db = null;

/**
 * 初始化数据库
 */
export async function initDB() {
  if (db) return db;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      
      // 创建会话存储
      if (!database.objectStoreNames.contains(STORES.CHAT_SESSIONS)) {
        const sessionStore = database.createObjectStore(STORES.CHAT_SESSIONS, { keyPath: 'id' });
        sessionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      
      // 创建消息存储
      if (!database.objectStoreNames.contains(STORES.MESSAGES)) {
        const messageStore = database.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
        messageStore.createIndex('sessionId', 'sessionId', { unique: false });
        messageStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * 获取对象存储
 */
function getStore(storeName, mode = 'readonly') {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  const transaction = db.transaction([storeName], mode);
  return transaction.objectStore(storeName);
}

/**
 * 添加或更新数据
 */
export async function put(storeName, data) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.put(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取单条数据
 */
export async function get(storeName, key) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取所有数据
 */
export async function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 删除数据
 */
export async function remove(storeName, key) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * 清空存储
 */
export async function clear(storeName) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * 使用索引查询
 */
export async function getByIndex(storeName, indexName, value) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 检查是否支持 IndexedDB
 */
export function isIndexedDBSupported() {
  return 'indexedDB' in window;
}
