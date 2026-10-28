// ★ ブラウザのグローバル（window）に付く、このサイト独自のものの型。

/** OneSignal Web SDK v16 のうち、このサイトで使う部分だけ。 */
export interface OneSignalApi {
	init(options: Record<string, unknown>): Promise<void>
	login(externalId: string): Promise<void>
	logout(): Promise<void>
	User: {
		PushSubscription: {
			optedIn?: boolean
			id?: string | null
			optIn(): Promise<void>
		}
	}
}

declare global {
	interface Window {
		/** OneSignal SDK が読み込まれたあとに実行される関数のキュー。 */
		OneSignalDeferred?: Array<(oneSignal: OneSignalApi) => void | Promise<void>>
		OneSignal?: unknown
		/** 計測結果の全文（管理者のパネルを開いたときに入る。コンソールから取り出す用）。 */
		__perfReport?: string
	}
}
