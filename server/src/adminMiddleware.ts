import type { NextFunction, Request, Response } from 'express'

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.admin === true) {
    next()
    return
  }
  res.status(401).json({ error: { code: 'admin_required', message: 'Admin login required' } })
}
