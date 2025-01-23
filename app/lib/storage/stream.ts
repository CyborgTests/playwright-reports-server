import { Readable, type ReadableOptions } from 'node:stream';
import { ReadableStream } from 'node:stream/web';

/**
 * convert a formData file multipart stream to a readable node stream
 * generator function that yields the chunks when asked
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*
 * Web stream: https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
 * Node stream: https://nodejs.org/docs/latest-v20.x/api/stream.html#readable-streams
 */
export const transformBlobToReadable = (blob: Blob, opts?: ReadableOptions): Readable => {
  return Readable.fromWeb(blob.stream() as ReadableStream<never>, opts);
};

export const defaultStreamingOptions: ReadableOptions = {
  encoding: 'binary',
  highWaterMark: 10 * 1024 * 1024, // 10MB
};
