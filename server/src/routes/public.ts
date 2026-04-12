import { Router } from 'express'
import { getIdentity } from '../data.js'

export const publicRouter = Router()

publicRouter.get('/identity', async (_req, res) => {
  const id = await getIdentity()
  if (!id) {
    res.status(404).json({ error: { code: 'not_configured', message: 'No identity profile' } })
    return
  }
  res.json({ twin_name: id.twin_name })
})
