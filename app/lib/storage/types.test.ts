import { parseRangeHeader, resolveFileRange } from './types';

describe('parseRangeHeader', () => {
  it('parses a closed range "bytes=0-1023"', () => {
    expect(parseRangeHeader('bytes=0-1023')).toEqual({ start: 0, end: 1023 });
  });

  it('parses an open-ended range "bytes=512-"', () => {
    expect(parseRangeHeader('bytes=512-')).toEqual({ start: 512, end: undefined });
  });

  it('parses a suffix range "bytes=-256"', () => {
    expect(parseRangeHeader('bytes=-256')).toEqual({ suffixLength: 256 });
  });

  it('returns null for an empty range "bytes=-"', () => {
    expect(parseRangeHeader('bytes=-')).toBeNull();
  });

  it('returns null for "bytes="', () => {
    expect(parseRangeHeader('bytes=')).toBeNull();
  });

  it('returns null for a non-bytes unit', () => {
    expect(parseRangeHeader('items=0-1')).toBeNull();
  });

  it('returns null for non-numeric bounds', () => {
    expect(parseRangeHeader('bytes=abc-def')).toBeNull();
  });
});

describe('resolveFileRange', () => {
  const totalSize = 5000;

  it('serves the whole file when no range is given', () => {
    expect(resolveFileRange(totalSize)).toEqual({ start: 0, end: 4999, contentLength: 5000 });
  });

  it('resolves a closed range', () => {
    expect(resolveFileRange(totalSize, { start: 0, end: 1023 })).toEqual({
      start: 0,
      end: 1023,
      contentLength: 1024,
    });
  });

  it('resolves an open-ended range to the last byte', () => {
    expect(resolveFileRange(totalSize, { start: 500 })).toEqual({
      start: 500,
      end: 4999,
      contentLength: 4500,
    });
  });

  it('clamps an end past EOF to the last byte', () => {
    expect(resolveFileRange(totalSize, { start: 0, end: 999999 })).toEqual({
      start: 0,
      end: 4999,
      contentLength: 5000,
    });
  });

  it('resolves a suffix range against the file size', () => {
    expect(resolveFileRange(totalSize, { suffixLength: 256 })).toEqual({
      start: 4744,
      end: 4999,
      contentLength: 256,
    });
  });

  it('clamps a suffix larger than the file to the whole file', () => {
    expect(resolveFileRange(totalSize, { suffixLength: 999999 })).toEqual({
      start: 0,
      end: 4999,
      contentLength: 5000,
    });
  });

  it('yields a non-positive contentLength when start is past EOF (416 boundary)', () => {
    expect(resolveFileRange(totalSize, { start: 5000 })).toEqual({
      start: 5000,
      end: 4999,
      contentLength: 0,
    });
  });
});
