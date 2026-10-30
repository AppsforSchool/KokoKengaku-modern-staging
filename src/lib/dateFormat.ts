// ★ 日時の表示形式（既存の talkScript.js の formatDateTime と同じ）。例：2026/10/30 09:05
export function formatDateTime(date: Date): string {
	const yyyy = date.getFullYear()
	const mm = String(date.getMonth() + 1).padStart(2, '0')
	const dd = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const min = String(date.getMinutes()).padStart(2, '0')
	return `${yyyy}/${mm}/${dd} ${hh}:${min}`
}
