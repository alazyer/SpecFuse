import chalk from 'chalk'

const ICONS = {
  info: chalk.blue('ℹ'),
  success: chalk.green('✔'),
  warn: chalk.yellow('⚠'),
  error: chalk.red('✖'),
  debug: chalk.gray('◦'),
  sync: chalk.cyan('⇄'),
  drift: chalk.magenta('≠'),
  phase: chalk.yellowBright('◈'),
}

let debugEnabled = process.env.SPECFUSE_DEBUG === '1'

export const logger = {
  enableDebug() {
    debugEnabled = true
  },

  info(msg) {
    console.log(`  ${ICONS.info}  ${chalk.white(msg)}`)
  },
  success(msg) {
    console.log(`  ${ICONS.success}  ${chalk.green(msg)}`)
  },
  warn(msg) {
    console.warn(`  ${ICONS.warn}  ${chalk.yellow(msg)}`)
  },
  error(msg) {
    console.error(`  ${ICONS.error}  ${chalk.red(msg)}`)
  },
  debug(msg) {
    if (debugEnabled) console.log(`  ${ICONS.debug}  ${chalk.gray(msg)}`)
  },
  sync(msg) {
    console.log(`  ${ICONS.sync}  ${chalk.cyan(msg)}`)
  },
  drift(msg) {
    console.log(`  ${ICONS.drift}  ${chalk.magenta(msg)}`)
  },
  phase(msg) {
    console.log(`  ${ICONS.phase}  ${chalk.yellowBright(msg)}`)
  },

  /** Print a section header */
  header(title) {
    const line = '─'.repeat(52)
    console.log(`\n${chalk.bold.blueBright(title)}`)
    console.log(chalk.dim(line))
  },

  /** Print a table row: label + value, aligned */
  row(label, value, valueColor = chalk.white) {
    const pad = 28
    console.log(`  ${chalk.dim(label.padEnd(pad))}${valueColor(value)}`)
  },

  /** Blank line */
  br() {
    console.log('')
  },
}
