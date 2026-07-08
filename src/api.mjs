/**
 * SpecFuse v4 Programmatic API
 *
 * Embed SpecFuse in other Node.js tools without spawning a subprocess.
 *
 * @example
 * import { sync, drift, diff, status, resolve, plan, specify, change, schema } from 'specfuse/api.mjs';
 *
 * const result = await sync({ root: './my-project' });
 * const report = await drift({ root: './my-project' });
 * const resolved = await resolve({ root: './my-project', ruleId: 'plan:arch→constitution:plan-decisions', choice: 'source' });
 *
 * // CRUD operations
 * const prd = await plan.createPrd('./my-project', { name: 'My App' });
 * const changeResult = await change.new('./my-project', 'add-auth');
 * const constitution = await specify.show('./my-project');
 * const schemaInfo = await schema.show('./my-project');
 */

// Sync/observability functions (extracted from inline for module consistency)
export { sync, drift, diff, status, phase, resolve } from './api/sync-ops.mjs'

// Import for default export
import { sync, drift, diff, status, phase, resolve } from './api/sync-ops.mjs'

// Namespaced CRUD modules
import * as plan from './api/plan.mjs'
import * as specify from './api/specify.mjs'
import * as _change from './api/change.mjs'
import * as schema from './api/schema.mjs'

// Re-export change as 'change' (keyword-safe — _change import re-exported under the name 'change')
export { _change as change }

// Typed error classes
export {
  SpecFuseApiError,
  ArtifactAlreadyExistsError,
  ArtifactNotFoundError,
  ChangeNotVerifiedError,
  SchemaNotFoundError,
} from './api/errors.mjs'

export { plan, specify, schema }

export default {
  sync,
  drift,
  diff,
  status,
  phase,
  resolve,
  plan,
  specify,
  change: _change,
  schema,
}
