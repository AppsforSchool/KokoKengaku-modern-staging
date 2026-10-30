// ★ 入力中メッセージの下書き保存（既存の talkScript.js の saveMessageDraft / restoreMessageDraft / clearMessageDraft と同じ）。
//   ルームごとに、localStorage の「messageDraft_{ルームID}」に保存する。入力が空になったら削除する。

function key(talkId: string): string | null {
	return talkId ? `messageDraft_${talkId}` : null
}

export function saveMessageDraft(talkId: string, value: string): void {
	const k = key(talkId)
	if (!k) return
	try {
		if (value) localStorage.setItem(k, value)
		else localStorage.removeItem(k)
	} catch (error) {
		console.log(error)
	}
}

/** 保存されている下書き（なければ ''）。 */
export function loadMessageDraft(talkId: string): string {
	const k = key(talkId)
	if (!k) return ''
	try {
		return localStorage.getItem(k) || ''
	} catch (error) {
		console.log(error)
		return ''
	}
}

export function clearMessageDraft(talkId: string): void {
	const k = key(talkId)
	if (!k) return
	try {
		localStorage.removeItem(k)
	} catch (error) {
		console.log(error)
	}
}
