import type { NextFunction, Request, Response } from 'express'
import { supabaseAdmin } from './supabaseAdmin.js'

export interface AuthedRequest extends Request {
  userId: string
}

export async function requireUserAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Missing bearer token' } })
    return
  }
  const token = h.slice(7)
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid or expired token' } })
    return
  }
  ;(req as AuthedRequest).userId = data.user.id
  next()
}
