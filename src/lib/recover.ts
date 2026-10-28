// ★ 読み込みが止まったときの診断と復旧（既存の recover.js と同じ内容）。
//   「別のブラウザでは一瞬で開くのに、このブラウザだけ止まる」場合は、そのブラウザに保存されている
//   Firebase のログイン情報（IndexedDB / localStorage）の不整合や、ブラウザ設定・拡張機能による通信/保存のブロックが疑われる。

/** ブラウザの保存領域・通信の状態を調べて、1行の文字列で返す（約3秒で打ち切る）。 */
export async function probeEnvironment(): Promise<string> {
	const parts: string[] = []

	// IndexedDB（FirebaseのログインはここにIDを保存する）。実際のFirebase用DBには触れず、専用の仮DBで確認する
	const idb = await new Promise<string>((resolve) => {
		if (!window.indexedDB) return resolve('使えません')
		let finished = false
		const timer = setTimeout(() => {
			if (!finished) {
				finished = true
				resolve('応答なし(3秒)')
			}
		}, 3000)
		const done = (text: string) => {
			if (finished) return
			finished = true
			clearTimeout(timer)
			resolve(text)
		}
		try {
			const request = indexedDB.open('perf-probe-db')
			request.onsuccess = () => {
				try {
					request.result.close()
					indexedDB.deleteDatabase('perf-probe-db')
				} catch {
					/* 無視 */
				}
				done('OK')
			}
			request.onerror = () => done('エラー(' + (request.error && request.error.name) + ')')
			request.onblocked = () => done('ブロックされています')
		} catch (e) {
			done('例外(' + (e instanceof Error ? e.name : String(e)) + ')')
		}
	})
	parts.push('IndexedDB: ' + idb)

	try {
		localStorage.setItem('perf-probe', '1')
		localStorage.removeItem('perf-probe')
		parts.push('localStorage: OK')
	} catch {
		parts.push('localStorage: 使えません')
	}

	parts.push('Cookie: ' + (navigator.cookieEnabled ? '有効' : '無効'))
	parts.push(
		'ServiceWorker: ' +
			('serviceWorker' in navigator ? (navigator.serviceWorker.controller ? '稼働中' : 'なし') : '非対応'),
	)
	parts.push('オンライン: ' + (navigator.onLine ? 'はい' : 'いいえ'))
	return parts.join(' / ')
}

/**
 * このブラウザに残っている Firebase のログイン情報を消して、ログイン画面からやり直す。
 * 新UI/旧UIの設定（uiMode）は消さない。
 */
export async function resetLoginState(): Promise<void> {
	try {
		;['firebaseLocalStorageDb', 'firebase-installations-database', 'firebase-heartbeat-database'].forEach((name) => {
			try {
				indexedDB.deleteDatabase(name)
			} catch {
				/* 無視 */
			}
		})
	} catch {
		/* 無視 */
	}
	try {
		Object.keys(localStorage)
			.filter((k) => k.startsWith('firebase:'))
			.forEach((k) => localStorage.removeItem(k))
		Object.keys(sessionStorage)
			.filter((k) => k.startsWith('firebase:'))
			.forEach((k) => sessionStorage.removeItem(k))
	} catch {
		/* 無視 */
	}
	// 他の接続が残っていると削除が待たされることがあるので、少し待ってからログイン画面へ移る
	await new Promise((resolve) => setTimeout(resolve, 600))
	// Firebase を最初から初期化し直すため、ハッシュを変えたあとに、ページを読み込み直す
	location.hash = '#/login'
	location.reload()
}
