export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix: string = 'YeYingConnect', level: LogLevel = 'info') {
    this.prefix = prefix;
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  debug(...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.debug(`[${this.prefix}:DEBUG]`, ...args);
    }
  }

  info(...args: any[]): void {
    if (this.shouldLog('info')) {
      console.info(`[${this.prefix}:INFO]`, ...args);
    }
  }

  warn(...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[${this.prefix}:WARN]`, ...args);
    }
  }

  error(...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(`[${this.prefix}:ERROR]`, ...args);
    }
  }
}

