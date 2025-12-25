/**
 * Logging system for monitoring and debugging trading operations
 *
 * Provides a flexible logging interface that can be implemented with
 * different backends (console, file, remote logging service, etc.)
 *
 * USAGE IN TRADING BOTS:
 * ```typescript
 * // For development - see all logs
 * const logger = new ConsoleLogger(LogLevel.DEBUG);
 *
 * // For production - only errors and warnings
 * const logger = new ConsoleLogger(LogLevel.WARN, { useEmojis: false });
 *
 * // For testing - no output
 * const logger = new NoOpLogger();
 *
 * // Custom implementation for remote logging
 * class RemoteLogger implements ILogger {
 *   // Send logs to monitoring service...
 * }
 * ```
 */

/**
 * Log levels in order of severity (lower = more verbose)
 *
 * - DEBUG: Detailed diagnostic information (e.g., API responses, state changes)
 * - INFO: General informational messages (e.g., order placed, balance checked)
 * - WARN: Warning messages for non-critical issues (e.g., low balance, retry attempt)
 * - ERROR: Error messages for failures (e.g., order rejected, network timeout)
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Logger interface that all logger implementations must follow
 *
 * This interface enables dependency injection and allows you to
 * swap logging implementations without changing trader code.
 */
export interface ILogger {
  /**
   * Logs detailed debugging information
   * Only use for detailed diagnostics - will be noisy in production
   * @param message - Human-readable message
   * @param meta - Optional structured data (object, array, etc.)
   */
  debug(message: string, meta?: any): void;

  /**
   * Logs general informational messages
   * Use for normal operations like successful trades, balance checks, etc.
   * @param message - Human-readable message
   * @param meta - Optional structured data (object, array, etc.)
   */
  info(message: string, meta?: any): void;

  /**
   * Logs warning messages for recoverable issues
   * Use for situations that need attention but don't stop execution
   * @param message - Human-readable message
   * @param meta - Optional structured data (object, array, etc.)
   */
  warn(message: string, meta?: any): void;

  /**
   * Logs error messages for failures
   * Use for operations that failed and may need intervention
   * @param message - Human-readable message
   * @param error - Optional Error object with stack trace
   * @param meta - Optional structured data (object, array, etc.)
   */
  error(message: string, error?: Error, meta?: any): void;
}

/**
 * Logger options for customizing console output
 */
export interface LoggerOptions {
  /** Whether to include emoji prefixes in output (default: true) */
  useEmojis?: boolean;
}

/**
 * Console-based logger implementation
 *
 * Outputs logs to the console (stdout/stderr) with optional emoji prefixes
 * for easy visual scanning. Respects log levels to reduce noise.
 *
 * INTEGRATION TIP: In production, consider using a logger that:
 * - Writes to files with rotation
 * - Sends critical errors to monitoring services
 * - Structures logs as JSON for parsing
 * - Includes timestamps and correlation IDs
 */
export class ConsoleLogger implements ILogger {
  private level: LogLevel;
  private useEmojis: boolean;

  /**
   * Creates a new console logger
   * @param level - Minimum log level to output (default: INFO)
   * @param options - Logger configuration options
   */
  constructor(level: LogLevel = LogLevel.INFO, options?: LoggerOptions) {
    this.level = level;
    this.useEmojis = options?.useEmojis ?? true;
  }

  /**
   * Logs debug-level messages
   * Only outputs if log level is DEBUG
   */
  debug(message: string, meta?: any): void {
    if (this.level <= LogLevel.DEBUG) {
      const prefix = this.useEmojis ? '🐛 ' : '[DEBUG] ';
      if (meta !== undefined) {
        console.debug(prefix + message, meta);
      } else {
        console.debug(prefix + message);
      }
    }
  }

  /**
   * Logs info-level messages
   * Outputs if log level is INFO or DEBUG
   */
  info(message: string, meta?: any): void {
    if (this.level <= LogLevel.INFO) {
      const prefix = this.useEmojis ? 'ℹ️  ' : '[INFO] ';
      if (meta !== undefined) {
        console.info(prefix + message, meta);
      } else {
        console.info(prefix + message);
      }
    }
  }

  /**
   * Logs warning-level messages
   * Outputs if log level is WARN, INFO, or DEBUG
   */
  warn(message: string, meta?: any): void {
    if (this.level <= LogLevel.WARN) {
      const prefix = this.useEmojis ? '⚠️  ' : '[WARN] ';
      if (meta !== undefined) {
        console.warn(prefix + message, meta);
      } else {
        console.warn(prefix + message);
      }
    }
  }

  /**
   * Logs error-level messages
   * Always outputs (ERROR is highest level)
   */
  error(message: string, error?: Error, meta?: any): void {
    if (this.level <= LogLevel.ERROR) {
      const prefix = this.useEmojis ? '❌ ' : '[ERROR] ';
      const parts: any[] = [prefix + message];

      if (error) {
        parts.push(error.message);
        // Include stack trace in debug mode
        if (this.level <= LogLevel.DEBUG && error.stack) {
          parts.push('\n' + error.stack);
        }
      }

      if (meta !== undefined) {
        parts.push(meta);
      }

      console.error(...parts);
    }
  }
}

/**
 * No-operation logger for testing or silent operation
 *
 * Implements ILogger but does nothing. Useful for:
 * - Unit tests where log output is noise
 * - Performance-critical sections where logging overhead matters
 * - Silent operation modes
 *
 * USAGE:
 * ```typescript
 * const logger = new NoOpLogger();
 * // All log calls are ignored
 * logger.info("This won't appear anywhere");
 * ```
 */
export class NoOpLogger implements ILogger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}