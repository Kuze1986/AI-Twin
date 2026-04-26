type EngagementTrajectory = 'rising' | 'falling' | 'stable' | 'volatile'

export async function fetchDemoForgeSessionState(
  args: { sessionId: string },
): Promise<
  | {
      engagement_trajectory: EngagementTrajectory
      friction_points: string[]
      recommended_pivot: string | null
      confidence: number
    }
  | null
> {
  const baseUrl = process.env.CRUCIBLE_SIM_BASE_URL
  if (!baseUrl) return null

  const apiKey = process.env.CRUCIBLE_SIM_API_KEY ?? ''

  try {
    const res = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/crucible/session/${encodeURIComponent(args.sessionId)}/state`,
      {
        method: 'GET',
        headers: {
          'x-bioloop-key': apiKey,
        },
        signal: AbortSignal.timeout(2500),
      },
    )

    if (!res.ok) return null

    const data: unknown = await res.json().catch(() => null)
    if (!data || typeof data !== 'object') return null

    const record = data as Record<string, unknown>
    const engagement = record.engagement_trajectory
    if (
      engagement !== 'rising' &&
      engagement !== 'falling' &&
      engagement !== 'stable' &&
      engagement !== 'volatile'
    ) {
      return null
    }

    const frictionRaw = record.friction_points
    if (!Array.isArray(frictionRaw) || frictionRaw.some((v) => typeof v !== 'string')) {
      return null
    }

    const recommendedRaw = record.recommended_pivot
    if (!(recommendedRaw === null || typeof recommendedRaw === 'string')) {
      return null
    }

    const confidenceRaw = record.confidence
    if (typeof confidenceRaw !== 'number' || Number.isNaN(confidenceRaw)) {
      return null
    }

    return {
      engagement_trajectory: engagement,
      friction_points: frictionRaw,
      recommended_pivot: recommendedRaw,
      confidence: confidenceRaw,
    }
  } catch {
    return null
  }
}
