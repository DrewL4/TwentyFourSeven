import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildYtDlpArgs, parseYoutubeUrl, pickDownloadRoot, safeFolderName } from './plan';

describe('youtube plan', () => {
  it('accepts only https YouTube addresses', () => {
    assert.equal(parseYoutubeUrl('https://www.youtube.com/@NASA').ok, true);
    assert.equal(parseYoutubeUrl('https://youtu.be/abc').ok, true);
    assert.equal(parseYoutubeUrl('http://youtube.com/watch?v=1').ok, false);
    assert.equal(parseYoutubeUrl('https://evil.example/youtube.com').ok, false);
    assert.equal(parseYoutubeUrl('https://youtube.com.evil.example/x').ok, false);
    assert.equal(parseYoutubeUrl('https://user:pw@youtube.com/x').ok, false);
    assert.equal(parseYoutubeUrl('file:///etc/passwd').ok, false);
    assert.equal(parseYoutubeUrl('--exec rm').ok, false);
  });
  it('makes safe folder names', () => {
    assert.equal(safeFolderName('../../etc'), 'etc');
    assert.equal(safeFolderName('NASA / Space: HD'), 'NASA Space HD');
    assert.equal(safeFolderName('...'), '');
  });
  it('builds args with the address after -- and the show folder under the root', () => {
    const args = buildYtDlpArgs({ root: '/tv', name: 'NASA', url: 'https://www.youtube.com/@NASA', maxVideos: 5 });
    assert.equal(args[args.length - 2], '--');
    assert.equal(args[args.length - 1], 'https://www.youtube.com/@NASA');
    assert.equal(args[args.indexOf('--playlist-end') + 1], '5');
    const out = args[args.indexOf('-o') + 1];
    assert.ok(out.startsWith('/tv/NASA/Season '));
    assert.ok(args.includes('--download-archive'));
    assert.throws(() => buildYtDlpArgs({ root: '/tv', name: '..', url: 'https://youtu.be/x', maxVideos: 1 }));
  });
  it('clamps max videos', () => {
    const a = buildYtDlpArgs({ root: '/tv', name: 'X', url: 'https://youtu.be/x', maxVideos: 9999 });
    assert.equal(a[a.indexOf('--playlist-end') + 1], '200');
  });
  it('picks the download folder', () => {
    assert.equal(pickDownloadRoot(['/movies', '/tv'], {}), '/tv');
    assert.equal(pickDownloadRoot(['/movies'], {}), null);
    assert.equal(pickDownloadRoot(['/movies'], { YOUTUBE_DOWNLOAD_DIR: '/data/yt' }), '/data/yt');
  });
});
