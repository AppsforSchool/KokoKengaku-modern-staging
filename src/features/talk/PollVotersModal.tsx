import { useMemo } from 'react'
import { Avatar } from '../../components/Avatar'
import { hasActivePrize } from '../../lib/userCache'
import { useUserEntries, type UserEntry } from './useUserEntries'

// ★ ある選択肢を選んだ人の一覧（既存の openPollVotersModal と同じ）。

export interface PollVotersTarget {
	answerMap: Record<string, unknown>
	choiceIndex: number
	choiceLabel: string
	token: number
}

interface Props {
	target: PollVotersTarget | null
	onClose: () => void
	onOpenProfile: (userId: string) => void
}

export function PollVotersModal({ target, onClose, onOpenProfile }: Props) {
	// この選択肢を選んだ人（answerMap は「ユーザーID → 選んだ番号」）
	const listTarget = useMemo(
		() =>
			target
				? {
						userIds: Object.keys(target.answerMap || {}).filter((uid) => target.answerMap[uid] === target.choiceIndex),
						token: target.token,
					}
				: null,
		[target],
	)
	const entries = useUserEntries(listTarget)

	return (
		<div id="poll-voters-modal" className={'modal-overlay' + (target ? '' : ' hidden')}>
			<div className="modal-content">
				<div className="modal-header">
					<p className="title" id="poll-voters-title">
						{target && target.choiceLabel ? `「${target.choiceLabel}」を選んだ人` : '回答した人'}
					</p>
					<span id="poll-voters-modal-close" className="close-button" onClick={onClose}>
						&times;
					</span>
				</div>
				<div className="modal-scroll-body">
					<div id="poll-voters-area">
						{entries === null
							? '読み込み中...'
							: entries.length === 0
								? <p style={{ color: 'var(--text-muted)' }}>まだ誰も選んでいません</p>
								: entries.map(({ userId, cached }: UserEntry) => (
										<p key={userId} className="clickable-user" style={{ cursor: 'pointer' }} onClick={() => onOpenProfile(userId)}>
											<Avatar name={cached.name} size="small" imageUrl={cached.imageUrl} />
											<span className={cached.isAdmin ? 'admin' : hasActivePrize(cached) ? 'prize' : undefined}>{cached.name}</span>
										</p>
									))}
					</div>
				</div>
			</div>
		</div>
	)
}
