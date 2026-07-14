export class OneloWaitlist {
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly bundleId?: string,
  ) {}

  async join(
    slug: string | undefined,
    email: string,
  ): Promise<{ success: boolean; position?: number; alreadyJoined: boolean }> {
    try {
      const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
      if (slug !== undefined) body.slug = slug
      const { sdkHeaders } = await import('./sdk-headers')
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: 'POST',
        headers: { ...sdkHeaders(this.bundleId), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json() as { success: boolean; position?: number; alreadyJoined: boolean }
      return { success: json.success ?? false, position: json.position, alreadyJoined: json.alreadyJoined ?? false }
    } catch {
      return { success: false, alreadyJoined: false }
    }
  }
}
