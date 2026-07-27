import { Router } from 'express'
import { requireAdmin } from '../adminMiddleware.js'
import { getActiveConstitution, getConstitutionHistory } from '../data.js'

export const constitutionRouter = Router()

constitutionRouter.use(requireAdmin)

/** GET / — the active constitution (full body). */
constitutionRouter.get('/', async (_req, res) => {
  const active = await getActiveConstitution()
  if (!active) {
    res.status(404).json({ error: { code: 'not_found', message: 'No active constitution' } })
    return
  }
  res.json({ constitution: active })
})

/** GET /history — all versions, newest first (metadata only, no bodies). */
constitutionRouter.get('/history', async (_req, res) => {
  const versions = await getConstitutionHistory()
  res.json({ versions })
})
