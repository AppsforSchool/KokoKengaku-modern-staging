// ★ ページ読み込みの各段階にかかった時間を計測する（既存の perf.js の、記録の部分）。
//   時刻はすべて performance.now()（= ページを開いた時点からの経過ミリ秒）で記録する。
//   ※ 管理者向けの「計測結果をみる」パネル（perfNotifyReportAvailable / perfShowReport）は、
//     statusBadge と一緒に、フェーズ1の続きで移す。ここには、記録の仕組みだけがある。
//
//   perfMark("名前")          … 直前のマークから今までを1つの区間として記録する（メインの直列処理用）
//   perfStart("名前") → end() … 並行して走る処理の開始〜終了を記録する（OneSignalなど）
//   perfSample("名前", ms)    … 同じ種類の処理を何度も行うものの、件数・合計・最大をまとめる
//   perfNote("文字列")        … 補足メモ

export interface PerfSpan {
	label: string
	start: number
	end: number | null
	kind: 'main' | 'parallel'
}
export interface PerfSample {
	count: number
	sum: number
	max: number
}

export const perfSpans: PerfSpan[] = []
export const perfSamples: Record<string, PerfSample> = {}
export const perfNotes: string[] = []
let lastMainEnd = 0 // 直前のメイン処理が終わった時刻（最初は、ページを開いた時点 = 0）

const now = () => performance.now()

export function perfMark(label: string): void {
	const end = now()
	perfSpans.push({ label, start: lastMainEnd, end, kind: 'main' })
	lastMainEnd = end
}

/** 「最後に完了した段階」。読み込みが止まったとき、どこで止まっているかを表示するために使う。 */
export function perfLastMarkLabel(): string {
	const main = perfSpans.filter((x) => x.kind === 'main')
	return main.length ? main[main.length - 1].label : '（開始直後）'
}

/**
 * 一定時間たっても読み込みが終わらないとき、onStall(経過秒, 最後に完了した段階) を呼ぶ（以後も5秒ごと）。
 * 戻り値の関数を呼ぶと、監視をやめる（Reactの後片付け用。既存の perf.js にはなかった）。
 */
export function perfWatchStall(
	isDone: () => boolean,
	onStall: (seconds: number, lastLabel: string) => void,
	firstMs = 12000,
): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined
	let cancelled = false
	const tick = () => {
		if (cancelled || isDone()) return
		onStall(Math.round(now() / 1000), perfLastMarkLabel())
		timer = setTimeout(tick, 5000)
	}
	timer = setTimeout(tick, firstMs)
	return () => {
		cancelled = true
		clearTimeout(timer)
	}
}

export function perfStart(label: string): () => void {
	const span: PerfSpan = { label, start: now(), end: null, kind: 'parallel' }
	perfSpans.push(span)
	return () => {
		if (span.end === null) span.end = now()
	}
}

export function perfSample(label: string, ms: number): void {
	const s = perfSamples[label] || (perfSamples[label] = { count: 0, sum: 0, max: 0 })
	s.count++
	s.sum += ms
	if (ms > s.max) s.max = ms
}

export function perfNote(text: string): void {
	perfNotes.push(text)
}
