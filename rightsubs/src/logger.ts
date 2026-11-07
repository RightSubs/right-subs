export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One line per event, readable with `tail -f` on the box: `<time> <LEVEL> <event> {json}`. */
export function createLogger(level: LogLevel, write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  const log = (at: LogLevel) => (event: string, fields?: LogFields) => {
    if (ORDER[at] < ORDER[level]) return;
    const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
    write(`${new Date().toISOString()} ${at.toUpperCase().padEnd(5)} ${event}${suffix}`);
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}
