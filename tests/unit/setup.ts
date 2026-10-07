import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { db } from '../../src/database/db';

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = 'test';

beforeEach(async () => {
  db.close();
  await db.delete();
  await db.open();
});
