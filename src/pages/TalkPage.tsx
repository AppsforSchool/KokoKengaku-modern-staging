import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../components/Avatar'
import { LoadingOverlay } from '../components/LoadingOverlay'
import { PageShell } from '../components/PageShell'
import { PushButton } from '../components/PushButton'
import { clearMessageDraft, loadMessageDraft, saveMessageDraft } from '../features/talk/draft'
import { EditMessageModal, type EditTarget } from '../features/talk/EditMessageModal'
import { ForwardModal, type ForwardTarget } from '../features/talk/ForwardModal'
import { ImageSendModal } from '../features/talk/ImageSendModal'
import { PollCreateModal } from '../features/talk/PollCreateModal'
import { PollVotersModal, type PollVotersTarget } from '../features/talk/PollVotersModal'
import { MessageItem } from '../features/talk/MessageItem'
import { ReadByModal, type ReadByTarget } from '../features/talk/ReadByModal'
import { editMessage, fetchMessageDatas, forwardMessagesToRoom, hideMessage, hideMessages, makeForwardItem } from '../features/talk/messageActions'
import type { MessageView } from '../features/talk/types'
import { notifyPollAnswer, notifyRoom, sendImageMessage, sendPollMessage, sendTextMessage, votePoll } from '../features/talk/sendMessage'
import { useTalkRoom, type TalkRoomStart } from '../features/talk/useTalkRoom'
import { ProfileModal, type ProfileTarget } from '../features/ProfileModal'
import { db, doc, getDoc, hedged } from '../firebase'
import { perfMark } from '../lib/perf'
import { startPush } from '../lib/push'
import { createImageGroupTracker } from '../lib/statusBadge'
import { hasActivePrize, resetUserCache, setUserCache, toMillisOrNull } from '../lib/userCache'
import { useDialog } from '../ui/DialogProvider'
import { UiSwitchSection } from '../ui/UiSwitchSection'

// ★ トーク画面（既存の talk.html + talkScript.js と同じHTML構造・同じ挙動）。
//   いまは「①表示と既読」「②送信（本文・返信・画像・下書き・通知）」「③アンケート（作成・投票・回答者の一覧・通知）」「④編集・削除・転送・選択」まで。次の機能は、あとの段階で足す（HTMLの場所は、先に作ってある）。
//     ⑤ メンバー管理・グループのアイコン変更
//   ・ユーザー情報の確認 → 通知の初期化（並行）→ ルーム・メンバー情報 → メッセージ → 画像の読み込み待ち → 読み込み画面を閉じる、の順序は、既存と同じ。
//   ・存在しないルームID：「指定されたトークルームは見つかりませんでした。」→ OKで一覧（#/）へ（既存からの、唯一の意図した挙動の変更）。

const PROBLEM_POSTING_TALK_ID = '1problemposting'
const HIGHLIGHT_MS = 1400

export default function TalkPage({ talkId }: { talkId: string }) {
	const { userId: authUserId, logout } = useAuth()
	const dialog = useDialog()
	const navigate = useNavigate()
	const myUserId = authUserId || ''

	// ---- 自分 ----
	const [meIsAdmin, setMeIsAdmin] = useState(false)
	const [myName, setMyName] = useState('')
	const [myNameClass, setMyNameClass] = useState<'' | 'admin' | 'prize'>('')
	const [noActive, setNoActive] = useState(false)
	const [start, setStart] = useState<TalkRoomStart | null>(null)

	// ---- トークルームのアイコン（ヘッダー）の読み込み状況。読み込み画面を閉じた時点で、まだ読めていなければ、左上に通知を出す ----
	const roomIconTracker = useMemo(() => createImageGroupTracker('トークルームのアイコン', 2, false), [])
	useEffect(() => () => roomIconTracker.dispose(), [roomIconTracker])

	// ---- 画面の状態 ----
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [shareOpen, setShareOpen] = useState(false)
	const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null)
	const profileToken = useRef(0)
	const [readByTarget, setReadByTarget] = useState<ReadByTarget | null>(null)
	const readByToken = useRef(0)
	const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null) // 返信先
	const replyToIdRef = useRef<string | null>(null) // 送信の処理が「いま」の返信先を読むための控え（既存の replyToId）
	const [imageModalOpen, setImageModalOpen] = useState(false)
	const [pollModalOpen, setPollModalOpen] = useState(false)
	const [pollVotersTarget, setPollVotersTarget] = useState<PollVotersTarget | null>(null)
	const pollVotersToken = useRef(0)
	const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
	const editToken = useRef(0)
	const [forwardTarget, setForwardTarget] = useState<ForwardTarget | null>(null)
	const forwardToken = useRef(0)
	const [selectionMode, setSelectionMode] = useState(false) // 一括選択モード
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set()) // 選択中のメッセージID（画面が再描画されても保持する）
	const [bulkBusy, setBulkBusy] = useState(false) // まとめて削除の実行中
	const [messageText, setMessageText] = useState('') // 入力中のメッセージ
	const [sending, setSending] = useState(false)
	const messageInputRef = useRef<HTMLTextAreaElement>(null)
	const myNameRef = useRef('') // 通知の送信者名（既存は、ドロワーの表示名を読んでいた）
	const [showBackButton, setShowBackButton] = useState(false)
	const scrollBeforeJump = useRef<number | null>(null) // ジャンプ前のスクロール位置

	const room = useTalkRoom({
		talkId,
		start,
		roomIconTracker,
		showError: (message) => dialog.alert(message),
		onRoomNotFound: async () => {
			await dialog.alert('指定されたトークルームは見つかりませんでした。')
			navigate('/', { replace: true })
		},
	})
	const { hideOverlayOnly, talkAreaRef } = room
	useEffect(() => {
		myNameRef.current = myName
	}, [myName])

	// ルームごとの入力中メッセージの下書きを復元する
	useEffect(() => {
		if (!start) return
		const savedDraft = loadMessageDraft(talkId)
		if (savedDraft) setMessageText(savedDraft)
	}, [start, talkId])

	// ---- 画面に入ったとき ----
	useEffect(() => {
		perfMark('DOMContentLoaded（DOM構築完了まで）')
		resetUserCache() // 既存は、ページを開くたびに、空のキャッシュから始まっていた
	}, [])

	// スマホでヘッダー分の高さを避けて #head-area を固定表示するため、ヘッダーの実測高さを CSS 変数 --header-height に反映する
	useEffect(() => {
		const header = document.getElementById('app-header')
		const update = () => {
			if (header) document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px')
		}
		update()
		window.addEventListener('resize', update)
		let observer: ResizeObserver | null = null
		if (header && window.ResizeObserver) {
			observer = new ResizeObserver(update)
			observer.observe(header)
		}
		return () => {
			window.removeEventListener('resize', update)
			if (observer) observer.disconnect()
			document.documentElement.style.removeProperty('--header-height')
		}
	}, [])

	// ---- 自分のユーザー情報の確認（既存の onAuthStateChanged の中身） ----
	useEffect(() => {
		if (!authUserId) return
		let cancelled = false
		void (async () => {
			try {
				const userSnapshot = await hedged(() => getDoc(doc(db, 'users_random', authUserId)))
				const userData = userSnapshot.data()
				perfMark('自分のユーザー情報の取得（Firestore）')
				if (cancelled) return
				// 既存と同じ：ユーザー文書がなければ、ここでエラーになり、そのメッセージをダイアログに出す
				if (!userData) throw new TypeError("Cannot read properties of undefined (reading 'isActive')")

				if (userData.isActive) {
					setMyName(userData.name)
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

					// 未読区切り線の基準日時を、このあと lastChecked が更新される前に、一度だけ取得しておく
					const initialLastChecked: Date | null =
						userData.lastChecked && userData.lastChecked[talkId] ? userData.lastChecked[talkId].toDate() : null

					// プッシュ通知の初期化（読み込みと並行。失敗してもトーク表示には影響させない）
					startPush(authUserId)

					setStart({ myUserId: authUserId, meIsAdmin: !!userData.isAdmin, initialLastChecked })
				} else {
					hideOverlayOnly()
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

	// ---- 操作 ----
	const closeDrawer = () => setDrawerOpen(false)

	const handleLogout = async () => {
		const isConfirmed = await dialog.confirm('ログアウトしますか？')
		if (!isConfirmed) return
		try {
			await logout() // この端末への通知紐づけを解除してから、ログアウト
			console.log('ログアウトしました！')
		} catch (error) {
			console.error('ログアウトエラー:', error)
			await dialog.alert('ログアウトに失敗しました。')
		}
	}

	const openProfile = useCallback((userId: string | undefined, startEditMode = false) => {
		if (!userId) return
		profileToken.current += 1
		setProfileTarget({ userId, startEditMode, token: profileToken.current })
	}, [])

	const openReadBy = useCallback((userIds: string[]) => {
		readByToken.current += 1
		setReadByTarget({ userIds, token: readByToken.current })
	}, [])

	/** 返信対象をセットし、メッセージ入力欄の上に「〇〇に返信」を表示する。 */
	const startReply = useCallback((docId: string, userName: string) => {
		replyToIdRef.current = docId
		setReplyTo({ id: docId, name: userName })
		if (messageInputRef.current) messageInputRef.current.focus()
	}, [])

	/** 返信状態を解除する。 */
	const cancelReply = useCallback(() => {
		replyToIdRef.current = null
		setReplyTo(null)
	}, [])

	/** 現在のトークルームのメンバー（自分以外）へ新着通知を送る。失敗しても送信処理には影響しない。 */
	const notifyThisRoom = (text: string, replyTargetId: string | null) =>
		notifyRoom({
			talkId,
			myUserId,
			myName: myNameRef.current,
			roomTitle: room.getNotifyRoomTitle(),
			memberIds: room.roomMembersRef.current,
			text,
			replyTargetId,
			getMessage: (id) => room.messagesByIdRef.current[id],
		})

	/** アンケートを送る（失敗したら例外。呼び出し側のモーダルが、ダイアログで知らせる）。 */
	const handleSendPoll = async (question: string, choices: string[]) => {
		await sendPollMessage({ talkId, myUserId, question, choices, replyTo: replyToIdRef.current })
		void notifyThisRoom('📊 ' + question, replyToIdRef.current) // 新着通知（待たない）
		cancelReply() // 送信成功後は返信状態を解除
	}

	/** アンケートに回答（または回答を変更）する。全メンバーへの通知は待たない。 */
	const handleVotePoll = useCallback(
		async (messageId: string, selectedIndex: number, hadMyAnswer: boolean) => {
			await votePoll({ talkId, myUserId, messageId, selectedIndex })
			void notifyPollAnswer({
				talkId,
				myUserId,
				myName: myNameRef.current,
				roomTitle: room.getNotifyRoomTitle(),
				memberIds: room.roomMembersRef.current,
				isChange: hadMyAnswer,
			})
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[talkId, myUserId],
	)

	const openPollVoters = useCallback((answerMap: Record<string, unknown>, choiceIndex: number, choiceLabel: string) => {
		pollVotersToken.current += 1
		setPollVotersTarget({ answerMap, choiceIndex, choiceLabel, token: pollVotersToken.current })
	}, [])

	// ---------- 編集・削除 ----------
	const openEdit = useCallback((view: MessageView) => {
		editToken.current += 1
		setEditTarget({
			messageId: view.id,
			userId: view.data.userId as string,
			message: view.data.message as string,
			time: view.data.time,
			token: editToken.current,
		})
	}, [])

	const handleEditSave = async (messageId: string, newUserId: string, newMessage: string, newTimeValue: string | null) => {
		try {
			await editMessage({ talkId, messageId, newUserId, newMessage, newTimeValue, meIsAdmin })
			await dialog.alert('変更しました。')
		} catch (error) {
			await dialog.alert(error instanceof Error ? error.message : String(error))
			console.error(error)
		}
	}

	const handleEditDelete = async (messageId: string) => {
		if (!(await dialog.confirm('本当に削除しますか？'))) return
		try {
			// 実際にdeleteするのではなく、isDisplayをfalseにして非表示化する
			await hideMessage(talkId, messageId)
			setEditTarget(null)
			await dialog.alert('削除しました。')
		} catch (error) {
			await dialog.alert(error instanceof Error ? error.message : String(error))
			console.error(error)
		}
	}

	// ---------- 転送（管理者のみ） ----------
	const openForwardFromView = useCallback((view: MessageView) => {
		forwardToken.current += 1
		setForwardTarget({ items: [makeForwardItem(view.data)], token: forwardToken.current })
	}, [])

	const exitSelectionMode = useCallback(() => {
		setSelectionMode(false)
		setSelectedIds(new Set())
	}, [])

	const handleForwardToRoom = async (targetRoomId: string, items: Record<string, unknown>[]) => {
		await forwardMessagesToRoom(targetRoomId, items)
		setForwardTarget(null)
		exitSelectionMode() // 一括選択から転送した場合は、選択モードも終了しておく
		await dialog.alert(items.length > 1 ? `${items.length}件のメッセージを転送しました。` : '転送しました。')
	}

	// ---------- 一括選択・一括削除・一括転送 ----------
	const toggleSelectionMode = () => {
		if (selectionMode) exitSelectionMode()
		else setSelectionMode(true)
	}

	const toggleSelect = useCallback((messageId: string, checked: boolean) => {
		setSelectedIds((current) => {
			const next = new Set(current)
			if (checked) next.add(messageId)
			else next.delete(messageId)
			return next
		})
	}, [])

	/** 「まとめて削除」：実際にdeleteするのではなく、isDisplayをfalseにして一括非表示化する。 */
	const handleBulkDelete = async () => {
		const count = selectedIds.size
		if (count === 0) return
		if (!(await dialog.confirm(`選択した${count}件のメッセージを削除します。よろしいですか？`))) return

		setBulkBusy(true)
		try {
			await hideMessages(talkId, Array.from(selectedIds))
			await dialog.alert(`${count}件のメッセージを削除しました。`)
			exitSelectionMode()
		} catch (error) {
			console.error('一括削除エラー:', error)
			await dialog.alert('削除に失敗しました。\n' + (error instanceof Error ? error.message : String(error)))
		} finally {
			setBulkBusy(false)
		}
	}

	/** 「まとめて転送」：選択中のメッセージをまとめて取得し、転送モーダルを開く。 */
	const handleBulkForward = async () => {
		if (selectedIds.size === 0) return
		try {
			const datas = await fetchMessageDatas(talkId, Array.from(selectedIds))
			if (datas.length === 0) {
				await dialog.alert('転送できるメッセージがありませんでした。')
				return
			}
			forwardToken.current += 1
			setForwardTarget({ items: datas.map(makeForwardItem), token: forwardToken.current })
		} catch (error) {
			console.error('転送準備エラー:', error)
			await dialog.alert('転送するメッセージの取得に失敗しました。\n' + (error instanceof Error ? error.message : String(error)))
		}
	}

	const handleMessageChange = (value: string) => {
		setMessageText(value)
		saveMessageDraft(talkId, value)
	}

	const handleSendMessage = async () => {
		const message = messageText.trim()
		setSending(true)
		const replyToSnapshot = replyToIdRef.current // 送信前に返信先IDを確定させておく
		try {
			await sendTextMessage({ talkId, myUserId, message, replyTo: replyToSnapshot })
			void notifyThisRoom(message, replyToSnapshot) // 新着通知（待たない）
			cancelReply() // 送信成功後は返信状態を解除
			clearMessageDraft(talkId) // 送信成功後は下書きをリセット
		} catch (error) {
			console.log(error)
		} finally {
			setSending(false)
			setMessageText('') // 失敗しても、入力欄は空にする（既存と同じ）
		}
	}

	const handleSendImage = async (imageUrl: string, caption: string) => {
		// 現在のトークルームに画像メッセージを追加（任意のキャプション付き）
		await sendImageMessage({ talkId, myUserId, caption, imageUrl, replyTo: replyToIdRef.current })
		void notifyThisRoom(caption || '📷 画像を送信しました', replyToIdRef.current) // 新着通知（待たない）
		cancelReply() // 送信成功後は返信状態を解除
	}

	/** 指定したメッセージまでスクロールしてジャンプし、「元のメッセージにもどる」ボタンを表示する。 */
	const jumpToMessage = useCallback(
		(targetId: string) => {
			const targetEl = document.getElementById('msg-' + targetId)
			if (!targetEl) return
			const talkArea = talkAreaRef.current
			if (scrollBeforeJump.current === null && talkArea) scrollBeforeJump.current = talkArea.scrollTop

			targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
			targetEl.classList.add('jump-highlight')
			setTimeout(() => targetEl.classList.remove('jump-highlight'), HIGHLIGHT_MS)
			setShowBackButton(true)
		},
		[talkAreaRef],
	)

	const backToOriginal = () => {
		if (scrollBeforeJump.current !== null && talkAreaRef.current) talkAreaRef.current.scrollTop = scrollBeforeJump.current
		scrollBeforeJump.current = null
		setShowBackButton(false)
	}

	return (
		<PageShell name="talk">
			<LoadingOverlay
				text={room.loadingText}
				percent={room.loadingPercent}
				hidden={room.overlayHidden}
				watchStall
				onSkip={room.skipLoading}
				showSkip={room.showSkip}
			/>
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

			<EditMessageModal target={editTarget} meIsAdmin={meIsAdmin} onClose={() => setEditTarget(null)} onSave={handleEditSave} onDelete={handleEditDelete} />
			<ForwardModal talkId={talkId} target={forwardTarget} onClose={() => setForwardTarget(null)} onForward={handleForwardToRoom} />

			<ImageSendModal open={imageModalOpen} onClose={() => setImageModalOpen(false)} onSend={handleSendImage} />

			<PollCreateModal open={pollModalOpen} onClose={() => setPollModalOpen(false)} onSubmit={handleSendPoll} />
			<PollVotersModal target={pollVotersTarget} onClose={() => setPollVotersTarget(null)} onOpenProfile={(userId) => openProfile(userId)} />

			<ReadByModal target={readByTarget} onClose={() => setReadByTarget(null)} onOpenProfile={(userId) => openProfile(userId)} />

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
				<div id="selection-container" className={room.contentVisible ? undefined : 'hidden'}>
					<p id="selection-title">My Talk</p>
					<div id="head-area">
						<button id="to-home-button" onClick={() => navigate('/')}>
							←ホームへもどる
						</button>
						<div id="talk-title-avatar">
							{room.header && <Avatar name={room.header.title} imageUrl={room.header.imageUrl} tracker={roomIconTracker} />}
						</div>
						<p id="talk-title">{room.header ? room.header.title : 'loading...'}</p>
						<p id="select-mode-button" onClick={toggleSelectionMode}>
							{selectionMode ? '選択解除' : '選択'}
						</p>
						{/* 「メンバー」（⑤）は、あとの段階で動くようにする */}
						<p id="member-button">メンバー</p>
					</div>
					{/* 問題投稿サイト（意見募集）のトークにだけ、サイトへのリンクバナーを表示する */}
					<a
						id="problem-posting-banner"
						className={talkId === PROBLEM_POSTING_TALK_ID ? undefined : 'hidden'}
						href="https://appsforschool.github.io/ProblemPosting/app.html"
						target="_blank"
						rel="noopener noreferrer"
					>
						問題投稿サイトはこちらから →
					</a>
					<p id="talk-loading" className="hidden">
						loading...
					</p>
					<div id="talk-area" className={selectionMode ? 'selection selecting' : 'selection'} ref={talkAreaRef}>
						{room.messagesReady ? (
							<div>
								{room.items.map((view) => (
									<MessageItem
										key={view.id}
										view={view}
										showUnreadDivider={view.id === room.dividerBeforeId}
										onOpenProfile={openProfile}
										onOpenReadBy={openReadBy}
										onStartReply={startReply}
										onJump={jumpToMessage}
										myUserId={myUserId}
										onVotePoll={handleVotePoll}
										onOpenPollVoters={openPollVoters}
										meIsAdmin={meIsAdmin}
										selected={selectedIds.has(view.id)}
										onEdit={openEdit}
										onForward={openForwardFromView}
										onToggleSelect={toggleSelect}
									/>
								))}
							</div>
						) : (
							<p>loading...</p>
						)}
					</div>

					<button id="back-to-original-button" className={showBackButton ? undefined : 'hidden'} onClick={backToOriginal}>
						↓ 元のメッセージにもどる
					</button>

					{/* 選択モードの操作バー */}
					<div id="selection-action-bar" className={selectionMode ? undefined : 'hidden'}>
						<p id="selection-count-text">{`${selectedIds.size}件選択中`}</p>
						<div className="selection-action-buttons">
							{/* 「まとめて転送」は管理者のみ（転送機能自体が管理者限定のため） */}
							<button
								id="selection-forward-button"
								className={meIsAdmin ? undefined : 'hidden'}
								disabled={selectedIds.size === 0 || bulkBusy}
								onClick={() => void handleBulkForward()}
							>
								まとめて転送
							</button>
							<button id="selection-delete-button" disabled={selectedIds.size === 0 || bulkBusy} onClick={() => void handleBulkDelete()}>
								まとめて削除
							</button>
							<button id="selection-cancel-button" onClick={exitSelectionMode}>
								キャンセル
							</button>
						</div>
					</div>

					<div id="reply-preview-bar" className={replyTo ? undefined : 'hidden'}>
						<p id="reply-preview-text">{replyTo ? `${replyTo.name}に返信` : ''}</p>
						<span id="reply-preview-cancel" className="close-button" onClick={cancelReply}>
							&times;
						</span>
					</div>

					<div id="message-add-area">
						<div className="message-add-actions">
							<button id="open-image-modal-button" title="画像を送信" onClick={() => setImageModalOpen(true)}>
								画像
							</button>
							<button id="open-poll-modal-button" title="アンケートを作成" onClick={() => setPollModalOpen(true)}>
								質問
							</button>
						</div>
						<textarea
							id="message-input"
							ref={messageInputRef}
							rows={5}
							placeholder="メッセージを入力"
							value={messageText}
							onChange={(e) => handleMessageChange(e.target.value)}
						></textarea>
						<button id="message-add-button" disabled={sending || messageText.trim() === ''} onClick={() => void handleSendMessage()}>
							{sending ? '送信中...' : '送信'}
						</button>
					</div>
				</div>
			</main>
		</PageShell>
	)
}
