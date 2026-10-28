import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../components/Avatar'
import { LoadingOverlay } from '../components/LoadingOverlay'
import { PageShell } from '../components/PageShell'
import { PushButton } from '../components/PushButton'
import { CreateTalkModal } from '../features/roomList/CreateTalkModal'
import { getDateGroupLabel, pickRoomByPartner, TALK_GROUP_ORDER } from '../features/roomList/roomUtils'
import { useRoomList, type UnreadState } from '../features/roomList/useRoomList'
import { ProfileModal, type ProfileTarget } from '../features/ProfileModal'
import { db, doc, getDoc, hedged, serverTimestamp, setDoc } from '../firebase'
import { runFirestoreDiagnostics } from '../lib/diag'
import { perfMark, perfNotifyReportAvailable } from '../lib/perf'
import { notifyPageLoadFinished, startPush } from '../lib/push'
import { createImageGroupTracker } from '../lib/statusBadge'
import { getUserCache, hasActivePrize, resetUserCache, setUserCache, toMillisOrNull, type UserCacheEntry } from '../lib/userCache'
import { useDialog } from '../ui/DialogProvider'
import { UiSwitchSection } from '../ui/UiSwitchSection'

// ★ ルーム一覧の画面（既存の app.html + appScript.js と同じHTML構造・同じ挙動）。
//   ・個人タブ：全ユーザーを並べる。自分（メモ）→ トークしたことのある相手（新しい順）→ まだの相手。
//   ・グループタブ：3人以上のルーム。「今日」「昨日」などの見出し付きで、新しい順。管理者は、グループ作成もできる。
//   ・各ルームに、未読数（新着: n件）。タブにも、未読があれば赤丸。
//   ・ユーザー情報の確認 → 通知の初期化（並行）→ 一覧の取得 → 読み込み画面を閉じる、の順序も、既存と同じ。

const TALK_TAB_STORAGE_KEY = 'kokoKengakuTalkTab'
type TalkTab = 'personal' | 'group'

function readSavedTab(): TalkTab {
	let saved = 'personal'
	try {
		saved = localStorage.getItem(TALK_TAB_STORAGE_KEY) || 'personal'
	} catch {
		/* 無視 */
	}
	return saved === 'group' ? 'group' : 'personal'
}

function unreadText(value: UnreadState | undefined): string {
	if (value === 'failed') return '取得失敗'
	if (typeof value === 'number') return `新着: ${value}件`
	return '取得中...'
}

type PersonalItem =
	| { kind: 'header'; key: string; label: string }
	| {
			kind: 'button'
			key: string
			userId: string
			displayName: string
			imageUrl: string
			isSelf: boolean
			roomId: string | null
	  }

export default function RoomListPage() {
	const { userId: authUserId, logout } = useAuth()
	const dialog = useDialog()
	const navigate = useNavigate()
	const myUserId = authUserId || ''

	// ---- 読み込み画面 ----
	const [loadingText, setLoadingText] = useState('システムの読み込みに時間がかかる場合があります｡')
	const [loadingPercent, setLoadingPercent] = useState(0)
	const [overlayHidden, setOverlayHidden] = useState(false)
	const [noActive, setNoActive] = useState(false)

	// 段階の文言と、進捗バー（percent を省くと、バーはそのまま）
	const setLoadingStage = useCallback((text: string, percent?: number) => {
		setLoadingText(text)
		if (typeof percent === 'number') setLoadingPercent(Math.max(0, Math.min(100, percent)))
	}, [])

	// ---- 自分 ----
	const [meIsAdmin, setMeIsAdmin] = useState(false)
	const [myName, setMyName] = useState('')
	const [myNameClass, setMyNameClass] = useState<'' | 'admin' | 'prize'>('')
	const [start, setStart] = useState<{ myUserId: string; meIsAdmin: boolean } | null>(null)
	const meIsAdminRef = useRef(false)

	// ---- アイコンの読み込み状況（読み込み画面を閉じた時点で、まだ読めていなければ、左上に通知を出す） ----
	const userIconTracker = useMemo(() => createImageGroupTracker('ユーザーのアイコン', 2, true), [])
	const roomIconTracker = useMemo(() => createImageGroupTracker('トークルームのアイコン', 3, true), [])
	useEffect(
		() => () => {
			userIconTracker.dispose()
			roomIconTracker.dispose()
		},
		[userIconTracker, roomIconTracker],
	)

	// ---- 画面の状態 ----
	const [tab, setTab] = useState<TalkTab>(readSavedTab)
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [shareOpen, setShareOpen] = useState(false)
	const [createOpen, setCreateOpen] = useState(false)
	const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null)
	const profileToken = useRef(0)
	const isCreatingPersonalTalk = useRef(false)

	useEffect(() => {
		// 既存の setTalkTab は、最初にも、選んだタブを保存する
		try {
			localStorage.setItem(TALK_TAB_STORAGE_KEY, tab)
		} catch {
			/* 保存できなくても問題なし */
		}
	}, [tab])

	// ---- 一覧のデータ ----
	const hideOverlayAndShowList = useCallback(() => {
		setOverlayHidden(true)
		perfMark('オーバーレイを閉じて一覧を表示')
		notifyPageLoadFinished() // この時点でOneSignalの初期化が未完了なら、「通知の受信を準備中…」を表示する
		userIconTracker.finish() // アイコンが読み込み中なら、「ユーザーのアイコンを読み込み中…(n/m)」を表示する
		roomIconTracker.finish() // 同様に「トークルームのアイコンを読み込み中…(n/m)」
		const id = authUserId || ''
		// 管理者にだけ、左上に「計測結果をみる」ボタンを1分間表示
		perfNotifyReportAvailable({
			isAdmin: meIsAdminRef.current,
			page: 'app.html（トーク一覧）',
			diagnostics: () => runFirestoreDiagnostics(id),
		})
	}, [authUserId, userIconTracker, roomIconTracker])

	const { rooms, users, unread, personalVersion, listReady, usersForCreate } = useRoomList({
		start,
		setLoadingStage,
		onInitialLoadDone: hideOverlayAndShowList,
		onError: (message) => void dialog.alert(message),
	})

	// ---- 自分のユーザー情報の確認（既存の onAuthStateChanged の中身） ----
	useEffect(() => {
		perfMark('DOMContentLoaded（DOM構築完了まで）')
		resetUserCache() // 既存は、ページを開くたびに、空のキャッシュから始まっていた
	}, [])

	useEffect(() => {
		if (!authUserId) return
		let cancelled = false
		void (async () => {
			try {
				setLoadingStage('ユーザー情報を確認しています...', 10)
				const userSnapshot = await hedged(() => getDoc(doc(db, 'users_random', authUserId)))
				const userData = userSnapshot.data()
				perfMark('自分のユーザー情報の取得（Firestore）')
				if (cancelled) return
				// 既存と同じ：ユーザー文書がなければ、ここでエラーになり、そのメッセージをダイアログに出す
				if (!userData) throw new TypeError("Cannot read properties of undefined (reading 'isActive')")

				if (userData.isActive) {
					setMyName(userData.name)
					meIsAdminRef.current = !!userData.isAdmin
					setMeIsAdmin(!!userData.isAdmin)
					if (userData.isAdmin) setMyNameClass('admin')
					else if (hasActivePrize({ prizeGrantedAt: toMillisOrNull(userData.prizeGrantedAt) })) setMyNameClass('prize')

					setUserCache(authUserId, {
						name: userData.name,
						isAdmin: userData.isAdmin,
						imageUrl: userData.imageUrl || '',
						profileText: userData.profileText || '',
						prizeGrantedAt: userData.prizeGrantedAt,
					})

					// プッシュ通知の初期化（失敗してもトーク一覧の表示には影響させない）
					startPush(authUserId)

					setStart({ myUserId: authUserId, meIsAdmin: !!userData.isAdmin })
				} else {
					setOverlayHidden(true)
					setNoActive(true)
				}
			} catch (error) {
				console.log(error)
				if (!cancelled) await dialog.alert(error instanceof Error ? error.message : String(error))
			}
		})()
		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [authUserId])

	// ---- 個人タブの並び（既存の renderPersonalList。変化があったときだけ作り直す） ----
	const personalItems = useMemo<PersonalItem[]>(() => {
		if (!start || personalVersion === 0) return [] // 最初のデータが届くまでは、何も並べない
		const getName = (id: string) => (getUserCache(id) || {}).name || id
		const roomByPartner = pickRoomByPartner(rooms)

		const knownIds = new Set(users.map((u) => u.userId))
		const people = users.map((u) => ({ userId: u.userId, name: u.name }))
		// 一覧に居ない相手（停止中など）でもルームがあれば表示できるようにする
		Object.keys(roomByPartner).forEach((partnerId) => {
			if (!knownIds.has(partnerId)) people.push({ userId: partnerId, name: getName(partnerId) })
		})
		if (!knownIds.has(myUserId) && !people.some((u) => u.userId === myUserId)) {
			people.unshift({ userId: myUserId, name: getName(myUserId) })
		}

		const buttonOf = (u: { userId: string; name: string }, roomId: string | null, isSelf: boolean): PersonalItem => {
			const cached: UserCacheEntry = getUserCache(u.userId) || {}
			return {
				kind: 'button',
				key: `u-${u.userId}`,
				userId: u.userId,
				displayName: cached.name || u.name || u.userId,
				imageUrl: cached.imageUrl || '',
				isSelf,
				roomId,
			}
		}

		const items: PersonalItem[] = []
		// 1) 自分だけのトーク
		const me = people.find((u) => u.userId === myUserId)
		if (me) items.push(buttonOf(me, roomByPartner[myUserId] ? roomByPartner[myUserId].roomId : null, true))

		// 2) トークしたことのある相手（更新が新しい順、「今日」「昨日」の見出し付き）
		const withRoom = people
			.filter((u) => u.userId !== myUserId && roomByPartner[u.userId])
			.sort((a, b) => roomByPartner[b.userId].lastUpdatedAtMs - roomByPartner[a.userId].lastUpdatedAtMs)
		let currentLabel: string | null = null
		withRoom.forEach((u) => {
			const room = roomByPartner[u.userId]
			const label = getDateGroupLabel(room.lastUpdatedAtMs)
			if (label !== currentLabel) {
				items.push({ kind: 'header', key: `h-${label}`, label })
				currentLabel = label
			}
			items.push(buttonOf(u, room.roomId, false))
		})

		// 3) まだトークしていない相手
		const withoutRoom = people.filter((u) => u.userId !== myUserId && !roomByPartner[u.userId])
		if (withoutRoom.length > 0) {
			items.push({ kind: 'header', key: 'h-none', label: 'まだトークしていない人' })
			withoutRoom.forEach((u) => items.push(buttonOf(u, null, false)))
		}
		return items
		// 個人タブは、変化があったときだけ作り直す（personalVersion が変わったとき）
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [personalVersion, start])

	// ---- グループタブの並び（既存の regroupTalkButtons） ----
	const groupItems = useMemo(() => {
		const buttons = Object.keys(rooms)
			.filter((roomId) => rooms[roomId].category === 'group')
			.map((roomId) => ({ roomId, ...rooms[roomId] }))
		const labelOf = (ms: number) => getDateGroupLabel(ms)
		// グループの並び順を優先し、グループ内は更新日時が新しい順にする
		buttons.sort((a, b) => {
			const ga = TALK_GROUP_ORDER.indexOf(labelOf(a.groupUpdatedAtMs) as (typeof TALK_GROUP_ORDER)[number])
			const gb = TALK_GROUP_ORDER.indexOf(labelOf(b.groupUpdatedAtMs) as (typeof TALK_GROUP_ORDER)[number])
			if (ga !== gb) return ga - gb
			return b.groupUpdatedAtMs - a.groupUpdatedAtMs
		})
		const items: Array<{ kind: 'header'; label: string } | { kind: 'button'; room: (typeof buttons)[number] }> = []
		let current: string | null = null
		buttons.forEach((room) => {
			const label = labelOf(room.groupUpdatedAtMs)
			if (label !== current) {
				items.push({ kind: 'header', label })
				current = label
			}
			items.push({ kind: 'button', room })
		})
		return items
	}, [rooms])

	// ---- タブの赤丸（未読があれば） ----
	let hasPersonalUnread = false
	let hasGroupUnread = false
	Object.keys(unread).forEach((roomId) => {
		const meta = rooms[roomId]
		const count = unread[roomId]
		if (!meta || !(typeof count === 'number' && count > 0)) return
		if (meta.category === 'group') hasGroupUnread = true
		else hasPersonalUnread = true
	})

	// ---- 操作 ----
	const openTalk = (roomId: string) => navigate(`/talk/${encodeURIComponent(roomId)}`)

	// まだトークしていない相手を押したとき：確認してから新しい個人トークを作る
	const startPersonalTalk = async (targetUserId: string, isSelf: boolean) => {
		if (isCreatingPersonalTalk.current) return
		const displayName = (getUserCache(targetUserId) || {}).name || targetUserId
		const message = isSelf ? '自分だけのトークを開始しますか？' : `"${displayName}"とのトークを開始しますか？`
		const ok = await dialog.confirm(message, { okText: '開始する' })
		if (!ok) return

		isCreatingPersonalTalk.current = true
		try {
			// ルームIDは2人のIDから一意に決める（同時に押されても同じルームになり、二重作成を防げる）
			const roomId = isSelf ? `dm_${myUserId}` : `dm_${[myUserId, targetUserId].sort().join('__')}`
			const members = isSelf ? [myUserId] : [myUserId, targetUserId]
			const myDisplay = (getUserCache(myUserId) || {}).name || myUserId
			await setDoc(doc(db, 'KokoKengaku', roomId), {
				// 個人トークの表示名は相手の名前から動的に決めるので、title は管理者画面などでの予備
				title: isSelf ? `${myDisplay}（自分）` : `${myDisplay}と${displayName}`,
				members,
				lastUpdatedAt: serverTimestamp(),
			})
			openTalk(roomId)
		} catch (error) {
			console.error('個人トークの作成エラー:', error)
			isCreatingPersonalTalk.current = false
			await dialog.alert('トークを開始できませんでした。\n' + (error instanceof Error ? error.message : String(error)))
		}
	}

	const handleLogout = async () => {
		const isConfirmed = await dialog.confirm('ログアウトしますか？')
		if (!isConfirmed) return
		try {
			await logout() // この端末への通知紐づけを解除してから、ログアウト
			console.log('ログアウトしました！')
			// ※ 既存は、ログアウトの完了後に「ログアウトしました。」と出すが、同時にログイン画面へ移るため、実際には見えない
		} catch (error) {
			console.error('ログアウトエラー:', error)
			await dialog.alert('ログアウトに失敗しました。')
		}
	}

	const openProfile = (userId: string, startEditMode: boolean) => {
		profileToken.current += 1
		setProfileTarget({ userId, startEditMode, token: profileToken.current })
	}

	const closeDrawer = () => setDrawerOpen(false)

	return (
		<PageShell name="app">
			<LoadingOverlay text={loadingText} percent={loadingPercent} hidden={overlayHidden} watchStall />
			<div id="no-active-overlay" className={noActive ? undefined : 'hidden'}>
				<p>アカウントが停止されています</p>
			</div>

			<div id="share-modal" className={'modal-overlay' + (shareOpen ? '' : ' hidden')}>
				<div className="modal-content">
					<div className="modal-header">
						<p className="title">シェア</p>
						<span id="share-modal-close" className="close-button" onClick={() => setShareOpen(false)}>
							&times;
						</span>
					</div>
					<div className="modal-scroll-body">
						<img src={`${import.meta.env.BASE_URL}qrcode.png`} alt="QR Code" />
					</div>
				</div>
			</div>

			<ProfileModal
				target={profileTarget}
				myUserId={myUserId}
				meIsAdmin={meIsAdmin}
				onClose={() => setProfileTarget(null)}
				onSaved={(savedUserId, updated) => {
					// 自分自身のプロフィールを編集した場合のみ、ドロワーの表示名も更新する
					if (savedUserId === myUserId) setMyName(updated.name || '')
				}}
			/>

			<CreateTalkModal open={createOpen} onClose={() => setCreateOpen(false)} usersCache={usersForCreate} />

			<div id="drawerOverlay" className={'drawer-overlay' + (drawerOpen ? ' is-open' : '')} onClick={closeDrawer}></div>
			<div id="accountSettingsDrawer" className={'drawer' + (drawerOpen ? ' is-open' : '')}>
				<div className="drawer-header">
					<p>アカウント設定</p>
					<span id="drawerCloseButton" className="drawer-close-button" onClick={closeDrawer}>
						&times;
					</span>
				</div>
				<div className="drawer-content">
					<div className="drawer-section">
						<p className="title">現在のユーザー</p>
						<p>
							ID: <strong id="drawerUserId">{myUserId || '取得中...'}</strong>
							<span></span>
						</p>
						<p>
							ユーザーネーム: <strong id="drawerUsername" className={myNameClass || undefined}>{myName || '取得中...'}</strong>
						</p>

						<button
							id="drawer-edit-profile-button"
							className="normal-button"
							style={{ marginBottom: '1rem' }}
							onClick={() => {
								closeDrawer()
								openProfile(myUserId, false) // 自分のプロフィールを表示するだけ（編集モードにはしない）
							}}
						>
							プロフィールをみる
						</button>
						<PushButton />
						<button id="logout-button" className="logout-button normal-button" onClick={() => void handleLogout()}>
							ログアウト
						</button>
					</div>
					<UiSwitchSection />
				</div>
			</div>

			<header id="app-header">
				<div id="title-area">
					<p id="header-title">
						螺鈿紫檀五弦琵琶と<span className="rainbow">不愉快な仲間たち</span>
					</p>
					<button id="share-modal-btn" onClick={() => setShareOpen(true)}>
						シェア
					</button>
				</div>

				<div id="user-data">
					<button id="setting-button" onClick={() => setDrawerOpen(true)}>
						アカウント情報
					</button>
				</div>
			</header>

			<main>
				<div id="selection-container" className={overlayHidden ? undefined : 'hidden'}>
					<p id="selection-title">My Talk</p>

					<a
						id="problem-posting-banner"
						href="https://appsforschool.github.io/ProblemPosting/app.html"
						target="_blank"
						rel="noopener noreferrer"
					>
						問題投稿サイトはこちらから →
					</a>

					{/* 個人 / グループ 切替UI（iOS風のセグメントコントロール） */}
					<div id="talk-tab-control" className="segmented-control" role="tablist" data-active={tab}>
						<span className="segmented-thumb"></span>
						<button type="button" className={'segmented-item' + (tab === 'personal' ? ' active' : '')} data-tab="personal" role="tab" onClick={() => setTab('personal')}>
							個人<span className={'tab-badge' + (hasPersonalUnread ? '' : ' hidden')}></span>
						</button>
						<button type="button" className={'segmented-item' + (tab === 'group' ? ' active' : '')} data-tab="group" role="tab" onClick={() => setTab('group')}>
							グループ<span className={'tab-badge' + (hasGroupUnread ? '' : ' hidden')}></span>
						</button>
					</div>

					<p id="talk-button-loading" className={listReady ? 'hidden' : undefined}>
						loading...
					</p>

					{/* 個人トーク（自分のみ・1対1）。全ユーザーを表示する */}
					<div id="personal-button-area" className={'talk-list-area' + (tab === 'personal' ? '' : ' hidden')}>
						{personalItems.map((item) =>
							item.kind === 'header' ? (
								<p key={item.key} className="talk-group-header">
									{item.label}
								</p>
							) : (
								<div
									key={item.key}
									className={'talk-button' + (item.roomId ? '' : ' no-room')}
									id={item.roomId ? `room-${item.roomId}` : undefined}
									onClick={() => (item.roomId ? openTalk(item.roomId) : void startPersonalTalk(item.userId, item.isSelf))}
								>
									<Avatar name={item.displayName} imageUrl={item.imageUrl} tracker={userIconTracker} />
									<p className="title">{item.isSelf ? `${item.displayName}（自分）` : item.displayName}</p>
									<p
										className={'new-message' + (item.roomId && unread[item.roomId] === 0 ? ' no-message' : '')}
										id={item.roomId ? `unread-${item.roomId}` : undefined}
									>
										{item.roomId ? unreadText(unread[item.roomId]) : 'トークを始める'}
									</p>
								</div>
							),
						)}
					</div>

					{/* グループトーク（3人以上） */}
					<div id="group-area" className={'talk-list-area' + (tab === 'group' ? '' : ' hidden')}>
						<button
							id="open-create-talk-modal-button"
							className={'normal-button' + (meIsAdmin ? '' : ' hidden')}
							onClick={() => setCreateOpen(true)}
						>
							＋ 新しいグループを作成
						</button>
						<div id="talk-button-area" className="selection">
							{groupItems.map((item) =>
								item.kind === 'header' ? (
									<p key={`gh-${item.label}`} className="talk-group-header">
										{item.label}
									</p>
								) : (
									<div key={item.room.roomId} className="talk-button" id={`room-${item.room.roomId}`} onClick={() => openTalk(item.room.roomId)}>
										<Avatar
											key={`${item.room.title}|${item.room.imageUrl}`}
											name={item.room.title}
											imageUrl={item.room.imageUrl}
											tracker={roomIconTracker}
										/>
										<p className="title">{item.room.title}</p>
										<p
											className={'new-message' + (unread[item.room.roomId] === 0 ? ' no-message' : '')}
											id={`unread-${item.room.roomId}`}
										>
											{unreadText(unread[item.room.roomId])}
										</p>
									</div>
								),
							)}
							{listReady && groupItems.length === 0 && (
								<p id="group-empty-text" className="talk-list-empty">
									グループトークはまだありません。
								</p>
							)}
						</div>
					</div>
				</div>
			</main>
		</PageShell>
	)
}
