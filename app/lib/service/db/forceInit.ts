import { withError } from '@/app/lib/withError';
import { reportDb, resultDb } from '@/app/lib/service/db';

export const forceInitDatabase = async () => {
  const { error: cleanupError } = await withError(Promise.all([reportDb.clear(), resultDb.clear()]));

  if (cleanupError) {
    throw new Error(`failed to clear db: ${cleanupError.message}`);
  }

  reportDb.initialized = false;
  resultDb.initialized = false;

  const { error } = await withError(Promise.all([reportDb.init(), resultDb.init()]));

  if (error) {
    throw new Error(`failed to initialize db: ${error.message}`);
  }
};
