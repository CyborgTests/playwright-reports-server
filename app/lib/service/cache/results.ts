import { storage } from '@/app/lib/storage';
import { type Result } from '@/app/lib/storage/types';
import { isBuildStage } from '@/app/config/runtime';
import { env } from '@/app/config/env';

type ResultsMap = Map<string, Result>;

export class ResultCache {
  private static instance: ResultCache;
  public initialized = false;
  private readonly results: ResultsMap;

  private constructor() {
    this.results = new Map();
  }

  public static getInstance() {
    if (!ResultCache.instance) {
      ResultCache.instance = new ResultCache();
    }

    return ResultCache.instance;
  }

  public async init() {
    if (this.initialized || !env.USE_SERVER_CACHE) {
      return;
    }

    console.log('[result cache] initializing cache');
    const { results } = await storage.readResults();

    const cache = ResultCache.getInstance();

    for (const result of results) {
      cache.results.set(result.resultID, result);
    }

    this.initialized = true;
  }

  public async onDeleted(resultIds: string[]) {
    if (!env.USE_SERVER_CACHE) {
      return;
    }

    for (const id of resultIds) {
      this.results.delete(id);
    }
  }

  public async onCreated(result: Result) {
    if (!env.USE_SERVER_CACHE) {
      return;
    }

    this.results.set(result.resultID, result);
  }

  public getAll(): Result[] {
    return Array.from(this.results.values());
  }

  public getByID(resultID: string): Result | undefined {
    return this.results.get(resultID);
  }
}

export const resultCache = ResultCache.getInstance();
