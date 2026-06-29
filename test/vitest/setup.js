import 'fake-indexeddb/auto';

// Only mock browser APIs when not in jsdom environment
const isJsdom = typeof document !== 'undefined';

if (!isJsdom) {
  // Mock localStorage for Node environment
  class LocalStorageMock {
    constructor() { this.store = {}; }
    clear() { this.store = {}; }
    getItem(key) { return this.store[key] || null; }
    setItem(key, value) { this.store[key] = String(value); }
    removeItem(key) { delete this.store[key]; }
    get length() { return Object.keys(this.store).length; }
    key(index) { return Object.keys(this.store)[index] || null; }
  }

  const mockLocalStorage = new LocalStorageMock();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
    configurable: true
  });

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true
  });
}
