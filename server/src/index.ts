import path from 'path'
import { fileURLToPath } from 'url'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import session from 'express-session'
import { sweepStaleSessions } from './consolidation.js'
import { env } from './env.js'
import { adminRouter } from './routes/admin.js'
import { chatRouter } from './routes/chat.js'
import { publicRouter } from './routes/public.js'
import { sessionsRouter } from './routes/sessions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()

// Railway (and other reverse proxies) terminate TLS; trust first hop for secure cookies / req.secure.
app.set('trust proxy', 1)

const allowedOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`CORS blocked: ${origin}`))
      }
    },
    credentials: true,
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())
app.use(
  session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'ai_twin_admin_sid',
    cookie: {
      path: '/',
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      // Same host serves SPA + /api; Lax avoids None+third-party quirks. Use None only if API is cross-site.
      sameSite: 'lax',
    },
  }),
)

app.use('/api/public', publicRouter)
app.use('/api/chat', chatRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/admin', adminRouter)

const clientDist = path.join(__dirname, '../../client/dist')

if (env.NODE_ENV === 'production') {
  app.use(express.static(clientDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

setInterval(() => {
  void sweepStaleSessions()
}, env.CONSOLIDATION_INTERVAL_MS).unref()

app.listen(env.PORT, () => {
  console.log(`[ai-twin] server listening on ${env.PORT}`)
})
