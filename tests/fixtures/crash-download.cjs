const { DownloadManager } = require('../../src/downloads.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const directory = process.argv[2];
const manager = new DownloadManager({ persist: rows => fs.writeFile(path.join(directory, 'history.json'), JSON.stringify(rows)), fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(32)); } }), { headers: { 'content-type': 'video/mp4' } }), onChange: (_rows, active) => { if (active?.status === 'saving') setTimeout(() => process.send('partial'), 20); } });
void manager.start({ url: 'https://v.tiktokcdn.com/test.mp4', filePath: path.join(directory, 'film.mp4'), pageUrl: 'https://www.tiktok.com/@test/video/123456789' });
