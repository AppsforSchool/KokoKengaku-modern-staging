import { useEffect, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { addDoc, collection, db, getDocs, serverTimestamp } from '../../firebase'
import { useDialog } from '../../ui/DialogProvider'
import type { UserListItem } from './roomUtils'

// ★ 新しいグループの作成モーダル（管理者のみ。既存の appScript.js の openCreateTalkModal 〜 handleCreateTalk と同じ挙動）。
//   ・グループは3人以上なので、3人以上を選び、グループ名を入れるまで「作成する」は押せない。
//   ・選んだ人だけをメンバーにする（作成者も、自分で選ばなければ入らない。管理者は全トークを見られる）。
//   ・書き込みは KokoKengaku への addDoc { title, members, lastUpdatedAt }（形は変えないこと）。
//   ・※ 既存の挙動：検索で絞り込むと、いま表示されていない人のチェックは外れる（表示中のチェックだけを引き継ぐ）。そのまま再現している。

interface Props {
	open: boolean
	onClose: () => void
	/** 一覧の取得時に読み込み済みの全ユーザー。なければ null（開いたときに取得する）。 */
	usersCache: UserListItem[] | null
}

export function CreateTalkModal({ open, onClose, usersCache }: Props) {
	const dialog = useDialog()
	const [title, setTitle] = useState('')
	const [search, setSearch] = useState('')
	const [checked, setChecked] = useState<Set<string>>(new Set())
	const [users, setUsers] = useState<UserListItem[] | null>(usersCache)
	const [loadingUsers, setLoadingUsers] = useState(true)
	const [creating, setCreating] = useState(false)

	// 一覧の取得が終わったら、そのユーザー一覧を使い回す
	useEffect(() => {
		if (usersCache && !users) setUsers(usersCache)
	}, [usersCache, users])

	// 開くたびに、グループ名と検索を空に戻す（チェックは残る。既存と同じ）
	useEffect(() => {
		if (!open) return
		setTitle('')
		setSearch('')
		if (users) {
			setLoadingUsers(false)
			return
		}
		let cancelled = false
		setLoadingUsers(true)
		void (async () => {
			try {
				const usersSnapshot = await getDocs(collection(db, 'users_random'))
				if (cancelled) return
				setUsers(
					usersSnapshot.docs
						.map((d) => ({
							userId: d.id,
							name: ((d.data() || {}).name as string) || d.id,
							no: typeof (d.data() || {}).no === 'number' ? (d.data().no as number) : Infinity,
							isActive: (d.data() || {}).isActive !== false,
						}))
						.filter((u) => u.isActive) // 自分も選択肢に含める（自動では追加しない）。停止中のアカウントは除く
						.sort((a, b) => a.no - b.no), // no順（無ければ最後）に並べる
				)
				setLoadingUsers(false)
			} catch (error) {
				if (cancelled) return
				setLoadingUsers(false)
				console.error('ユーザー一覧の取得エラー:', error)
				await dialog.alert('ユーザー一覧の取得に失敗しました。\n' + (error instanceof Error ? error.message : String(error)))
			}
		})()
		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])

	const lowerFilter = search.trim().toLowerCase()
	const filteredUsers = (users || []).filter((u) => u.name.toLowerCase().includes(lowerFilter))

	const onSearchChange = (value: string) => {
		setSearch(value)
		// 再描画で、いま表示されているチェックだけが引き継がれる（既存の renderCreateTalkMemberList と同じ）
		const nextFilter = value.trim().toLowerCase()
		const visibleIds = new Set((users || []).filter((u) => u.name.toLowerCase().includes(nextFilter)).map((u) => u.userId))
		setChecked((prev) => new Set([...prev].filter((id) => visibleIds.has(id))))
	}

	const toggle = (userId: string) => {
		setChecked((prev) => {
			const next = new Set(prev)
			if (next.has(userId)) next.delete(userId)
			else next.add(userId)
			return next
		})
	}

	// グループは3人以上なので、3人以上を選ぶ必要がある（自分も、必要なら自分で選ぶ）
	const canSubmit = title.trim() !== '' && checked.size >= 3

	const handleCreate = async () => {
		const trimmed = title.trim()
		if (!trimmed) return
		if (checked.size < 3) return // グループは3人以上
		// 選んだ人だけをメンバーにする
		const members = Array.from(new Set(checked))

		setCreating(true)
		try {
			await addDoc(collection(db, 'KokoKengaku'), {
				title: trimmed,
				members,
				lastUpdatedAt: serverTimestamp(),
			})
			onClose()
			setTitle('')
			setSearch('')
		} catch (error) {
			console.error('トーク作成エラー:', error)
			await dialog.alert('トークの作成に失敗しました。\n' + (error instanceof Error ? error.message : String(error)))
		} finally {
			setCreating(false)
		}
	}

	return (
		<div id="create-talk-modal" className={'modal-overlay' + (open ? '' : ' hidden')}>
			<div className="modal-content">
				<div className="modal-header">
					<p className="title">新しいグループを作成</p>
					<span id="create-talk-modal-close" className="close-button" onClick={onClose}>
						&times;
					</span>
				</div>
				<div className="modal-scroll-body">
					<p className="profile-label">グループ名</p>
					<input
						id="create-talk-title-input"
						type="text"
						placeholder="グループの名前"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
					/>

					<p className="profile-label" style={{ marginTop: '1rem' }}>
						メンバー（3人以上選択）
					</p>
					<input
						id="create-talk-member-search"
						type="text"
						placeholder="ユーザー名で検索"
						value={search}
						onChange={(e) => onSearchChange(e.target.value)}
					/>
					<p id="create-talk-member-loading" className={loadingUsers ? undefined : 'hidden'}>
						読み込み中...
					</p>
					<div id="create-talk-member-list">
						{users &&
							(filteredUsers.length === 0 ? (
								<p>該当するユーザーがいません。</p>
							) : (
								filteredUsers.map((u) => (
									<label key={u.userId} className="create-talk-member-item">
										<input type="checkbox" value={u.userId} checked={checked.has(u.userId)} onChange={() => toggle(u.userId)} />
										<Avatar name={u.name} size="small" />
										<span>{u.name}</span>
									</label>
								))
							))}
					</div>

					<button
						id="create-talk-submit-button"
						className="normal-button"
						disabled={creating || !canSubmit}
						style={{ marginTop: '1rem' }}
						onClick={() => void handleCreate()}
					>
						{creating ? '作成中...' : '作成する'}
					</button>
				</div>
			</div>
		</div>
	)
}
