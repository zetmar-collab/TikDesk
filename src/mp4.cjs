const fs = require('node:fs/promises');

// Validate ISO BMFF boundaries and a video track, not just the response MIME.
async function validateMp4(filename, signal) {
  const file = await fs.open(filename, 'r');
  try {
    const size = (await file.stat()).size;
    if (size < 32) throw new Error('Pobrany plik jest pusty lub zbyt krótki.');
    let boxes = 0;
    const found = { ftyp: false, moov: false, mdat: false, video: false };
    async function scan(start, end, ancestors = [], track = null) {
      let position = start;
      while (position < end) {
        signal?.throwIfAborted();
        if (++boxes > 100000 || ancestors.length > 5 || end - position < 8) throw new Error('Nieprawidłowa struktura MP4.');
        const header = Buffer.alloc(16);
        const { bytesRead } = await file.read(header, 0, Math.min(16, end - position), position);
        let length = header.readUInt32BE(0);
        const type = header.toString('ascii', 4, 8);
        let headerSize = 8;
        if (length === 1) {
          if (bytesRead < 16) throw new Error('Niepełny nagłówek MP4.');
          const extended = header.readBigUInt64BE(8);
          if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Nieprawidłowy rozmiar MP4.');
          length = Number(extended); headerSize = 16;
        } else if (length === 0) length = end - position;
        if (length < headerSize || position + length > end) throw new Error('Plik MP4 jest niepełny lub uszkodzony.');
        if (bytesRead < 8) throw new Error('Niepełny nagłówek MP4.');
        const body = length - headerSize;
        if (!ancestors.length && type === 'ftyp') {
          if (body < 8 || body % 4 !== 0) throw new Error('Nieprawidłowy opis formatu MP4.');
          const brand = Buffer.alloc(4); await file.read(brand, 0, 4, position + headerSize);
          if (!/^[A-Za-z0-9 ]{4}$/.test(brand.toString('ascii'))) throw new Error('Nieprawidłowy format MP4.');
          found.ftyp = true;
        }
        if (!ancestors.length && type === 'moov' && body > 0) found.moov = true;
        if (!ancestors.length && type === 'mdat' && body > 0) found.mdat = true;
        if (track && type === 'tkhd' && ancestors.join('/') === 'moov/trak' && body >= 84) track.header = true;
        if (track && type === 'mdhd' && ancestors.join('/') === 'moov/trak/mdia' && body >= 24) track.media = true;
        if (track && type === 'stsd' && ancestors.join('/') === 'moov/trak/mdia/minf/stbl' && body >= 94) {
          const description = Buffer.alloc(44); await file.read(description, 0, 44, position + headerSize);
          const entries = description.readUInt32BE(4), sampleSize = description.readUInt32BE(8), codec = description.toString('ascii', 12, 16);
          if (entries > 0 && sampleSize >= 86 && sampleSize <= body - 8 && ['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4v'].includes(codec) && description.readUInt16BE(40) > 0 && description.readUInt16BE(42) > 0) track.samples = true;
        }
        if (track && type === 'hdlr' && ancestors.join('/') === 'moov/trak/mdia' && body >= 24) {
          const handler = Buffer.alloc(4);
          await file.read(handler, 0, 4, position + headerSize + 8);
          if (handler.toString('ascii') === 'vide') track.video = true;
        }
        if (type === 'trak' && ancestors.join('/') === 'moov') {
          const current = {}; await scan(position + headerSize, position + length, [...ancestors, type], current);
          if (current.header && current.media && current.samples && current.video) found.video = true;
        } else if (['moov', 'mdia', 'minf', 'stbl'].includes(type)) await scan(position + headerSize, position + length, [...ancestors, type], track);
        position += length;
      }
    }
    await scan(0, size);
    if (!found.ftyp || !found.moov || !found.mdat || !found.video) throw new Error('Serwer nie zwrócił kompletnego filmu MP4.');
    return { bytes: size };
  } finally { await file.close(); }
}
module.exports = { validateMp4 };
