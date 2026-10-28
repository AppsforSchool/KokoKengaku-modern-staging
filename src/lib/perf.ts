// ★ ページ読み込みの各段階にかかった時間を計測し、読み込み完了後に「管理者のときだけ」結果を見られるようにする（既存の perf.js と同じ）。
//   時刻はすべて performance.now()（= ページを開いた時点からの経過ミリ秒）で記録する。
//
//   perfMark("名前")          … 直前のマークから今までを1つの区間として記録する（メインの直列処理用）
//   perfStart("名前") → end() … 並行して走る処理の開始〜終了を記録する（OneSignalなど）
//   perfSample("名前", ms)    … 同じ種類の処理を何度も行うもの（未読数クエリなど）の件数・平均・最大をまとめる
//   perfNote("文字列")        … 件数などの補足メモ
//   perfNotifyReportAvailable({isAdmin,page,diagnostics}) … 管理者にだけ、左上の通知欄に「計測結果をみる」ボタンを1分間出す
//   perfShowReport({page,diagnostics}) … 計測結果のパネルを開く（上のボタンから呼ばれる）
//   perfBeginPage(key)        … 【SPAで追加】画面を移ったとき、新しい画面の計測を始める（PerfRouteWatcher が呼ぶ）。
//                               最初の画面は、ページを開いた時点から測る。そのあとの画面は、移った時点から測る。
import { createButtonBadge } from './statusBadge'

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
let pageBase = 0 // この画面の計測を始めた時刻（最初の画面は 0）
let reportNotified = false
let currentPageKey: string | null = null

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
		onStall(Math.round((now() - pageBase) / 1000), perfLastMarkLabel())
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

/**
 * 【SPAで追加】画面を移ったときに、新しい画面の計測を始める。
 * 既存のサイトは、画面ごとにページを読み込み直していたため、計測も画面ごとに0から始まっていた。それを再現する。
 * 同じ key での呼び出しは、何もしない（開発時の二重実行に備える）。
 */
export function perfBeginPage(key: string): void {
	if (currentPageKey === null) {
		currentPageKey = key // 最初の画面：ページを開いた時点（0）から測る
		return
	}
	if (key === currentPageKey) return
	currentPageKey = key
	perfSpans.length = 0
	perfNotes.length = 0
	for (const k of Object.keys(perfSamples)) delete perfSamples[k]
	pageBase = now()
	lastMainEnd = pageBase
	reportNotified = false
}

// ---------- 表示用の整形 ----------
const fmt = (ms: number): string => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' 秒' : Math.round(ms) + ' ms')

function shortUrl(url: string): string {
	try {
		const u = new URL(url)
		const path = u.pathname.length > 38 ? '…' + u.pathname.slice(-37) : u.pathname
		return u.host + path
	} catch {
		return url
	}
}

function collectBrowserTimings(): Array<[string, number]> {
	const rows: Array<[string, number]> = []
	if (pageBase > 0) return rows // ブラウザの計測は、ページを開いたときのもの。あとから移った画面には、当てはまらない
	const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
	if (nav) {
		rows.push(['サーバー応答開始(TTFB)', nav.responseStart])
		rows.push(['HTML取得完了', nav.responseEnd])
		rows.push(['DOM構築完了(DOMContentLoaded)', nav.domContentLoadedEventEnd])
		if (nav.loadEventEnd > 0) rows.push(['load完了(画像・CSS等)', nav.loadEventEnd])
	}
	return rows
}

function collectSlowResources() {
	return (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
		.filter((r) => r.startTime >= pageBase)
		.map((r) => ({
			name: shortUrl(r.name),
			type: r.initiatorType,
			start: r.startTime - pageBase,
			duration: r.duration,
			size: r.transferSize || 0,
			proto: r.nextHopProtocol || '',
		}))
		.sort((a, b) => b.duration - a.duration)
		.slice(0, 10)
}

function buildReport(page: string): { text: string; total: number } {
	const end = Math.max(lastMainEnd, ...perfSpans.map((s) => s.end || 0)) - pageBase
	const lines: string[] = []
	lines.push(`【読み込み計測】${page}  合計 ${fmt(lastMainEnd - pageBase)}（ページ遷移開始から表示完了まで）`)
	lines.push('')
	lines.push('■ 段階ごとの所要時間（開始〜終了 / 所要）')
	perfSpans.forEach((s) => {
		const dur = s.end === null ? null : s.end - s.start
		const tag = s.kind === 'parallel' ? '[並行] ' : ''
		lines.push(
			`${tag}${s.label}: ${fmt(s.start - pageBase)} → ${s.end === null ? '未完了' : fmt(s.end - pageBase)} / ${dur === null ? '(表示時点で未完了)' : fmt(dur)}`,
		)
	})
	const sampleKeys = Object.keys(perfSamples)
	if (sampleKeys.length) {
		lines.push('')
		lines.push('■ 繰り返し処理の集計')
		sampleKeys.forEach((k) => {
			const s = perfSamples[k]
			lines.push(`${k}: ${s.count}回 / 平均 ${fmt(s.sum / s.count)} / 最大 ${fmt(s.max)} / 合計 ${fmt(s.sum)}`)
		})
	}
	if (perfNotes.length) {
		lines.push('')
		lines.push('■ メモ')
		perfNotes.forEach((n) => lines.push(n))
	}
	lines.push('')
	lines.push('■ ブラウザ計測')
	collectBrowserTimings().forEach(([label, ms]) => lines.push(`${label}: ${fmt(ms)}`))
	lines.push('')
	lines.push('■ 通信が遅かったリソース上位10件（所要時間 / 開始時刻 / サイズ）')
	collectSlowResources().forEach((r) => {
		lines.push(
			`${r.name} [${r.type}${r.proto ? '/' + r.proto : ''}]: ${fmt(r.duration)} / 開始 ${fmt(r.start)}${r.size ? ' / ' + Math.round(r.size / 1024) + 'KB' : ''}`,
		)
	})
	return { text: lines.join('\n'), total: end }
}

function injectStyle(): void {
	if (document.getElementById('perf-report-style')) return
	const style = document.createElement('style')
	style.id = 'perf-report-style'
	style.textContent = [
		'#perf-report{position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:12px}',
		'#perf-report .perf-box{background:#1e232a;color:#e8edf2;width:100%;max-width:760px;max-height:90vh;display:flex;flex-direction:column;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.4);font-family:ui-monospace,Menlo,Consolas,monospace}',
		'#perf-report .perf-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;border-bottom:1px solid #3a424c;font-weight:700;font-size:14px;position:sticky;top:0}',
		'#perf-report .perf-head button{font:inherit;font-size:12px;padding:6px 10px;border:none;border-radius:6px;cursor:pointer;background:#3a424c;color:#fff;margin-left:6px}',
		'#perf-report pre{margin:0;padding:12px 14px;overflow:auto;font-size:11.5px;line-height:1.6;white-space:pre-wrap;word-break:break-all}',
	].join('\n')
	document.head.appendChild(style)
}

export type PerfDiagnostics = () => Promise<string[]>

/**
 * 計測結果のパネルを開く（左上の「計測結果をみる」ボタンから呼ばれる）。
 * 開くたびに、その時点の内容で作り直す（開いたまま、もう一度押しても重ならない）。
 */
export function perfShowReport({ page, diagnostics }: { page?: string; diagnostics?: PerfDiagnostics }): void {
	const existing = document.getElementById('perf-report')
	if (existing) existing.remove()

	const { text: baseText } = buildReport(page || location.hash || 'page')
	let fullText = baseText
	window.__perfReport = fullText
	console.log(baseText)

	injectStyle()
	const wrap = document.createElement('div')
	wrap.id = 'perf-report'
	const diagButton = diagnostics ? '<button type="button" data-act="diag">通信診断を実行</button>' : ''
	wrap.innerHTML =
		'<div class="perf-box">' +
		'<div class="perf-head"><span>読み込み計測（管理者のみ）</span>' +
		'<span>' +
		diagButton +
		'<button type="button" data-act="copy">コピー</button>' +
		'<button type="button" data-act="close">閉じる</button></span></div>' +
		'<pre></pre>' +
		'</div>'
	const pre = wrap.querySelector('pre') as HTMLPreElement
	pre.textContent = fullText

	wrap.addEventListener('click', async (e) => {
		const target = e.target as HTMLElement | null
		const act = target && target.getAttribute && target.getAttribute('data-act')
		if (act === 'close' || target === wrap) wrap.remove()
		if (act === 'copy' && target) {
			try {
				await navigator.clipboard.writeText(fullText)
				target.textContent = 'コピーしました'
			} catch {
				target.textContent = 'コピー失敗'
			}
		}
		if (act === 'diag' && diagnostics && target) {
			;(target as HTMLButtonElement).disabled = true
			target.textContent = '診断中...（最大1〜2分）'
			let lines: string[]
			try {
				lines = await diagnostics()
			} catch (err) {
				lines = ['診断に失敗しました: ' + (err instanceof Error ? err.message : String(err))]
			}
			fullText = fullText + '\n\n■ 通信診断\n' + lines.join('\n')
			window.__perfReport = fullText
			pre.textContent = fullText
			target.textContent = '診断完了'
		}
	})
	document.body.appendChild(wrap)
}

/**
 * 読み込みが終わったときに呼ぶ。管理者にだけ、画面左上の通知欄に「計測結果をみる」ボタンを1分間出す。
 * 押すと、その時点の計測結果パネルが開く。1回だけ作る（読み込み完了の処理が複数回呼ばれても、ボタンは増えない）。
 */
export function perfNotifyReportAvailable({
	isAdmin,
	page,
	diagnostics,
}: {
	isAdmin: boolean
	page?: string
	diagnostics?: PerfDiagnostics
}): void {
	if (reportNotified) return
	reportNotified = true
	if (!isAdmin) return

	const badge = createButtonBadge('計測結果をみる', () => perfShowReport({ page, diagnostics }), 9)
	badge.show()
	setTimeout(() => badge.remove(), 60 * 1000) // 1分たったらフェードアウトして消す
}
