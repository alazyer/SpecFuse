import chalk from 'chalk';
import {
  initArtifactSchema,
  loadArtifactSchema,
  DEFAULT_ARTIFACT_SCHEMA_PATH,
} from '../core/artifact-schema.js';
import { logger } from '../utils/logger.js';

/**
 * @param {string} projectRoot
 * @param {{ schemaPath?: string, force?: boolean }} [options]
 */
export async function schemaInitCommand(projectRoot, options = {}) {
  logger.header('SpecFuse Schema Init');
  logger.br();

  const result = await initArtifactSchema(projectRoot, { schemaPath: options.schemaPath, force: options.force });
  if (!result.created) {
    logger.warn(`Schema already exists at ${chalk.cyan(result.displayPath)}`);
    logger.info(`Use ${chalk.cyan('specfuse schema init --force')} to recreate the template.`);
    logger.br();
    return;
  }

  logger.success(`Created ${chalk.cyan(result.displayPath)}`);
  logger.info(`Edit ${chalk.cyan(result.displayPath)} to customize instructions before generating artifacts.`);
  logger.br();
}

/**
 * @param {string} projectRoot
 * @param {{ schemaPath?: string }} [options]
 */
export async function schemaShowCommand(projectRoot, options = {}) {
  logger.header('SpecFuse Schema');
  logger.br();

  const schema = await loadArtifactSchema(projectRoot, { schemaPath: options.schemaPath });
  logger.row('Default path', DEFAULT_ARTIFACT_SCHEMA_PATH, chalk.dim);
  logger.row('Resolved path', schema.displayPath, chalk.cyan);
  logger.row('Status', schema.exists ? 'Found' : 'Not found', schema.exists ? chalk.green : chalk.yellow);

  if (!schema.exists) {
    logger.info(`Run ${chalk.cyan('specfuse schema init')} to create a starter schema.`);
    logger.br();
    return;
  }

  const entries = Object.entries(schema.artifacts);
  if (!entries.length) {
    logger.info('No artifact-specific instructions configured yet.');
    logger.br();
    return;
  }

  logger.br();
  logger.header('Configured Artifact Keys');
  for (const [artifactId, instructions] of entries) {
    logger.row(artifactId, `${instructions.length} instruction(s)`, instructions.length ? chalk.cyan : chalk.dim);
  }
  logger.br();
}
