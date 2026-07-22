/**
 * Loads `.env` before anything reads configuration, and pins the environment to
 * `test` so a suite can never be pointed at real data.
 */
import { loadEnvFile } from './helpers/env.js';

loadEnvFile();

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] ??= 'silent';
