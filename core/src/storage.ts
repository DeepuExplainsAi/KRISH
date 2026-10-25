/** Minimal async key-value contract. UI/native layers provide persistent implementations. */
export interface KVStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryKV implements KVStore {
  private data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
}

/** Secrets live behind this interface only (Android Keystore / OS keychain). Never log values. */
export interface KeyStore {
  get(providerId: string): Promise<string | undefined>;
  set(providerId: string, key: string): Promise<void>;
  delete(providerId: string): Promise<void>;
}

export class MemoryKeyStore implements KeyStore {
  private data = new Map<string, string>();
  async get(id: string) {
    return this.data.get(id);
  }
  async set(id: string, key: string) {
    this.data.set(id, key);
  }
  async delete(id: string) {
    this.data.delete(id);
  }
}
