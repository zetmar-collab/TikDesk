const fs = require('node:fs/promises');

// Validate ISO BMFF boundaries and a video track, not just the response MIME.
async function validateMp4(filename, signal) {
  const file = await fs.open(filename, 'r');
  try {
    const size = (await file.stat()).size;
    if (size < 32) throw new Error('Pobrany plik jest pusty lub zbyt krótki.');
    let boxes = 0;
    const found = { ftyp: false, moov: false, mdat: false, video: false };
    async function scan(start, end, level = 0) {
      let position = start;
      while (position < end) {
        signal?.throwIfAborted();
        if (++boxes > 100000 || level > 5 || end - position < 8) throw new Error('Nieprawidłowa struktura MP4.');
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
        if (level === 0 && ['ftyp', 'moov', 'mdat'].includes(type)) found[type] = true;
        if (type === 'hdlr' && length >= headerSize + 12) {
          const handler = Buffer.alloc(4);
          await file.read(handler, 0, 4, position + headerSize + 8);
          if (handler.toString('ascii') === 'vide') found.video = true;
        }
        if (['moov', 'trak', 'mdia'].includes(type)) await scan(position + headerSize, position + length, level + 1);
        position += length;
      }
    }
    await scan(0, size);
    if (!found.ftyp || !found.moov || !found.mdat || !found.video) throw new Error('Serwer nie zwrócił kompletnego filmu MP4.');
    return { bytes: size };
  } finally { await file.close(); }
}
module.exports = { validateMp4 };
