import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** `FFMPEG_PATH`, else the `ffmpeg-static` binary, else `ffmpeg` on PATH. */
export function resolveFfmpeg(env: Record<string, string | undefined> = process.env): string {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  try {
    const path = createRequire(import.meta.url)('ffmpeg-static') as string | null;
    if (path && existsSync(path)) return path;
  } catch {
    // fall through to PATH
  }
  return 'ffmpeg';
}

export type VideoInput = {
  /** 1080×1920 JPEG frames (see `buildVideoFrame`). */
  frames: Buffer[];
  secondsPerPhoto: number;
  /** Optional audio track (any format ffmpeg reads); cut/padded to the video length. */
  music: Buffer | null;
  ffmpegPath: string;
  timeoutMs?: number;
};

function run(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(`ffmpeg failed: ${err.message}\n${String(stderr).slice(-800)}`));
        else resolve();
      },
    );
  });
}

/**
 * H.264/AAC MP4, 1080×1920, 30 fps, each frame held `secondsPerPhoto`. Frames come from the
 * concat demuxer so ffmpeg does not re-scale; `+faststart` lets phones play while downloading.
 */
export async function renderVideo(input: VideoInput): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'pb-video-'));
  try {
    const lines: string[] = [];
    for (let i = 0; i < input.frames.length; i++) {
      await writeFile(join(dir, `f${i}.jpg`), input.frames[i]!);
      lines.push(`file 'f${i}.jpg'`, `duration ${input.secondsPerPhoto}`);
    }
    // The concat demuxer ignores the last duration unless the last file is repeated.
    lines.push(`file 'f${input.frames.length - 1}.jpg'`);
    await writeFile(join(dir, 'list.txt'), lines.join('\n'));
    const total = input.frames.length * input.secondsPerPhoto;
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'list.txt',
    ];
    if (input.music) {
      await writeFile(join(dir, 'music.bin'), input.music);
      args.push('-i', 'music.bin');
    }
    args.push(
      '-vf',
      'fps=30,scale=1080:1920,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
    );
    if (input.music) {
      args.push(
        '-af',
        `apad,afade=t=out:st=${Math.max(0, total - 1)}:d=1`,
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
      );
    } else {
      args.push('-an');
    }
    args.push('-t', String(total), '-movflags', '+faststart', 'out.mp4');
    await run(input.ffmpegPath, args, dir, input.timeoutMs ?? 120_000);
    return await readFile(join(dir, 'out.mp4'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
