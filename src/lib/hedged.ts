// ★ 読み取りが「返ってこない」ときの再送（既存の firebase.js の hedged と同じ動き）。
//   計測で、読み取りが1本だけ約30秒止まる（同じ時間に出した別の読み取りは0.1秒で返る）ことがあったため、
//   hedgeMs 待っても結果が来なければ、同じ読み取りをもう1本出し直し、先に返ったほうを使う
//   （最初の1本は止めずに残す。最大 maxAttempts 本）。すべて失敗したときだけエラーにする。
//   使い方：  await hedged(() => getDoc(doc(db, "a", "b")))
import { perfSample } from './perf'

export interface HedgedOptions {
	hedgeMs?: number
	maxAttempts?: number
}

export function hedged<T>(fn: () => T | Promise<T>, { hedgeMs = 4000, maxAttempts = 3 }: HedgedOptions = {}): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false
		let attempts = 0
		let failures = 0
		let timer: ReturnType<typeof setTimeout> | undefined

		const launch = () => {
			attempts++
			if (attempts > 1) perfSample('読み取りの再送（待っても返らず出し直した回数）', hedgeMs)
			Promise.resolve()
				.then(() => fn())
				.then(
					(value) => {
						if (settled) return
						settled = true
						clearTimeout(timer)
						resolve(value as unknown as T)
					},
					(error: unknown) => {
						failures++
						if (settled) return
						if (failures >= attempts) {
							// 動いているものが無くなった
							clearTimeout(timer)
							if (attempts >= maxAttempts) {
								settled = true
								reject(error)
							} else launch()
						}
					},
				)
			if (attempts < maxAttempts) {
				clearTimeout(timer)
				timer = setTimeout(() => {
					if (!settled) launch()
				}, hedgeMs)
			}
		}
		launch()
	})
}
