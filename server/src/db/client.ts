import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

export const sqlite = new DatabaseSync(config.DATABASE_PATH);
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');
