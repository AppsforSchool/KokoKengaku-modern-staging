import { memo, useEffect, useRef, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import type { MessageView } from './types'

// ★ メッセージ1件の表示（既存の talkScript.js の buildMessageElement と同じHTML構造・クラス）。
//   ・① では、本文・画像・返信元・既読までを表示する。アンケート（③）、編集・転送・選択（④）は、あとの段階で足す。

const REPLY_MARK = '↩\uFE0E'

interface Props {
	view: MessageView
	/** この直前に、未読の区切り線（「ここから未読」）を出すか。 */
	showUnreadDivider: boolean
	onOpenProfile: (userId: string | undefined) => void
	onOpenReadBy: (readBy: string[]) => void
	onStartReply: (docId: string, senderName: string) => void
	onJump: (targetId: string) => void
}

/** 未読区切り線（既存の buildUnreadDivider と同じ構造）。 */
function UnreadDivider() {
	return (
		<div id="unread-divider" className="unread-divider">
			<span className="unread-divider-line"></span>
			<span className="unread-divider-label">ここから未読</span>
			<span className="unread-divider-line"></span>
		</div>
	)
}

/** 送信された画像。実際の画像の縦横比が分かったら、枠の縦横比をそれに合わせる（既存の load の処理と同じ）。 */
function MessageImage({ src }: { src: string }) {
	const ref = useRef<HTMLImageElement>(null)
	const [ratio, setRatio] = useState<string | null>(null)

	const applyNaturalSize = (img: HTMLImageElement) => {
		if (img.naturalWidth > 0 && img.naturalHeight > 0) setRatio(`${img.naturalWidth} / ${img.naturalHeight}`)
	}
	// 表示される前に読み終わっていた場合（キャッシュなど）にも、縦横比を合わせる
	useEffect(() => {
		const img = ref.current
		if (img && img.complete) applyNaturalSize(img)
	}, [src])

	return (
		<img
			ref={ref}
			className={'message-image' + (ratio ? ' loaded' : '')}
			style={ratio ? { aspectRatio: ratio } : undefined}
			src={src}
			alt="送信された画像"
			onLoad={(e) => applyNaturalSize(e.currentTarget)}
		/>
	)
}

function MessageItemBase({ view, showUnreadDivider, onOpenProfile, onOpenReadBy, onStartReply, onJump }: Props) {
	const replyIcon = (
		<span className="reply-action" title="返信" onClick={() => onStartReply(view.id, view.senderName)}>
			{REPLY_MARK}
		</span>
	)

	let senderClass = 'clickable-user'
	if (view.senderIsAdmin) senderClass += ' admin'
	else if (view.senderHasPrize) senderClass += ' prize'

	return (
		<>
			{showUnreadDivider && <UnreadDivider />}
			<div id={'msg-' + view.id} className={'message ' + (view.isOwn ? 'message-own' : 'message-other')}>
				<div className="message-row">
					{!view.isOwn && (
						<Avatar
							name={view.senderName}
							imageUrl={view.senderImageUrl}
							extraClassName="clickable-user"
							onClick={() => onOpenProfile(view.userId)}
						/>
					)}
					<div className="bubble-col">
						<p className="message-user">
							{/* 自分の発言では、吹き出しの上に自分の名前を出さない（相手の発言のみ表示） */}
							{!view.isOwn && (
								<span className={senderClass} onClick={() => onOpenProfile(view.userId)}>{`${view.senderName} `}</span>
							)}
							<span>{`${view.displayTime} `}</span>
							<span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => onOpenReadBy(view.readBy)}>
								{`既読:${view.readBy.length}人`}
							</span>
						</p>

						{/* 表示順：送信者・日付など → 返信元のメッセージ → 今回のメッセージ */}
						{view.reply && (
							<div className="reply-context">
								<p className="reply-context-label">{view.reply.label}</p>
								{view.reply.missing ? (
									<div className="reply-context-quote reply-context-quote-missing">{view.reply.snippet}</div>
								) : (
									<div
										className={'reply-context-quote ' + (view.reply.tone === 'own' ? 'reply-context-quote-own' : 'reply-context-quote-other')}
										onClick={() => onJump(view.reply!.targetId)}
									>
										{view.reply.snippet}
									</div>
								)}
							</div>
						)}

						{/* 画像は吹き出しの外に、その下にテキストがあれば吹き出しで表示する */}
						{view.imageUrl && <MessageImage src={view.imageUrl} />}

						{/* テキスト本文＋返信矢印を横並びに配置する */}
						{view.hasText && (
							<div className="bubble-content-row">
								<p className="message-text">{view.textNode}</p>
								{replyIcon}
							</div>
						)}

						{/* テキストが無いメッセージ（画像単独・アンケート単独）にも返信矢印を出す */}
						{!view.hasText && <div className="bubble-content-row standalone-reply-row">{replyIcon}</div>}
					</div>
				</div>
			</div>
		</>
	)
}

export const MessageItem = memo(MessageItemBase)
