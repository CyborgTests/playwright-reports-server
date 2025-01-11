import { Readable, type ReadableOptions } from 'node:stream';

/**
 * convert a formData file multipart stream to a readable node stream
 * generator function that yields the chunks when asked
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*
 * Web stream: https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
 * Node stream: https://nodejs.org/docs/latest-v20.x/api/stream.html#readable-streams
 */
export const transformStreamToReadable = (stream: ReadableStream<Uint8Array>, opts?: ReadableOptions): Readable => {
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
    opts ?? defaultStreamingOptions,
  );
};

export const defaultStreamingOptions: ReadableOptions = {
  encoding: 'binary',
  highWaterMark: 10 * 1024 * 1024, // 10MB
};
