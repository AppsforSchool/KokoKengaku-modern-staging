import { useRef, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { getUserCache, hasActivePrize } from '../../lib/userCache'

// ★ メンバー一覧（既存の getMember / renderGroupIconEditor と同じHTML構造・同じ挙動）。
//   ・ルームの members に入っている人だけを表示する。名前・アイコン・色（管理者・景品）は、ユーザー情報のキャッシュから。
//   ・管理者にだけ、「最後に確認した時刻」と、（グループなら）削除ボタンを出す。
//   ・メンバーの追加・削除は、「管理者」かつ「3人以上のグループ」のときだけ。
//   ・グループのアイコンの変更・削除は、「管理者」かつ「グループ」のときだけ。

interface Props {
	open: boolean
	talkId: string
	myUserId: string
	/** ルームのメンバーID（自分を含む）。 */
	members: string[]
	/** ユーザーID → トークID → 最終確認日時の文字列。 */
	lastChecked: Record<string, Record<string, string>>
	/** 自分が管理者か（グループアイコン欄の判定に使う。既存は、ログイン時に取得した値）。 */
	meIsAdmin: boolean
	isGroup: boolean
	roomTitle: string
	roomImageUrl: string
	onClose: () => void
	onOpenProfile: (userId: string) => void
	onOpenAddMember: () => void
	onRemoveMember: (userId: string, memberName: string) => void
	/** グループアイコンを保存する（file が null のときは、画像を削除する）。失敗の案内は、呼び出し側が出す。 */
	onSaveGroupIcon: (file: File | null) => Promise<void>
	/** 「画像を削除」の確認。 */
	confirmRemoveIcon: () => Promise<boolean>
}

export function MemberModal(props: Props) {
	const { open, talkId, myUserId, members, lastChecked, meIsAdmin, isGroup, roomTitle, roomImageUrl } = props
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [iconBusy, setIconBusy] = useState<'upload' | 'remove' | null>(null)

	// 自分が管理者かどうかを判定（既存は、ユーザー情報のキャッシュで判定）
	const isMeAdmin = (getUserCache(myUserId) || {}).isAdmin || false
	// メンバーの追加・削除は「管理者」かつ「グループトーク」のときだけ
	const canEditMembers = isMeAdmin && members.length >= 3
	const canEditIcon = meIsAdmin && isGroup

	const saveIcon = async (file: File | null) => {
		setIconBusy(file ? 'upload' : 'remove')
		try {
			await props.onSaveGroupIcon(file)
		} finally {
			setIconBusy(null)
		}
	}

	return (
		<div id="member-modal" className={'modal-overlay' + (open ? '' : ' hidden')}>
			<div className="modal-content">
				<div className="modal-header">
					<p className="title">メンバー</p>
					<span id="member-modal-close" className="close-button" onClick={props.onClose}>
						&times;
					</span>
				</div>
				<div className="modal-scroll-body">
					{/* グループアイコンの変更（管理者 かつ グループのときだけ表示） */}
					<div id="group-icon-area" className={canEditIcon ? undefined : 'hidden'}>
						<div id="group-icon-holder">
							{canEditIcon && <Avatar name={roomTitle} size="large" imageUrl={roomImageUrl} />}
						</div>
						<input
							ref={fileInputRef}
							type="file"
							id="group-icon-input"
							accept="image/*"
							className="visually-hidden-input"
							onChange={(e) => {
								const file = e.target.files && e.target.files[0]
								e.target.value = ''
								if (!file) return
								void saveIcon(file)
							}}
						/>
						<div className="group-icon-buttons">
							<button
								id="group-icon-change-button"
								className="secondary-button"
								type="button"
								disabled={iconBusy !== null}
								onClick={() => fileInputRef.current?.click()}
							>
								{iconBusy === 'upload' ? 'アップロード中...' : iconBusy === 'remove' ? '削除中...' : 'グループアイコンを変更'}
							</button>
							<button
								id="group-icon-remove-button"
								className={'secondary-button' + (roomImageUrl ? '' : ' hidden')}
								type="button"
								disabled={iconBusy !== null}
								onClick={async () => {
									if (await props.confirmRemoveIcon()) await saveIcon(null)
								}}
							>
								画像を削除
							</button>
						</div>
					</div>

					{/* メンバーの追加（管理者 かつ グループのときだけ表示） */}
					<button
						id="member-add-button"
						className={'secondary-button' + (canEditMembers ? '' : ' hidden')}
						type="button"
						onClick={props.onOpenAddMember}
					>
						＋ メンバーを追加
					</button>

					<div id="member-area">
						{members.map((userId) => {
							const cached = getUserCache(userId) || {}
							const memberName = cached.name || '不明なユーザー'
							const isAdmin = cached.isAdmin || false
							const lastCheckedTimeStr = (lastChecked[userId] && lastChecked[userId][talkId]) || ''
							return (
								<div key={userId} className={'member-item' + (isAdmin ? ' admin' : hasActivePrize(cached) ? ' prize' : '')}>
									<div className="member-left clickable-user" style={{ cursor: 'pointer' }} onClick={() => props.onOpenProfile(userId)}>
										<Avatar name={memberName} size="small" imageUrl={cached.imageUrl || ''} />
										<span className="member-name">{memberName}</span>
									</div>
									{/* 自分が管理者の場合のみ、右側に最終確認時間と（グループなら）削除ボタンを追加 */}
									{isMeAdmin && (
										<div className="member-right">
											<span className="member-last-checked">{lastCheckedTimeStr ? lastCheckedTimeStr : '未確認'}</span>
											{canEditMembers && (
												<button type="button" className="member-remove-button" onClick={() => props.onRemoveMember(userId, memberName)}>
													削除
												</button>
											)}
										</div>
									)}
								</div>
							)
						})}
					</div>
				</div>
			</div>
		</div>
	)
}
