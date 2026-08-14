import path from 'path'
import { fileURLToPath } from 'url'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import session from 'express-session'
import { sweepStaleSessions } from './consolidation.js'
import { emailConfigured, env } from './env.js'
import { pollInbox } from './email/poller.js'
import { adminRouter } from './routes/admin.js'
import { chatRouter } from './routes/chat.js'
import { constitutionRouter } from './routes/constitution.js'
import { emailRouter } from './routes/email.js'
import { publicRouter } from './routes/public.js'
import { peerRouter } from './routes/peer.js'
import { sentinelRouter } from './routes/sentinel.js'
import { sessionsRouter } from './routes/sessions.js'
import { tasksRouter } from './routes/tasks.js'
import { toolLogRouter } from './routes/toolLog.js'
import { runTaskQueue } from './tasks/worker.js'
import { logToolStartup } from './tools/registry.js'
import { resolveActiveProvider } from './inference/messagesCreate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()

// Railway (and other reverse proxies) terminate TLS; trust first hop for secure cookies / req.secure.
app.set('trust proxy', 1)

const allowedOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)

app.use(
  '/api',
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
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ai-twin', timestamp: new Date().toISOString() })
})
app.use('/api/chat', chatRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/peer', peerRouter)
app.use('/api/admin', adminRouter)
app.use('/api/admin/constitution', constitutionRouter)
app.use('/api/admin/email', emailRouter)
app.use('/api/admin/tasks', tasksRouter)
app.use('/api/admin/tool-log', toolLogRouter)
app.use('/api/sentinel', sentinelRouter)

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

if (emailConfigured()) {
  setInterval(() => {
    void pollInbox()
  }, env.EMAIL_POLL_INTERVAL_MS).unref()
}

setInterval(() => {
  void runTaskQueue()
}, env.TASK_WORKER_INTERVAL_MS).unref()

app.listen(env.PORT, () => {
  console.log(`[ai-twin] server listening on ${env.PORT}`)
  console.log('[startup] DemoForge endpoint: POST /api/chat/demoforge')
  const activeProvider = resolveActiveProvider()
  if (activeProvider) {
    console.log(`[startup] LLM provider: ${activeProvider}`)
  } else {
    console.warn('[startup] No LLM provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / KUZE_OPENAI_BASE_URL) — chat disabled until one is set')
  }
  logToolStartup()

  if (emailConfigured()) {
    console.log(`[startup] Email channel ENABLED for ${env.KUZE_EMAIL_ADDRESS} — polling every ${env.EMAIL_POLL_INTERVAL_MS}ms`)
  } else if (env.EMAIL_ENABLED) {
    console.warn('[startup] EMAIL_ENABLED=true but IONOS credentials are incomplete — email channel dormant')
  }

  if (env.CRUCIBLE_SIM_BASE_URL) {
    void (async () => {
      try {
        const res = await fetch(`${env.CRUCIBLE_SIM_BASE_URL.replace(/\/+$/, '')}/api/health`, {
          method: 'GET',
          headers: {
            'x-bioloop-key': env.CRUCIBLE_SIM_API_KEY,
          },
          signal: AbortSignal.timeout(3000),
        })

        if (res.ok) {
          console.log('[startup] Crucible reachable at', env.CRUCIBLE_SIM_BASE_URL)
          return
        }

        console.warn(
          '[startup] Crucible responded with status',
          res.status,
          '— behavioral loop may be degraded',
        )
      } catch {
        console.warn(
          '[startup] Crucible unreachable at',
          env.CRUCIBLE_SIM_BASE_URL,
          '— DemoForge sessions will use default behavior',
        )
      }
    })()
  }
})
