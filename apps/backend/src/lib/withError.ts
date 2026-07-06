export async function withError<T>(
  promise: Promise<T>
): Promise<{ result: T | null; error: Error | null }> {
  try {
    const result = await promise;

    return { result, error: null };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
