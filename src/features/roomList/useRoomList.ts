import { useEffect, useRef, useState } from 'react'
import {
	collection,
	db,
	doc,
	getCountFromServer,
	getDocs,
	hedged,
	onSnapshot,
	query,
	where,
} from '../../firebase'
import { perfMark, perfNote, perfSample, perfStart } from '../../lib/perf'
import { setUserCache, toMillisOrNull } from '../../lib/userCache'
import {
	getRoomCategory,
	isRoomVisibleForMe,
	pickRoomByPartner,
	type RoomMeta,
	type UserListItem,
} from './roomUtils'

// ★ ルーム一覧のデータ取得（既存の appScript.js の getAllTalkData / loadAllUsers / updateSingleRoomUnread と同じ流れ）。
//   ・「自分の lastChecked」「全ユーザー一覧」「ルーム一覧」は、お互いに依存しないので、同時に取得を始める。
//     描画の直前で、必要なデータが揃うのだけ待つ。lastChecked は、自分のユーザー文書の onSnapshot の最初の通知を、そのまま使う。
//   ・ルーム一覧は onSnapshot で、変化（追加・修正・削除）があった差分だけを処理する。
//   ・未読数は、ルームごとに、サーバー側の件数集計 count() で数える（失敗したら、全件取得にフォールバック）。
//   ・初回の表示では、各ルームの未読数の計算が終わるまで、読み込み画面を出したままにする。

export type UnreadState = number | 'failed'

interface Args {
	/** ユーザー情報の確認が終わるまでは null。入ったら、取得を始める。 */
	start: { myUserId: string; meIsAdmin: boolean } | null
	setLoadingStage: (text: string, percent?: number) => void
	/** 初回の表示が終わったとき（読み込み画面を閉じるとき）に呼ぶ。 */
	onInitialLoadDone: () => void
	onError: (message: string) => void
}

export interface RoomListData {
	rooms: Record<string, RoomMeta>
	users: UserListItem[]
	unread: Record<string, UnreadState>
	/** 個人タブを作り直した回数（既存は、変化があったときだけ個人タブを作り直す。表示の名前・アイコンは、そのときのキャッシュ）。 */
	personalVersion: number
	/** 初回の表示が終わったか（「loading...」を消して、一覧を出す）。 */
	listReady: boolean
	/** グループ作成のメンバー選択に使い回す全ユーザー（取得できていなければ null）。 */
	usersForCreate: UserListItem[] | null
}

export function useRoomList({ start, setLoadingStage, onInitialLoadDone, onError }: Args): RoomListData {
	const [rooms, setRooms] = useState<Record<string, RoomMeta>>({})
	const [users, setUsers] = useState<UserListItem[]>([])
	const [unread, setUnread] = useState<Record<string, UnreadState>>({})
	const [personalVersion, setPersonalVersion] = useState(0)
	const [listReady, setListReady] = useState(false)
	const [usersForCreate, setUsersForCreate] = useState<UserListItem[] | null>(null)

	// コールバックは最新のものを使う（購読の張り直しはしない）
	const stageRef = useRef(setLoadingStage)
	const doneRef = useRef(onInitialLoadDone)
	const errorRef = useRef(onError)
	stageRef.current = setLoadingStage
	doneRef.current = onInitialLoadDone
	errorRef.current = onError

	const startKey = start ? `${start.myUserId}|${start.meIsAdmin}` : ''

	useEffect(() => {
		if (!start) return
		const { myUserId, meIsAdmin } = start
		let disposed = false

		// ---- 画面に出す内容の、手元のコピー（既存の roomMetaMap / unreadCountCache など） ----
		const roomMetaMap: Record<string, RoomMeta> = {}
		const unreadCountCache: Record<string, number> = {}
		const renderedRoomIds = new Set<string>()
		let currentUserLastCheckedMap: Record<string, { toDate: () => Date }> = {}
		let allUsersList: UserListItem[] = []
		let isInitialTalkListLoad = true

		const pushRooms = () => setRooms({ ...roomMetaMap })

		/** 個人タブに、この部屋の表示（#unread-…）があるか。相手ごとに、いちばん新しい1つだけが表示される。 */
		const hasUnreadElement = (roomId: string): boolean => {
			const meta = roomMetaMap[roomId]
			if (!meta) return false
			if (meta.category === 'group') return true
			const picked = pickRoomByPartner(roomMetaMap)[meta.partnerId]
			return !!picked && picked.roomId === roomId
		}

		// ---- 特定の1部屋だけ未読数を数え直す（既存の updateSingleRoomUnread） ----
		const updateSingleRoomUnread = async (roomId: string, lastCheckedTimestamp: { toDate: () => Date } | undefined): Promise<void> => {
			if (!hasUnreadElement(roomId)) return

			const perfStartedAt = performance.now()
			const lastCheckedTime = lastCheckedTimestamp ? lastCheckedTimestamp.toDate() : new Date(0)
			const baseQuery = query(collection(db, 'KokoKengaku', roomId, 'talk'), where('time', '>', lastCheckedTime))

			let unreadCount: number
			try {
				// 該当メッセージを全部ダウンロードしてから数えるのではなく、サーバー側で「件数だけ」を数えてもらう
				const unreadSnapshot = await getCountFromServer(baseQuery)
				unreadCount = unreadSnapshot.data().count
				perfSample('未読数のcountクエリ（1ルームあたり）', performance.now() - perfStartedAt)
			} catch (countError) {
				// 集計クエリが使えない／失敗する場合でも未読数が出せるように、「全件取得して件数を数える」方式にフォールバックする
				console.error(`未読数の集計クエリに失敗 [Room: ${roomId}]。通常のクエリにフォールバックします:`, countError)
				try {
					const fallbackSnapshot = await getDocs(baseQuery)
					unreadCount = fallbackSnapshot.size
					perfSample('未読数のフォールバック全件取得（1ルームあたり）', performance.now() - perfStartedAt)
				} catch (fallbackError) {
					console.error(`未読数の取得に失敗 [Room: ${roomId}]:`, fallbackError)
					if (!disposed) setUnread((prev) => ({ ...prev, [roomId]: 'failed' }))
					return
				}
			}

			unreadCountCache[roomId] = unreadCount
			if (!disposed) setUnread((prev) => ({ ...prev, [roomId]: unreadCount }))
		}

		// ---- 個人タブ用に全ユーザーを読み込む（名前・アイコンはユーザーキャッシュにも反映する） ----
		const loadAllUsers = async (): Promise<void> => {
			try {
				const snapshot = await hedged(() => getDocs(collection(db, 'users_random')))
				allUsersList = snapshot.docs
					.map((d) => {
						const data = d.data() || {}
						setUserCache(d.id, {
							name: data.name || d.id,
							isAdmin: !!data.isAdmin,
							imageUrl: data.imageUrl || '',
							prizeGrantedAt: data.prizeGrantedAt,
						})
						return {
							userId: d.id,
							name: (data.name as string) || d.id,
							isActive: data.isActive !== false,
							no: typeof data.no === 'number' ? (data.no as number) : Infinity,
						}
					})
					.filter((u) => u.isActive)
					.sort((a, b) => a.no - b.no)

				// グループ作成モーダルのメンバー選択にも使い回す（自分も選択肢に含める。自動では追加しない）
				if (!disposed) {
					setUsers(allUsersList.slice())
					setUsersForCreate(allUsersList.slice())
				}
			} catch (error) {
				console.error('ユーザー一覧の取得エラー:', error)
			}
		}

		// ---- 取得を始める（既存の getAllTalkData） ----
		if (isInitialTalkListLoad) stageRef.current('ユーザー情報・ルーム情報を読み込んでいます...', 25)

		let resolveLastCheckedReady: () => void = () => undefined
		const lastCheckedReady = new Promise<void>((resolve) => {
			resolveLastCheckedReady = resolve
		})
		const endLastCheckedPerf = perfStart('lastChecked（自分のユーザー文書の初回受信）')

		const userDocUnsubscribe = onSnapshot(
			doc(db, 'users_random', myUserId),
			(userDoc) => {
				const userData = userDoc.data() || {}
				currentUserLastCheckedMap = userData.lastChecked || {}
				endLastCheckedPerf()
				resolveLastCheckedReady()

				// 自分の既読状態が更新されたら、すでに表示中の全ルームの未読数を再計算する
				renderedRoomIds.forEach((roomId) => {
					void updateSingleRoomUnread(roomId, currentUserLastCheckedMap[roomId])
				})
			},
			(error) => {
				console.error('最終確認情報の監視エラー:', error)
				endLastCheckedPerf()
				resolveLastCheckedReady() // 失敗しても一覧の表示は止めない
			},
		)

		const endUsersPerf = perfStart('全ユーザー一覧の取得（loadAllUsers）')
		const usersReady = loadAllUsers().then(endUsersPerf, endUsersPerf)
		const dataReady = Promise.all([lastCheckedReady, usersReady])

		if (isInitialTalkListLoad) stageRef.current('トークルーム情報を読み込んでいます...', 35)

		let talkListenerUnsubscribe: (() => void) | null = null
		try {
			let roomsQuery = query(collection(db, 'KokoKengaku'))
			if (!meIsAdmin) {
				// 一般ユーザーの場合は、自分がメンバーに含まれるルームのみに絞り込む
				roomsQuery = query(collection(db, 'KokoKengaku'), where('members', 'array-contains', myUserId))
			}

			talkListenerUnsubscribe = onSnapshot(
				roomsQuery,
				async (talkSnapshot) => {
					// 永続キャッシュが空の初回は「キャッシュ由来の空」が先に届くことがあるので、サーバーの結果を待つ
					if (isInitialTalkListLoad && talkSnapshot.metadata.fromCache && talkSnapshot.empty) return

					// このスナップショットが「初回のトーク一覧表示」かどうかを固定しておく
					const isThisInitialLoad = isInitialTalkListLoad
					if (isThisInitialLoad) {
						isInitialTalkListLoad = false
						perfMark('ルーム一覧の初回データ受信（onSnapshot）')
					}

					// 描画に必要な lastChecked と全ユーザー一覧が揃うのを待つ（並行して取得済みなので、通常はここで待たない）
					await dataReady
					if (disposed) return
					if (isThisInitialLoad) perfMark('lastChecked・全ユーザー一覧の到着待ち（ここが長ければ通信が詰まっている）')

					const changes = talkSnapshot.docChanges()
					const totalChanges = changes.length
					let processedChanges = 0
					let personalDirty = false // 個人タブを作り直す必要があるか
					const roomsToRefreshUnread: string[] = [] // 未読数を数え直すルーム
					// 初回表示時のみ、各ルームの未読数計算が完了するのを待ってからオーバーレイを閉じる
					const unreadCountPromises: Promise<void>[] = []

					// ルームを一覧から外す共通処理
					const removeRoomFromLists = (roomId: string) => {
						const prevMeta = roomMetaMap[roomId]
						if (prevMeta && prevMeta.category !== 'group') personalDirty = true
						delete roomMetaMap[roomId]
						delete unreadCountCache[roomId]
						renderedRoomIds.delete(roomId)
						setUnread((prev) => {
							if (!(roomId in prev)) return prev
							const next = { ...prev }
							delete next[roomId]
							return next
						})
					}

					// 変化（追加・修正・削除）があった差分だけをループ処理する
					changes.forEach((change) => {
						processedChanges++
						if (isThisInitialLoad && totalChanges > 0) {
							const percent = Math.round((processedChanges / totalChanges) * 100)
							// このステージは進捗バー全体の35%〜75%の区間にマッピングする
							stageRef.current(`トーク一覧を読み込んでいます (${percent}%)`, 35 + (percent / 100) * 40)
						}

						const talkDoc = change.doc
						const roomId = talkDoc.id
						const roomData = talkDoc.data()

						// 削除された、または(メンバー変更などで)自分に見せないルームになった場合
						if (change.type === 'removed' || !isRoomVisibleForMe(roomData.members, myUserId, meIsAdmin)) {
							removeRoomFromLists(roomId)
							return
						}

						const members: string[] = roomData.members || []
						const category = getRoomCategory(members)
						const prevMeta = roomMetaMap[roomId]

						const lastUpdatedMs = toMillisOrNull(roomData.lastUpdatedAt) || (talkDoc.metadata.hasPendingWrites ? Date.now() : 0)
						const rawTs = roomData.lastUpdatedAt as { toMillis?: () => number } | null | undefined
						roomMetaMap[roomId] = {
							category,
							partnerId: category === 'group' ? '' : members.find((id) => id !== myUserId) || myUserId,
							title: roomData.title || '',
							imageUrl: roomData.imageUrl || '',
							lastUpdatedAtMs: lastUpdatedMs,
							groupUpdatedAtMs: rawTs && typeof rawTs.toMillis === 'function' ? rawTs.toMillis() : 0,
						}
						renderedRoomIds.add(roomId)

						if (category === 'group') {
							// 個人 → グループに変わった場合は、個人タブ側から外す
							if (prevMeta && prevMeta.category !== 'group') personalDirty = true
						} else {
							// グループ → 個人に変わった場合は、グループ側から外す（表示は、種類から決まる）
							personalDirty = true
						}

						roomsToRefreshUnread.push(roomId)
					})

					// 個人タブは、変化があったときに作り直す（未読数はキャッシュから復元される）
					if (personalDirty || isThisInitialLoad) setPersonalVersion((v) => v + 1)
					pushRooms()

					if (isThisInitialLoad) {
						perfMark('ルーム一覧・個人タブのDOM構築')
						perfNote(`ルーム数: ${totalChanges}件 / 全ユーザー数: ${allUsersList.length}人 / 管理者: ${meIsAdmin ? 'はい' : 'いいえ'}`)
					}

					// 未読数をピンポイントで数え直して更新する
					roomsToRefreshUnread.forEach((roomId) => {
						const unreadPromise = updateSingleRoomUnread(roomId, currentUserLastCheckedMap[roomId])
						if (isThisInitialLoad) unreadCountPromises.push(unreadPromise)
					})

					// 初回のローディング非表示処理
					setListReady(true)

					// 初回表示時のみ、各ルームの未読数計算が終わるまでオーバーレイを出したままにする
					if (isThisInitialLoad) {
						if (unreadCountPromises.length > 0) {
							// 「止まっているのか進んでいるのか分からない」を防ぐため、1件終わるごとに件数と進捗バーを更新する
							const totalUnreadChecks = unreadCountPromises.length
							let completedUnreadChecks = 0
							stageRef.current(`未読件数を計算しています (0/${totalUnreadChecks})`, 75)

							await Promise.all(
								unreadCountPromises.map((promise) =>
									promise
										.catch((error: unknown) => {
											console.error('未読数計算の待機中にエラー:', error)
										})
										.then(() => {
											completedUnreadChecks++
											const percent = 75 + (completedUnreadChecks / totalUnreadChecks) * 25
											stageRef.current(`未読件数を計算しています (${completedUnreadChecks}/${totalUnreadChecks})`, percent)
										}),
								),
							)
						}
						if (unreadCountPromises.length > 0) perfMark(`未読数の計算完了（${unreadCountPromises.length}ルーム分）`)
						if (!disposed) doneRef.current()
					}
				},
				(error) => {
					console.error('リアルタイムリスナーエラー:', error)
				},
			)
		} catch (error) {
			console.error('データ取得エラー:', error)
			errorRef.current(error instanceof Error ? error.message : String(error))
			// エラー時にオーバーレイが出っぱなしにならないよう、念のため閉じておく
			doneRef.current()
		}

		return () => {
			disposed = true
			userDocUnsubscribe()
			if (talkListenerUnsubscribe) talkListenerUnsubscribe()
		}
		// start の中身が変わったときだけ、取得し直す
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [startKey])

	return { rooms, users, unread, personalVersion, listReady, usersForCreate }
}
