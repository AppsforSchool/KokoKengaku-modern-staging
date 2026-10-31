import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { DocumentData, DocumentSnapshot, QuerySnapshot } from 'firebase/firestore'
import {
	arrayUnion,
	collection,
	db,
	doc,
	getDoc,
	hedged,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
} from '../../firebase'
import { formatDateTime } from '../../lib/dateFormat'
import { runFirestoreDiagnostics } from '../../lib/diag'
import { perfMark, perfNote, perfNotifyReportAvailable, perfSample, perfStart } from '../../lib/perf'
import { notifyPageLoadFinished } from '../../lib/push'
import { createGaugeBadge, type GaugeBadge, type ImageGroupTracker } from '../../lib/statusBadge'
import { getUserCache, hasActivePrize, type UserCacheEntry } from '../../lib/userCache'
import { renderMessageText, stripTagsToPlainText } from './messageText'
import { createTalkUsers } from './talkUsers'
import type { MessageData, MessageView, ReplyContextView } from './types'

// ★ トーク画面のデータの読み込みと、メッセージ一覧の組み立て（既存の talkScript.js の
//   setupMemberSnapshots / getAllTalkData / waitForImagesThenHideOverlay / hideLoadingOverlayNow に対応）。
//   ・① 表示と既読：ヘッダー、メッセージの表示、未読の区切り線、既読の記録（readBy・lastChecked・unreadCounts）、返信元、画像の読み込み待ち。
//   ・Firestoreへの書き込みの形は、既存のまま（Firestoreのルールが依存している。変えないこと）：
//       users_random/{自分}   updateDoc  { "unreadCounts.{ルームID}": 0 }
//       users_random/{自分}   setDoc(merge)  { lastChecked: { {ルームID}: serverTimestamp() } }
//       KokoKengaku/{ルームID}/talk/{メッセージID}  updateDoc  { readBy: arrayUnion(自分) }

export interface TalkRoomStart {
	myUserId: string
	meIsAdmin: boolean
	/** このセッションを開いた時点での、自分の最終確認日時。未読の区切り線の基準（あとで更新されても、上書きしない）。 */
	initialLastChecked: Date | null
}

export interface RoomHeader {
	title: string
	imageUrl: string
	/** メンバー3人以上ならグループ（2人以下は個人トーク）。 */
	isGroup: boolean
	/** アイコンを変更するたびに増える（0 は、最初の表示。ヘッダーのアイコンを作り直す目印）。 */
	iconVersion: number
}

interface Params {
	talkId: string
	start: TalkRoomStart | null
	roomIconTracker: ImageGroupTracker
	/** 致命的なエラーを、ダイアログで知らせる。 */
	showError: (message: string) => Promise<void>
	/** 存在しないルームIDのとき：アラートを出し、OKのあとで一覧へ戻る。 */
	onRoomNotFound: () => Promise<void>
}

let viewSeq = 0 // MessageView を作るたびに増やす番号

const NOT_FOUND_MESSAGE = '指定されたトークルームは見つかりませんでした。'

export function useTalkRoom({ talkId, start, roomIconTracker, showError, onRoomNotFound }: Params) {
	// ---- 読み込み画面 ----
	const [loadingText, setLoadingText] = useState('システムの読み込みに時間がかかる場合があります｡')
	const [loadingPercent, setLoadingPercent] = useState(0)
	const [overlayHidden, setOverlayHidden] = useState(false)
	const [contentVisible, setContentVisible] = useState(false) // トーク本体（読み込み完了までは非表示）
	const [showSkip, setShowSkip] = useState(false)

	// ---- 画面の内容 ----
	const [header, setHeader] = useState<RoomHeader | null>(null)
	const [items, setItems] = useState<MessageView[]>([])
	const [dividerBeforeId, setDividerBeforeId] = useState<string | null>(null)
	const [messagesReady, setMessagesReady] = useState(false)

	const talkAreaRef = useRef<HTMLDivElement>(null)

	// ---- 既存のモジュール変数に当たるもの（画面を離れたら、捨てる） ----
	const users = useMemo(() => createTalkUsers(talkId), [talkId])
	const roomMembersRef = useRef<string[]>([])
	const roomIsGroupRef = useRef(false)
	const roomTitleRef = useRef('')
	const isInitialLoadRef = useRef(true) // 初回のトーク表示かどうか
	const skippedRef = useRef(false) // 「あとで読み込む」が押されたか
	const meIsAdminRef = useRef(false)
	const initialLastCheckedRef = useRef<Date | null>(null)
	const unreadDividerIdRef = useRef<string | null>(null)
	const messagesByIdRef = useRef<Record<string, MessageData>>({})
	const viewsByIdRef = useRef<Map<string, MessageView>>(new Map())
	const fullOrderRef = useRef<string[]>([])
	const imageBadgeRef = useRef<GaugeBadge | null>(null)
	const imageProgressRef = useRef({ loaded: 0, total: 0, active: false })

	const setLoadingStage = useCallback((text: string, percent?: number) => {
		setLoadingText(text)
		if (typeof percent === 'number') setLoadingPercent(Math.max(0, Math.min(100, percent)))
	}, [])

	// ---------- スクロール位置 ----------
	// 未読区切り線があれば、それが一番上に来るように。なければ一番下（最新メッセージ）に。
	// #selection-container が非表示（display:none）の間は、スクロール量を正しく計算できないため、表示された直後にも呼び直す。
	const scrollTalkAreaToTarget = useCallback(() => {
		const talkAreaEl = talkAreaRef.current
		if (!talkAreaEl) return
		const dividerEl = talkAreaEl.querySelector('#unread-divider')
		if (dividerEl) {
			dividerEl.scrollIntoView({ block: 'start', behavior: 'auto' })
		} else if (initialLastCheckedRef.current === null) {
			// 一度もこのトークに入ったことがない（最終確認日時が記録されていない）場合は、一番上＝最初のメッセージまで
			talkAreaEl.scrollTop = 0
		} else {
			talkAreaEl.scrollTop = talkAreaEl.scrollHeight
		}
	}, [])

	// 読み込み画面が閉じて、トーク本体が表示された直後に、スクロール位置を合わせ直す
	useLayoutEffect(() => {
		if (contentVisible) scrollTalkAreaToTarget()
	}, [contentVisible, scrollTalkAreaToTarget])

	// ---------- 読み込み画面を閉じる ----------
	const hideLoadingOverlayNow = useCallback(() => {
		perfMark(skippedRef.current ? '「あとで読み込む」で表示（画像は未完了）' : 'オーバーレイを閉じてトークを表示')
		// 管理者にだけ、左上に「計測結果をみる」ボタンを1分間表示
		const id = start ? start.myUserId : ''
		perfNotifyReportAvailable({
			isAdmin: meIsAdminRef.current,
			page: 'talk.html（トーク画面）',
			diagnostics: () => runFirestoreDiagnostics(id),
		})
		setOverlayHidden(true)
		setShowSkip(false)
		notifyPageLoadFinished() // この時点でOneSignalの初期化が未完了なら、「通知の受信を準備中…」を表示する
		roomIconTracker.finish() // アイコンが読み込み中なら、「トークルームのアイコンを読み込み中…」を表示する
		setContentVisible(true)
	}, [start, roomIconTracker])

	// 「画像を読み込み中…(a/b)」の通知（「あとで読み込む」を押したあと、画像がまだ読み込み中のあいだだけ出す）
	const refreshImageBadge = useCallback(() => {
		const progress = imageProgressRef.current
		const show = skippedRef.current && progress.active && progress.loaded < progress.total
		if (!show && !imageBadgeRef.current) return
		if (!imageBadgeRef.current) imageBadgeRef.current = createGaugeBadge(4) // order=4 ＝ OneSignal(1)・トークルームのアイコン(2)の下
		if (show) {
			imageBadgeRef.current.set(`画像を読み込み中…(${progress.loaded}/${progress.total})`, progress.loaded / progress.total)
			imageBadgeRef.current.show()
		} else {
			imageBadgeRef.current.hide()
		}
	}, [])

	/** 「あとで読み込む」：いつ押しても、すぐに読み込み画面を閉じて、トークを表示する。 */
	const skipLoading = useCallback(() => {
		skippedRef.current = true
		hideLoadingOverlayNow()
		refreshImageBadge()
	}, [hideLoadingOverlayNow, refreshImageBadge])

	/** 渡された画像すべての読み込み（成功／失敗どちらでも）を待ってから、読み込み画面を閉じる。 */
	const waitForImagesThenHideOverlay = useCallback(
		async (images: HTMLImageElement[]) => {
			if (images.length === 0) {
				if (!skippedRef.current) hideLoadingOverlayNow()
				return
			}
			const total = images.length
			const progress = imageProgressRef.current
			progress.loaded = 0
			progress.total = total
			progress.active = true

			if (!skippedRef.current) {
				setLoadingText(`画像を読み込んでいます (0/${total})`)
				setShowSkip(true)
			}
			refreshImageBadge() // すでに「あとで読み込む」済みなら、ここで表示される

			await Promise.all(
				images.map(
					(img) =>
						new Promise<void>((resolve) => {
							const onDone = () => {
								progress.loaded++
								if (!skippedRef.current) setLoadingText(`画像を読み込んでいます (${progress.loaded}/${total})`)
								refreshImageBadge()
								resolve()
							}
							// すでに読み込み済み（キャッシュ等）なら、すぐ完了扱いにする
							if (img.complete) {
								onDone()
								return
							}
							img.addEventListener('load', onDone, { once: true })
							img.addEventListener('error', onDone, { once: true })
						}),
				),
			)

			progress.active = false
			refreshImageBadge() // 全部読めたので消す
			if (!skippedRef.current) hideLoadingOverlayNow()
		},
		[hideLoadingOverlayNow, refreshImageBadge],
	)

	// ---------- ルーム ----------
	/** 画面上部のタイトル＋アイコン。個人トーク(メンバー2人以下)は「相手の名前とアイコン」、グループは「グループ名とグループアイコン」。 */
	const applyRoomHeader = useCallback(
		(roomData: DocumentData, myUserId: string) => {
			const members: string[] = roomData.members || roomMembersRef.current || []
			const isGroup = members.length >= 3
			const roomImageUrl: string = roomData.imageUrl || ''
			roomIsGroupRef.current = isGroup

			let name: string
			let imageUrl: string
			if (isGroup) {
				name = roomData.title || ''
				imageUrl = roomImageUrl
			} else {
				const partnerId = members.find((id) => id !== myUserId) || myUserId
				const cached = getUserCache(partnerId) || {}
				name = cached.name || partnerId
				imageUrl = cached.imageUrl || ''
				if (partnerId === myUserId) name = `${name}（自分）`
			}
			roomTitleRef.current = name
			setHeader({ title: name, imageUrl, isGroup, iconVersion: 0 })
		},
		[],
	)

	/** ルームのメンバー情報を取得してキャッシュする。取得したルーム文書は、そのまま返す（二重に取得しないため）。 */
	const setupMembers = useCallback(async (): Promise<DocumentSnapshot | null> => {
		try {
			const perfRoomStart = performance.now()
			const roomSnapshot = await hedged(() => getDoc(doc(db, 'KokoKengaku', talkId)))
			perfSample('└ ルーム文書の取得（setupMemberSnapshots内）', performance.now() - perfRoomStart)
			// 【既存との違い】存在しないルームは、取得済みの結果をそのまま返す（呼び出し元が「見つかりません」を出す）
			if (!roomSnapshot.exists()) return roomSnapshot

			const roomData = roomSnapshot.data()
			const memberUserIds: string[] = roomData.members || []
			roomMembersRef.current = memberUserIds

			// グループは、ヘッダーに必要なのはグループ名とアイコン（ルーム文書に入っている）だけなので、メンバー全員の取得は待たずに裏で進める。
			// 個人トークは、相手の名前・アイコンが必要なので待つ。
			const endMemberPerf = perfStart(
				memberUserIds.length >= 3 ? 'メンバー情報の取得（グループ・裏で並行）' : 'メンバー情報の取得（個人トーク・待機）',
			)
			const memberFetchPromise = users.fetchAndCacheUsers(memberUserIds, { forceRefresh: true })
			memberFetchPromise.then(endMemberPerf, endMemberPerf)
			if (memberUserIds.length < 3) await memberFetchPromise
			perfNote(`メンバー数: ${memberUserIds.length}人`)

			return roomSnapshot
		} catch (error) {
			console.error('メンバーの監視設定に失敗しました:', error)
			return null
		}
	}, [talkId, users])

	// ---------- メッセージ1件分の表示情報 ----------
	const buildReplyContext = useCallback((replyTargetId: string, myUserId: string): ReplyContextView => {
		const target = messagesByIdRef.current[replyTargetId]
		if (!target) {
			return { missing: true, label: '返信', tone: 'other', snippet: '元のメッセージは見つかりません', targetId: replyTargetId }
		}
		const cached = getUserCache(target.userId || '') || {}
		const targetName = cached.name || '不明なユーザー'

		let snippetText = ''
		if (target.message && target.message.trim() !== '') {
			snippetText = stripTagsToPlainText(target.message)
		} else if (target.imageUrl) {
			snippetText = '[画像]'
		} else if (Array.isArray(target.choices) && target.choices.length > 0) {
			snippetText = `[アンケート] ${target.message || ''}`
		}
		return {
			missing: false,
			label: `${targetName}に返信`,
			tone: target.userId === myUserId ? 'own' : 'other', // 自分のものなら青、そうでなければ薄いグレー
			snippet: snippetText,
			targetId: replyTargetId,
		}
	}, [])

	const buildMessageView = useCallback(
		(docId: string, messageData: MessageData, myUserId: string): MessageView => {
			const messageUserId = messageData.userId
			const isOwn = messageUserId === myUserId

			let senderName = '不明なユーザー'
			let isAdmin = false
			let senderImageUrl = ''
			let senderHasPrize = false
			if (messageUserId) {
				const cached: UserCacheEntry = getUserCache(messageUserId) || { name: '不明なユーザー', isAdmin: false, imageUrl: '' }
				senderName = cached.name ?? ''
				isAdmin = !!cached.isAdmin
				senderImageUrl = cached.imageUrl ?? ''
				senderHasPrize = hasActivePrize(cached)
			}

			let displayTime = '時間不明'
			if (messageData.time) displayTime = formatDateTime(messageData.time.toDate())

			// 他の人のメッセージを見たら、既読にする
			const readByList = messageData.readBy || []
			if (messageData.userId !== myUserId && !readByList.includes(myUserId)) {
				updateDoc(doc(db, 'KokoKengaku', talkId, 'talk', docId), {
					readBy: arrayUnion(myUserId),
				}).catch((err) => console.error('既読更新エラー:', err))
			}

			const hasText = !!(messageData.message && messageData.message.trim() !== '')
			return {
				id: docId,
				seq: ++viewSeq,
				isOwn,
				userId: messageUserId,
				senderName,
				senderIsAdmin: isAdmin,
				senderHasPrize,
				senderImageUrl,
				displayTime,
				readBy: readByList,
				reply: messageData.replyTo ? buildReplyContext(messageData.replyTo, myUserId) : null,
				imageUrl: messageData.imageUrl || '',
				hasText,
				textNode: hasText ? renderMessageText(messageData.message as string) : null,
				data: messageData,
			}
		},
		[talkId, buildReplyContext],
	)

	// ---------- メッセージの受信 ----------
	// 既存は、スナップショットが届くたびに、変化のあった分（docChanges）だけDOMを更新していた。
	// ここでも、変化のあった分だけ表示情報（MessageView）を作り直し、変化のないものは、そのまま保つ。
	const lockTailRef = useRef<Promise<unknown>>(Promise.resolve())
	const runInOrder = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
		const result = lockTailRef.current.then(fn)
		lockTailRef.current = result.catch(() => undefined)
		return result
	}, [])

	const updateLastCheckedTime = useCallback(async (myUserId: string) => {
		try {
			await setDoc(
				doc(db, 'users_random', myUserId),
				{
					lastChecked: {
						[talkId]: serverTimestamp(),
					},
				},
				{ merge: true },
			)
			console.log(`${talkId} の最終確認時刻を更新しました`)
		} catch (error) {
			console.error('最終確認時刻の更新に失敗:', error)
		}
	}, [talkId])

	const handleMessageSnapshot = useCallback(
		async (messageSnapshot: QuerySnapshot<DocumentData>, myUserId: string, isAlive: () => boolean) => {
			// 永続キャッシュが空の初回は「キャッシュ由来の空」が先に届くことがあるので、サーバーの結果を待つ
			if (isInitialLoadRef.current && messageSnapshot.metadata.fromCache && messageSnapshot.empty) return
			// このスナップショットが「初回のトーク表示」かどうかを、ここで固定する
			const isThisInitialLoad = isInitialLoadRef.current
			if (isThisInitialLoad) {
				isInitialLoadRef.current = false
				perfMark('メッセージの初回データ受信（onSnapshot）')
			}

			const changes = messageSnapshot.docChanges()
			const builtIds: string[] = []

			await runInOrder(async () => {
				// このバッチで新たに必要になる送信者情報を、まとめて（1人1件のgetDocを並列で）取得しておく
				const candidateSenderIds: string[] = []
				changes.forEach((change) => {
					if (change.type === 'removed') return
					const data = change.doc.data()
					if (data.isDisplay === false) return
					if (data.userId) candidateSenderIds.push(data.userId)
				})
				await users.fetchAndCacheUsers(candidateSenderIds)
				if (isThisInitialLoad) perfMark('送信者情報の取得（fetchAndCacheUsers）')
				if (!isAlive()) return

				const messagesById = messagesByIdRef.current
				const views = viewsByIdRef.current
				const fullOrder = fullOrderRef.current
				const totalChanges = changes.length
				let processedChanges = 0

				changes.forEach((change) => {
					processedChanges++
					if (isThisInitialLoad && !skippedRef.current && totalChanges > 0) {
						const percent = Math.round((processedChanges / totalChanges) * 100)
						// このステージは、進捗バー全体の30%〜100%の区間にマッピングする
						setLoadingStage(`トークを読み込んでいます (${percent}%)`, 30 + (percent / 100) * 70)
					}

					const talkDoc = change.doc
					const docId = talkDoc.id
					const previousData = messagesById[docId]
					const messageData = (change.type === 'removed' ? previousData : talkDoc.data()) as MessageData | undefined
					if (!messageData) return // 存在しないデータのremovedは無視

					// Firestoreの並び順そのもの（非表示メッセージも含む）を、公式手順通りに更新する
					if (change.oldIndex !== -1 && change.oldIndex < fullOrder.length) fullOrder.splice(change.oldIndex, 1)
					if (change.type !== 'removed' && change.newIndex !== -1) fullOrder.splice(change.newIndex, 0, docId)

					// 返信元参照用のマップは、表示可否に関わらず全メッセージ分を保持する
					if (change.type === 'removed') delete messagesById[docId]
					else messagesById[docId] = messageData

					// 未読区切り線を出す位置は、初回表示時にのみ判定して固定する
					// （その後に自分や他人が新しく送ったメッセージが対象になることはない）
					if (
						isThisInitialLoad &&
						unreadDividerIdRef.current === null &&
						initialLastCheckedRef.current &&
						messageData.time &&
						messageData.isDisplay !== false
					) {
						if (messageData.time.toDate() > initialLastCheckedRef.current) unreadDividerIdRef.current = docId
					}

					const shouldDisplay = change.type !== 'removed' && messageData.isDisplay !== false
					if (!shouldDisplay) {
						// 削除・非表示化された場合は、表示されていれば取り除くだけ
						views.delete(docId)
						return
					}
					views.set(docId, buildMessageView(docId, messageData, myUserId))
					builtIds.push(docId)
				})

				// 画面に反映する（並び順は、fullOrder のうち、表示するもの）
				const list: MessageView[] = []
				fullOrder.forEach((id) => {
					const view = views.get(id)
					if (view) list.push(view)
				})
				// 区切り線は、対象のメッセージの直前。対象が非表示になっていても、区切り線は元の位置に残る（既存と同じ）
				let dividerId: string | null = null
				const target = unreadDividerIdRef.current
				if (target) {
					const startIndex = fullOrder.indexOf(target)
					for (let i = Math.max(startIndex, 0); i < fullOrder.length; i++) {
						if (views.has(fullOrder[i])) {
							dividerId = fullOrder[i]
							break
						}
					}
				}
				flushSync(() => {
					setItems(list)
					setDividerBeforeId(dividerId)
					setMessagesReady(true)
				})

				// 初回表示時は「未読区切り線」があればそれを一番上に、無ければ一番下にスクロール。
				// 2回目以降（新着メッセージ受信時など）は、一番下にスクロールする。
				if (isThisInitialLoad) {
					scrollTalkAreaToTarget()
				} else if (talkAreaRef.current) {
					talkAreaRef.current.scrollTop = talkAreaRef.current.scrollHeight
				}

				void updateLastCheckedTime(myUserId)
			})
			if (!isAlive()) return

			if (isThisInitialLoad) {
				// このバッチで表示された画像（初回表示時の読み込み待ちに使う）
				const images: HTMLImageElement[] = []
				const talkAreaEl = talkAreaRef.current
				if (talkAreaEl) {
					builtIds.forEach((id) => {
						const el = talkAreaEl.querySelector(`[id="msg-${id}"]`)
						const img = el ? el.querySelector('img.message-image') : null
						if (img) images.push(img as HTMLImageElement)
					})
				}
				perfMark('メッセージのDOM構築')
				perfNote(`メッセージ件数（初回受信）: ${changes.length}件 / 画像: ${images.length}枚`)

				// 画像を除く読み込みはここまでで完了なので、進捗バーを満タンにしておく（以降の画像読み込み待ちは、進捗バーの対象外）
				setLoadingPercent(100)
				await waitForImagesThenHideOverlay(images)
			}
		},
		[users, runInOrder, buildMessageView, scrollTalkAreaToTarget, updateLastCheckedTime, setLoadingStage, waitForImagesThenHideOverlay],
	)

	// ---------- 全体の流れ（既存の onAuthStateChanged の中の、ルームを読み込む部分） ----------
	useEffect(() => {
		if (!start) return
		// 画面を離れた（または、開発時の二重実行で、やり直しになった）あとは、この回の処理を止める
		let cancelled = false
		const isAlive = () => !cancelled
		const subscription: { unsubscribe: (() => void) | null } = { unsubscribe: null } // 画面を離れるときに、メッセージの購読を止める
		const { myUserId } = start
		meIsAdminRef.current = start.meIsAdmin
		initialLastCheckedRef.current = start.initialLastChecked

		void (async () => {
			try {
				setLoadingStage('トークルーム・メンバー情報を読み込んでいます...', 10)
				const preloadedRoomSnapshot = await setupMembers()
				if (cancelled) return
				perfMark('ルーム情報＋メンバー情報の取得（setupMemberSnapshots全体）')

				// setupMembers で取得済みのスナップショットがあれば再利用し、同じ文書への二重のリクエストを避ける（無ければ、自分で取得する）
				let roomSnapshot = preloadedRoomSnapshot
				if (!roomSnapshot) {
					if (isInitialLoadRef.current && !skippedRef.current) setLoadingStage('トークルーム情報を読み込んでいます...', 25)
					roomSnapshot = await hedged(() => getDoc(doc(db, 'KokoKengaku', talkId)))
					if (cancelled) return
				}

				// 【既存との違い】存在しないルームID：「見つかりません」を出して、OKのあと一覧へ戻る
				// （既存は、エラー文がアラートで出て、遷移しなかった）
				if (!roomSnapshot.exists()) {
					await onRoomNotFound()
					return
				}

				applyRoomHeader(roomSnapshot.data() as DocumentData, myUserId)

				// 入ったので、このルームの未読数を0にする
				updateDoc(doc(db, 'users_random', myUserId), {
					[`unreadCounts.${talkId}`]: 0,
				}).catch((err) => console.error('未読リセットエラー:', err))

				subscription.unsubscribe = onSnapshot(query(collection(db, 'KokoKengaku', talkId, 'talk'), orderBy('time', 'asc')), (messageSnapshot) => {
					handleMessageSnapshot(messageSnapshot, myUserId, isAlive).catch((error) => console.error('メッセージの表示エラー:', error))
				})
			} catch (error) {
				console.error('データ取得エラー:', error)
				if (!cancelled) await showError(error instanceof Error ? error.message : String(error))
			}
		})()

		return () => {
			cancelled = true
			if (subscription.unsubscribe) subscription.unsubscribe()
			if (imageBadgeRef.current) imageBadgeRef.current.hide() // 画面を離れたら、画像の通知は消す
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [start])

	/** グループのアイコンを変更したあと、画面上部のアイコンを新しい画像にする。 */
	const setRoomImageUrl = useCallback((url: string) => {
		setHeader((current) => (current ? { ...current, imageUrl: url, iconVersion: current.iconVersion + 1 } : current))
	}, [])

	/** 読み込み画面だけを閉じる（停止中のアカウントのとき）。 */
	const hideOverlayOnly = useCallback(() => setOverlayHidden(true), [])

	return {
		loadingText,
		loadingPercent,
		overlayHidden,
		contentVisible,
		showSkip,
		skipLoading,
		hideOverlayOnly,
		setRoomImageUrl,
		header,
		items,
		dividerBeforeId,
		messagesReady,
		talkAreaRef,
		/** 通知のタイトルに使うルーム名（②）。個人トークは、ルーム名なし。 */
		getNotifyRoomTitle: () => (roomIsGroupRef.current ? roomTitleRef.current : ''),
		/** ルームのメンバーID一覧（自分を含む）。メンバーの追加・削除（⑤）で更新する。 */
		roomMembersRef,
		/** 受信したメッセージの元データ（表示可否に関わらず全件）。返信先の調べ物に使う。 */
		messagesByIdRef,
		users,
		notFoundMessage: NOT_FOUND_MESSAGE,
	}
}
