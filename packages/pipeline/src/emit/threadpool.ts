/**
 * Side-effect module imported first by cli.ts: enlarges the libuv thread pool (used by async zlib and fs)
 * before it is first used, so gzip compression of the web artifacts runs on all cores.
 */
import { availableParallelism } from 'node:os';

if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = String(Math.max(4, Math.min(16, availableParallelism())));
