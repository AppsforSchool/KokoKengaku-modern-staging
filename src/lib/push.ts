// ★ OneSignalによるプッシュ通知の共通処理（既存の notify.js と同じ）。
//   APIキーは、Firestore の system_keys/onesignal に保存されている： { appId, restApiKey }
//   ★ このサイトの通知用のキーは、ここ（loadKeys）と、送信（postNotification）だけが触る。
//     あとで、キーを隠す Worker 経由に切り替えるときは、このファイルの中だけを変える（呼び出し側は変えない）。
import type { Firestore } from 'firebase/firestore'
import { authStorageMode, collection, db as appDb, doc, firestoreCacheMode, firestoreTransport, getDoc, getDocs, hedged } from '../firebase'
import { perfNote, perfStart } from './perf'
import { createTextBadge, setStatusBadgeVisible } from './statusBadge'

const KEY_DOC_ID = 'onesignal'

interface OneSignalKeys {
	appId: string
	restApiKey: string
}

let keysCache: OneSignalKeys | null = null
let initPromise: Promise<void> | null = null
let initError: Error | null = null // 直近の初期化エラー（iPhoneではConsoleが見られないので画面に出す用）
let ctx: { db: Firestore; userId: string } | null = null // 再試行用
let initStep = '' // 初期化のどの段階か（エラー表示用）

function toError(e: unknown): Error {
	return e instanceof Error ? e : new Error(String(e))
}

async function loadKeys(db: Firestore): Promise<OneSignalKeys> {
	if (keysCache) return keysCache
	const snap = await hedged(() => getDoc(doc(db, 'system_keys', KEY_DOC_ID)))
	if (!snap.exists()) throw new Error(`Firestoreの system_keys/${KEY_DOC_ID} が見つかりません。`)
	const data = snap.data() as Partial<OneSignalKeys>
	if (!data.appId || !data.restApiKey) throw new Error(`system_keys/${KEY_DOC_ID} に appId / restApiKey がありません。`)
	keysCache = { appId: data.appId, restApiKey: data.restApiKey }
	return keysCache
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string | (() => string)): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(typeof message === 'function' ? message() : message)), ms),
		),
	])
}

// ★ 「通知の受信を準備中…」バッジ（通知を「受け取る」ための端末側の準備。送信には影響しない）
//   ページの読み込みが終わった時点で、OneSignalの初期化がまだ終わっていなければ、画面左上（ヘッダーのすぐ下）に表示し、
//   初期化の処理が終わったら（成功・失敗・15秒のタイムアウトのいずれでも）消す。表示の対象は、ページを開いたときの最初の自動初期化だけで、
//   「通知をオンにする」ボタンからの再試行中は出さない（ボタン側に進行状況が出るため）。
let pushBadgeTracking = false // 最初の自動初期化を追跡中か
let pushBadgeDone = false // その初期化が終わったか（成功・失敗とも）
let pageLoadFinished = false // ページの読み込みが終わったか
let pushBadgeEl: HTMLElement | null = null

function updatePushBadge(): void {
	const show = pageLoadFinished && pushBadgeTracking && !pushBadgeDone
	if (!show && !pushBadgeEl) return
	if (!pushBadgeEl) pushBadgeEl = createTextBadge('通知の受信を準備中…', 1) // order=1 ＝ いちばん上
	setStatusBadgeVisible(pushBadgeEl, show)
}

/** ページの読み込みが終わった（読み込み画面を閉じた）ときに呼ぶ。 */
export function notifyPageLoadFinished(): void {
	pageLoadFinished = true
	updatePushBadge()
}

/** ログイン後に1回呼ぶ。OneSignalを初期化し、Firebaseのユーザー名(userId)と端末を紐づける。 */
export function initPush(db: Firestore, userId: string): Promise<void> {
	ctx = { db, userId }
	if (initPromise) return initPromise
	initError = null
	const trackBadge = !pushBadgeTracking && !pushBadgeDone // ページを開いたときの最初の初期化だけバッジの対象にする
	if (trackBadge) {
		pushBadgeTracking = true
		updatePushBadge()
	}
	const promise: Promise<void> = (async () => {
		initStep = 'Firestoreからキーを取得中'
		const { appId } = await loadKeys(db)
		// キー取得は終わったので、段階の表示を進める
		initStep = 'OneSignal SDK（OneSignalSDK.page.js）の読み込み待ち'
		// GitHub Pagesのサブパス公開でも動くよう、現在のページのフォルダをService Workerの範囲にする
		const base = location.pathname.replace(/[^/]*$/, '')
		window.OneSignalDeferred = window.OneSignalDeferred || []
		const sdkReady = new Promise<void>((resolve, reject) => {
			window.OneSignalDeferred!.push(async (OneSignal) => {
				try {
					initStep = 'OneSignalの初期化中（Service Workerの登録など）'
					await OneSignal.init({
						appId,
						serviceWorkerPath: base + 'OneSignalSDKWorker.js',
						serviceWorkerParam: { scope: base },
						allowLocalhostAsSecureOrigin: true,
						notifyButton: { enable: false },
					})
					initStep = 'ユーザーの紐づけ中'
					await OneSignal.login(userId)
					initStep = ''
					resolve()
				} catch (e) {
					reject(e)
				}
			})
		})
		await withTimeout(
			sdkReady,
			15000,
			() =>
				'OneSignalの準備が終わりませんでした。\n止まった段階: ' +
				(initStep || 'SDKの読み込み待ち（SDKが読み込めていない可能性）'),
		)
	})()
		.catch((e: unknown) => {
			initError = toError(e)
			initPromise = null // 次回押したときに再試行できるようにする
			console.warn('プッシュ通知の初期化に失敗:', e)
		})
		.finally(() => {
			// 成功・失敗・15秒のタイムアウトのいずれでも、最初の初期化の処理が終わったらバッジを消す
			if (trackBadge) {
				pushBadgeDone = true
				updatePushBadge()
			}
		})
	initPromise = promise
	return promise
}

/**
 * 各ページが、自分のユーザー情報を取得したあとに呼ぶ（既存の appScript / talkScript と同じ位置）。
 * OneSignalの初期化を、画面の表示とは並行して始める。失敗しても、画面の表示には影響しない。
 * 計測には、通信方式などのメモと、初期化にかかった時間（並行）を残す。
 */
export function startPush(userId: string): void {
	perfNote(`Firestore通信方式: ${firestoreTransport} / 永続キャッシュ: ${firestoreCacheMode} / ログイン情報の保存先: ${authStorageMode}`)
	const endPushPerf = perfStart('OneSignal初期化（キー取得・SDK・login）')
	void initPush(appDb, userId).then(endPushPerf, endPushPerf)
}

/** 診断用：OneSignal初期化の現在の状態（失敗していれば、止まった段階を含むメッセージ）。 */
export function getPushInitStatus(): string {
	if (initError) return '失敗: ' + (initError.message || String(initError)).replace(/\n/g, ' ') + ' / window.OneSignal: ' + typeof window.OneSignal
	if (initPromise)
		return (initStep ? '初期化中（段階: ' + initStep + '）' : '完了、または初期化中') + ' / window.OneSignal: ' + typeof window.OneSignal
	return '未開始'
}

/** ログアウト前に呼ぶ（この端末に前のユーザー宛の通知が届き続けないようにする）。 */
export async function logoutPush(): Promise<void> {
	try {
		window.OneSignalDeferred = window.OneSignalDeferred || []
		await new Promise<void>((resolve) => {
			window.OneSignalDeferred!.push(async (OneSignal) => {
				try {
					await OneSignal.logout()
				} catch (e) {
					console.warn(e)
				}
				resolve()
			})
			setTimeout(resolve, 3000) // 初期化されていない場合に固まらないように
		})
	} catch (e) {
		console.warn(e)
	}
}

/** この端末が実際にOneSignalで購読済みかどうかを取得する。 */
export function getPushSubscription(): Promise<{ optedIn: boolean; id: string }> {
	window.OneSignalDeferred = window.OneSignalDeferred || []
	return withTimeout(
		new Promise<{ optedIn: boolean; id: string }>((resolve, reject) => {
			window.OneSignalDeferred!.push(async (OneSignal) => {
				try {
					resolve({
						optedIn: !!OneSignal.User.PushSubscription.optedIn,
						id: OneSignal.User.PushSubscription.id || '',
					})
				} catch (e) {
					reject(e)
				}
			})
		}),
		5000,
		'購読状態を取得できませんでした。',
	)
}

/** 現在の通知許可状態（true/false）。 */
export function isPushEnabled(): boolean {
	return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

/** 初期化の完了を待つ（進行中の初期化があればそれを、なければ再試行する）。失敗していれば、そのエラーを投げる。 */
export async function waitForPushInit(): Promise<void> {
	if (!initPromise && ctx) void initPush(ctx.db, ctx.userId)
	if (initPromise) await initPromise
	if (initError) throw initError
}

/** 初期化が進行中・完了していれば、その完了を待つ（再試行はしない）。 */
export async function waitForPushInitIfStarted(): Promise<void> {
	if (initPromise) await initPromise
}

/** この端末を購読状態にする（ブラウザの許可を得たあとに呼ぶ）。 */
export function optInToPush(): Promise<void> {
	window.OneSignalDeferred = window.OneSignalDeferred || []
	return withTimeout(
		new Promise<void>((resolve, reject) => {
			window.OneSignalDeferred!.push(async (OneSignal) => {
				try {
					await OneSignal.User.PushSubscription.optIn()
					resolve()
				} catch (e) {
					reject(e)
				}
			})
		}),
		15000,
		'購読の登録が終わりませんでした（optIn待ち）。',
	)
}

// ---------- 送信 ----------

interface PostNotificationArgs {
	appId: string
	restApiKey: string
	ids: string[]
	title: string
	body: string
	url: string
	topic?: string
}

/** OneSignalのREST APIで、指定したユーザーID宛に通知を1件送る（内部共通処理）。 */
async function postNotification({ appId, restApiKey, ids, title, body, url, topic }: PostNotificationArgs): Promise<void> {
	const payload: Record<string, unknown> = {
		app_id: appId,
		target_channel: 'push',
		include_aliases: { external_id: ids },
		headings: { en: title, ja: title },
		contents: { en: body, ja: body },
		url,
	}
	if (topic) payload.web_push_topic = topic // 同じトピックの通知は最新1件にまとまる

	const res = await fetch('https://api.onesignal.com/notifications', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			Authorization: `Key ${restApiKey}`,
		},
		body: JSON.stringify(payload),
	})
	if (!res.ok) console.warn('通知送信エラー:', res.status, await res.text())
}

/**
 * 特定のユーザー宛に、任意のタイトル・本文で通知を送る（アンケート回答の通知など）。
 * 失敗しても呼び出し元の処理には影響させない。
 * ※ url は、現在のページを基準にした相対URL（例：talk.html?id=…）。旧URLのままにしているのは、
 *   すでに配られた通知・古い端末でも同じように開けるため（public/ のリダイレクトが、新しいルートに変換する）。
 */
export async function sendPushToUsers(
	db: Firestore,
	{ targetIds, title, body, url, topic }: { targetIds: string[]; title: string; body: string; url?: string; topic?: string },
): Promise<void> {
	try {
		const ids = (targetIds || []).filter(Boolean)
		if (ids.length === 0) return
		const { appId, restApiKey } = await loadKeys(db)
		const absoluteUrl = new URL(url || '', location.href).href
		await postNotification({ appId, restApiKey, ids, title, body, url: absoluteUrl, topic })
	} catch (e) {
		console.warn('通知送信に失敗:', e)
	}
}

/**
 * プロフィールを変更したことを、サイトの全ユーザー（変更した本人は除く）へ通知する。
 * 宛先は Firestore の users_random コレクションの全ドキュメントID（isActive が false の人は除く）。
 * 失敗しても呼び出し元の処理には影響させない。
 */
export async function sendProfileChangeNotification(
	db: Firestore,
	{ senderId, userName }: { senderId: string; userName: string },
): Promise<void> {
	try {
		const snapshot = await getDocs(collection(db, 'users_random'))
		const ids = snapshot.docs
			.filter((d) => (d.data() || {}).isActive !== false)
			.map((d) => d.id)
			.filter((id) => id !== senderId)
		await sendPushToUsers(db, {
			targetIds: ids,
			title: 'プロフィール変更',
			body: `${userName}がプロフィールを変更しました`,
			url: 'app.html',
		})
	} catch (e) {
		console.warn('プロフィール変更の通知に失敗:', e)
	}
}

export interface MessageNotificationArgs {
	roomId: string
	roomTitle?: string
	memberIds: string[]
	senderId: string
	senderName?: string
	text?: string
	replyToUserId?: string | null
	replyToName?: string | null
}

/**
 * 新着メッセージを、ルームのメンバー（送信者本人を除く）へ通知する。
 *   タイトル: 「トークルーム名|送信者名」（個人トークは送信者名だけ）
 *   本文    : 通常は「メッセージ内容」、返信なら「〇〇に返信しました－メッセージ内容」
 *             （返信先が受信者本人なら「あなたに返信しました－メッセージ内容」）
 * 失敗してもメッセージ送信自体には影響させない（エラーは握りつぶす）。
 */
export async function sendMessageNotification(
	db: Firestore,
	{ roomId, roomTitle, memberIds, senderId, senderName, text, replyToUserId, replyToName }: MessageNotificationArgs,
): Promise<void> {
	try {
		const targets = (memberIds || []).filter((id) => id && id !== senderId)
		if (targets.length === 0) return

		const { appId, restApiKey } = await loadKeys(db)
		const content = (text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'メッセージが届きました'
		const url = new URL(`talk.html?id=${encodeURIComponent(roomId)}`, location.href).href
		const title = roomTitle ? `${roomTitle}|${senderName || '不明なユーザー'}` : senderName || '不明なユーザー'

		// 宛先ごとの本文を決める（返信先の本人だけ「あなたに」になる）
		const groups: Array<{ ids: string[]; body: string }> = []
		if (replyToUserId) {
			const replied = targets.filter((id) => id === replyToUserId)
			const others = targets.filter((id) => id !== replyToUserId)
			if (replied.length) groups.push({ ids: replied, body: `あなたに返信しました－${content}` })
			if (others.length) groups.push({ ids: others, body: `${replyToName || replyToUserId}に返信しました－${content}` })
		} else {
			groups.push({ ids: targets, body: content })
		}

		await Promise.all(
			groups.map((group) => postNotification({ appId, restApiKey, ids: group.ids, title, body: group.body, url, topic: roomId })),
		)
	} catch (e) {
		console.warn('通知送信に失敗（CORSの可能性あり）:', e)
	}
}
