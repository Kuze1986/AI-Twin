import { Router } from 'express'
import { z } from 'zod'
import type { AuthedRequest } from '../authMiddleware.js'
import { requireUserAuth } from '../authMiddleware.js'
import { runPatternDetection } from '../patternDetector/index.js'

const router = Router()

const bodySchema = z.object({
  timeWindowHours: z.number().min(1).max(168).optional().default(24)
})

/**
 * POST /sentinel/run-pattern-detection
 * Manually trigger pattern detection analysis
 */
router.post('/run-pattern-detection', requireUserAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }

  const { timeWindowHours } = parsed.data

  try {
    await runPatternDetection(timeWindowHours)
    res.json({ success: true, message: `Pattern detection completed for ${timeWindowHours}h window` })
  } catch (e: unknown) {
    const err = e as Error
    res.status(500).json({ error: { code: 'detection_error', message: err.message } })
  }
})

export const sentinelRouter = router
