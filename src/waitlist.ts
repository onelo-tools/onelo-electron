import { waitlistConsentField, waitlistLanguageField, type WaitlistJoinOptions } from '@onelo/core'

export class OneloWaitlist {
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly bundleId?: string,
    /** #1078: the App's language (`OneloElectronConfig.language`), sent when a
     *  join passes none of its own; else the device language. */
    private readonly language?: string,
  ) {}

  async join(
    slug: string | undefined,
    email: string,
    /** #818: the checkboxes your form showed — `{ consent: { marketing, custom } }`.
     *  #1038: `language` — the App's language for this sign-up; omitted,
     *  `OneloElectronConfig.language` (#1078), else the device language, is
     *  sent and the backend stores the join's Page Language. */
    options?: WaitlistJoinOptions,
  ): Promise<{ success: boolean; position?: number; alreadyJoined: boolean }> {
    try {
      const body: Record<string, unknown> = {
        publishableKey: this.publishableKey, email, ...waitlistConsentField(options),
        ...waitlistLanguageField({ ...options, language: options?.language ?? (this.language || undefined) }),
      }
      if (slug !== undefined) body.slug = slug
      const { sdkHeaders } = await import('./sdk-headers')
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: 'POST',
        headers: { ...sdkHeaders(this.bundleId), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Backend contract: 2xx with { ok: true, position?, alreadyJoined? }; errors are
      // non-2xx FastAPI { detail } bodies.
      const json = await res.json().catch(() => ({})) as { ok?: boolean; position?: number; alreadyJoined?: boolean }
      const success = res.ok && json.ok === true
      return { success, position: json.position, alreadyJoined: success && json.alreadyJoined === true }
    } catch {
      return { success: false, alreadyJoined: false }
    }
  }
}
