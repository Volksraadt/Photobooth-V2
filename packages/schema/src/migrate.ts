import { CURRENT_SCHEMA_VERSION } from './booth-config';
import { validateBoothConfig, type ValidationResult } from './validate';

type Migration = (config: Record<string, unknown>) => Record<string, unknown>;

/**
 * MIGRATIONS[n] upgrades a config from schemaVersion n to n+1.
 * Add an entry here whenever BoothConfig changes shape, then bump CURRENT_SCHEMA_VERSION.
 */
const MIGRATIONS: Record<number, Migration> = {};

/** Upgrade a stored config of any known schemaVersion to the current one, then validate. */
export function migrateBoothConfig(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) {
    return validateBoothConfig(input);
  }
  let config = input as Record<string, unknown>;
  let version = config.schemaVersion;
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version > CURRENT_SCHEMA_VERSION
  ) {
    return {
      success: false,
      issues: [
        {
          code: 'schema.version-unsupported',
          path: 'schemaVersion',
          message: `schemaVersion ${String(version)} tidak didukung (versi terbaru ${CURRENT_SCHEMA_VERSION}).`,
        },
      ],
    };
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      return {
        success: false,
        issues: [
          {
            code: 'schema.migration-missing',
            path: 'schemaVersion',
            message: `Tidak ada migrasi dari schemaVersion ${version}.`,
          },
        ],
      };
    }
    config = step(config);
    version += 1;
  }
  return validateBoothConfig(config);
}
