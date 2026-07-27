// get_aegis_state — reads AEGIS operational events. The event ingestion table
// (kuze.operational_events) lands in Phase 2. Until then this tool exists but returns an
// explicit ok:false so Kuze states the capability isn't wired yet (constraint 2) rather than
// pretending there are no alerts.

import { fail, type KuzeTool } from './types.js'

const SOURCE = 'get_aegis_state'
const NOT_CONFIGURED = 'AEGIS event ingestion not yet configured'

export const getAegisState: KuzeTool = {
  name: 'get_aegis_state',
  description:
    'AEGIS operational alert state (open alerts, recent events, event frequency). ' +
    'Not yet wired — returns an explicit not-configured error until Phase 2 ships.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['open_alerts', 'recent_events', 'event_frequency'] },
      params: { type: 'object' },
    },
    required: ['operation'],
  },
  async execute(_input, _ctx) {
    return fail(NOT_CONFIGURED, SOURCE, Date.now())
  },
}
