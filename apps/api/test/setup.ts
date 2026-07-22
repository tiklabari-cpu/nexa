/**
 * Test bootstrap: load `.env` before anything reads configuration, and pin the
 * environment to `test` so a suite can never be pointed at real data.
 */
import { loadEnvFile } from '../src/config/load-env-file.js';

loadEnvFile();

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] ??= 'silent';
