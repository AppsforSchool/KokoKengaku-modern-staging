import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { collection, db, getDocs } from '../../firebase'
import { useDialog } from '../../ui/DialogProvider'

// ★ メンバー追加モーダル（管理者のみ。既存の openAddMemberModal / renderAddMemberList / handleAddMembers と同じ）。
//   ・有効なユーザーのうち、まだこのグループにいない人を、番号順に並べる。名前で絞り込める。
//   ・絞り込んでも、すでにチェックした人は、一覧に残る（選択が消えない）。
//   ・1人以上選ぶと、「N人を追加する」が押せる。

interface Candidate {
	userId: string
	name: string
	imageUrl: string
	no: number
}

interface Props {
	/** 開くたびに変える（開いている間は、非 null）。 */
	openToken: number | null
	/** いまのメンバー（候補から除く）。 */
	members: string[]
	onClose: () => void
	/** 追加する。失敗したら例外を投げる。 */
	onAdd: (userIds: string[]) => Promise<void>
}

export function AddMemberModal({ openToken, members, onClose, onAdd }: Props) {
	const dialog = useDialog()
	const [candidates, setCandidates] = useState<Candidate[]>([])
	const [loading, setLoading] = useState(false)
	const [query, setQuery] = useState('')
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
	const [submitting, setSubmitting] = useState(false)
	const runId = useRef(0)
	const membersRef = useRef(members)
	membersRef.current = members

	// 開くたびに、検索欄・一覧を空にして、ユーザー一覧を取得する
	useEffect(() => {
		if (openToken === null) return
		const myRun = ++runId.current
		setQuery('')
		setChecked(new Set())
		setSubmitting(false)
		setCandidates([])
		setLoading(true)
		void (async () => {
			try {
				const snapshot = await getDocs(collection(db, 'users_random'))
				if (myRun !== runId.current) return
				const list = snapshot.docs
					.filter((d) => (d.data() || {}).isActive !== false && !membersRef.current.includes(d.id))
					.map((d) => {
						const data = d.data() || {}
						return {
							userId: d.id,
							name: data.name || d.id,
							imageUrl: data.imageUrl || '',
							no: typeof data.no === 'number' ? data.no : Infinity,
						}
					})
					.sort((a, b) => a.no - b.no)
				setCandidates(list)
				setLoading(false)
			} catch (error) {
				if (myRun !== runId.current) return
				setLoading(false)
				console.error('ユーザー一覧の取得エラー:', error)
				await dialog.alert('ユーザー一覧の取得に失敗しました。\n' + (error instanceof Error ? error.message : String(error)))
			}
		})()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [openToken])

	const lower = query.trim().toLowerCase()
	// 検索しても選択が消えないよう、チェック済みの人は、絞り込みに関係なく残す
	const filtered = candidates.filter((u) => checked.has(u.userId) || u.name.toLowerCase().includes(lower))
	const count = checked.size

	const handleSubmit = async () => {
		const ids: string[] = Array.from(checked)
		if (ids.length === 0) return
		setSubmitting(true)
		try {
			await onAdd(ids)
		} catch (error) {
			console.error('メンバー追加エラー:', error)
			await dialog.alert('メンバーを追加できませんでした。\n' + (error instanceof Error ? error.message : String(error)))
			setSubmitting(false)
		}
	}

	return (
		<div id="add-member-modal" className={'modal-overlay' + (openToken !== null ? '' : ' hidden')}>
			<div className="modal-content">
				<div className="modal-header">
					<p className="title">メンバーを追加</p>
					<span id="add-member-modal-close" className="close-button" onClick={onClose}>
						&times;
					</span>
				</div>
				<div className="modal-scroll-body">
					<input id="add-member-search" type="text" placeholder="ユーザー名で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
					<p id="add-member-loading" className={loading ? undefined : 'hidden'}>
						読み込み中...
					</p>
					<div id="add-member-list">
						{!loading && filtered.length === 0 && (
							<p>{candidates.length === 0 ? '追加できるユーザーがいません。' : '該当するユーザーがいません。'}</p>
						)}
						{!loading &&
							filtered.map((u) => (
								<label key={u.userId} className="add-member-item">
									<input
										type="checkbox"
										value={u.userId}
										checked={checked.has(u.userId)}
										onChange={(e) => {
											const isChecked = e.target.checked
											setChecked((current) => {
												const next = new Set(current)
												if (isChecked) next.add(u.userId)
												else next.delete(u.userId)
												return next
											})
										}}
									/>
									<Avatar name={u.name} size="small" imageUrl={u.imageUrl} />
									<span>{u.name}</span>
								</label>
							))}
					</div>
					<button id="add-member-submit-button" className="normal-button" disabled={submitting || count === 0} onClick={() => void handleSubmit()}>
						{submitting ? '追加中...' : count > 0 ? `${count}人を追加する` : '追加する'}
					</button>
				</div>
			</div>
		</div>
	)
}
