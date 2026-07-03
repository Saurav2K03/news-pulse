// SQLite access via Node's built-in node:sqlite (Node >= 22). Read-mostly layer.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DB_PATH =
  process.env.NEWSPULSE_DB_PATH ||
  path.resolve(__dirname, '../../data/newspulse.db');

let db = null;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
  }
  return db;
}
