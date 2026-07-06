export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface ApiErrorEnvelope {
  error?: string;
  issues?: Array<{ message?: string }>;
}

export function extractResponseError(bodyText: string, status: number): string {
  if (!bodyText) return `Request failed (${status})`;
  try {
    const envelope = JSON.parse(bodyText) as ApiErrorEnvelope;
    if (envelope.issues && envelope.issues.length > 0) {
      return envelope.issues.map((issue) => issue.message ?? JSON.stringify(issue)).join(' · ');
    }
    return envelope.error ?? bodyText;
  } catch {
    return bodyText;
  }
}
