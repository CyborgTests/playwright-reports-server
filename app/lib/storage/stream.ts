import { Readable } from 'node:stream';

/**
 * convert a formData file multipart stream to a readable node stream
 * generator function that yields the chunks when asked
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*
 * Web stream: https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
 * Node stream: https://nodejs.org/docs/latest-v20.x/api/stream.html#readable-streams
 */
export const transformStreamToReadable = (stream: ReadableStream<Uint8Array>): Readable => {
  return Readable.from(
    (async function* () {
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    })(),
  );
};
