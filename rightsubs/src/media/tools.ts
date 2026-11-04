import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ToolInfo {
  available: boolean;
  version?: string;
}

export interface MediaTools {
  ffmpeg: ToolInfo;
  ffprobe: ToolInfo;
}

async function detect(command: string): Promise<ToolInfo> {
  try {
    const { stdout } = await run(command, ['-version'], { timeout: 5000 });
    const version = /version (\S+)/.exec(stdout)?.[1];
    return version ? { available: true, version } : { available: true };
  } catch {
    return { available: false };
  }
}

export async function detectMediaTools(): Promise<MediaTools> {
  const [ffmpeg, ffprobe] = await Promise.all([detect('ffmpeg'), detect('ffprobe')]);
  return { ffmpeg, ffprobe };
}
