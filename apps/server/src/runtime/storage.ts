import { mkdirSync } from "node:fs";
import type { ServerConfig } from "../config/server-config.js";
import { seedDemo } from "../seed.js";
import { SqliteStore } from "../store/sqlite-store.js";

export function openPersistentStore(config: ServerConfig): SqliteStore {
  // mkdirSync：处理当前步骤。
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const store = new SqliteStore(config.databasePath);
  try {
    if (config.seedDemo) {
      // seedDemo：处理当前步骤。
      seedDemo(store);
    }
    return store;
  } catch (error) {
    // close：释放当前资源。
    store.close();
    throw error;
  }
}
