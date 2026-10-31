import { useState } from 'react'
import { useDialog } from '../../ui/DialogProvider'

// ★ メッセージ内に表示するアンケート（既存の buildPollWidget と同じHTML構造・同じ挙動）。
//   ・自分の回答がある選択肢に、最初からチェックが入る。自分の回答と違う選択肢を選ぶと、「答える」（回答済みなら「再回答する」）が押せる。
//   ・「〇人」をタップすると、その選択肢を選んだ人の一覧。
//   ・既存は、メッセージが変更されるたびに作り直され、選択が自分の回答に戻っていた。同じにするため、呼び出し側が、変更のたびに key を変える。

interface Props {
	messageId: string
	choices: string[]
	answerMap: Record<string, unknown>
	myUserId: string
	/** 回答を送る。失敗したら例外を投げる。 */
	onVote: (messageId: string, selectedIndex: number, hadMyAnswer: boolean) => Promise<void>
	onOpenVoters: (answerMap: Record<string, unknown>, choiceIndex: number, choiceLabel: string) => void
}

export function PollWidget({ messageId, choices, answerMap, myUserId, onVote, onOpenVoters }: Props) {
	const dialog = useDialog()
	const hasMyAnswer = Object.prototype.hasOwnProperty.call(answerMap, myUserId)
	const myAnswerIndex = hasMyAnswer ? (answerMap[myUserId] as number) : null
	const [selected, setSelected] = useState<number | null>(myAnswerIndex)
	const [sending, setSending] = useState(false)
	const radioGroupName = `poll-${messageId}`

	const handleAnswer = async () => {
		if (selected === null) return
		setSending(true)
		try {
			await onVote(messageId, selected, hasMyAnswer)
			// 成功時は、メッセージ一覧のリアルタイム再描画で、新しい状態に置き換わる
		} catch (error) {
			console.error('回答の送信に失敗しました:', error)
			await dialog.alert('回答の送信に失敗しました。\n' + (error instanceof Error ? error.message : String(error)))
			setSending(false)
		}
	}

	return (
		<div className="poll-widget">
			<div className="poll-choices-scroll">
				{choices.map((choiceLabel, index) => {
					const count = Object.values(answerMap).filter((v) => v === index).length
					return (
						<label key={index} className="poll-choice-option">
							<input
								type="radio"
								name={radioGroupName}
								value={String(index)}
								checked={selected === index}
								onChange={() => setSelected(index)}
							/>
							<span className="poll-choice-label">{choiceLabel}</span>
							<span
								className="poll-choice-count"
								onClick={(e) => {
									e.preventDefault()
									e.stopPropagation()
									onOpenVoters(answerMap, index, choiceLabel)
								}}
							>{`${count}人`}</span>
						</label>
					)
				})}
			</div>
			<button
				type="button"
				className="poll-answer-button"
				disabled={sending || selected === myAnswerIndex}
				onClick={() => void handleAnswer()}
			>
				{sending ? '送信中...' : hasMyAnswer ? '再回答する' : '答える'}
			</button>
		</div>
	)
}
