// ★ Firestoreの通信診断（管理者の計測パネルの「通信診断を実行」ボタンから呼ばれる）。既存の diag.js と同じ内容。
//   同じデータを違う読み方で取得して、どれが遅いのかを比べる。すべて「サーバーから」取得する（キャッシュは使わない）。
//   2周して、毎回遅いのか・たまに遅いのかも見えるようにしている。
import {
	auth,
	collection,
	db,
	doc,
	documentId,
	firestoreTransport,
	getCountFromServer,
	getDocFromServer,
	getDocsFromServer,
	query,
	where,
} from '../firebase'
import { firebaseConfig } from '../firebaseConfig'
import { getPushInitStatus } from './push'

const fmt = (ms: number): string => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' 秒' : Math.round(ms) + ' ms')

function messageOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

async function timed(label: string, fn: () => Promise<string | void>): Promise<string> {
	const t = performance.now()
	try {
		const detail = await fn()
		return `${label}: ${fmt(performance.now() - t)}${detail ? ' （' + detail + '）' : ''}`
	} catch (e) {
		return `${label}: 失敗 ${fmt(performance.now() - t)} （${messageOf(e)}）`
	}
}

// ★ Firestore SDK を通さず（全フィールドを取得するので、実際のデータ量も分かる）、普通のHTTPS（REST API）で同じユーザー一覧を取得する。
//   SDKの読み取りだけが遅く、これが速ければ「SDKが使うストリーム接続が途中で詰まっている」と判断できる。
async function restFetchUsers(): Promise<string> {
	if (!auth.currentUser) throw new Error('ログインしていません')
	const token = await auth.currentUser.getIdToken()
	const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users_random?pageSize=100`
	const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
	if (!res.ok) throw new Error('HTTP ' + res.status)
	const text = await res.text() // ★ 全フィールドを取得し、データ量（KB）も出す
	const json = JSON.parse(text) as { documents?: unknown[] }
	return `${(json.documents || []).length}件 / 約${Math.round(text.length / 1024)}KB`
}

interface NetworkInformationLike {
	type?: string
	effectiveType?: string
	rtt?: number
	downlink?: number
	saveData?: boolean
}

export async function runFirestoreDiagnostics(myUserId: string): Promise<string[]> {
	// ※ 既存の表示は「URLに ?fs=… を付けると切り替え可」だったが、切り替えは移していないため、固定と表示する
	const lines = [`通信方式: ${firestoreTransport}（固定）`]
	const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
	lines.push(`ブラウザ: ${navigator.userAgent}`)
	lines.push(
		`回線情報: ${
			conn
				? `type=${conn.type || '?'} effectiveType=${conn.effectiveType || '?'} rtt=${conn.rtt ?? '?'}ms downlink=${conn.downlink ?? '?'}Mbps saveData=${!!conn.saveData}`
				: '取得不可'
		}`,
	)
	lines.push(`OneSignal初期化: ${getPushInitStatus()}`)
	const oneSignalRes = performance.getEntriesByType('resource').filter((r) => r.name.includes('onesignal'))
	lines.push(
		'OneSignal関連の通信: ' +
			(oneSignalRes.length
				? oneSignalRes.map((r) => `${(r.name.split('/').pop() || '').split('?')[0]} ${Math.round(r.duration)}ms`).join(' , ')
				: '記録なし（SDKが読み込まれていない、またはブロックされている可能性）'),
	)
	const gapiRes = performance
		.getEntriesByType('resource')
		.filter((r) => r.name.includes('apis.google.com') || r.name.includes('/__/auth/iframe'))
	lines.push(
		'Googleの認証用iframe/スクリプト: ' +
			(gapiRes.length ? `${gapiRes.length}件あり（initializeAuth版が反映されていれば0件のはず）` : 'なし（正常）'),
	)
	let ids: string[] = []
	for (let round = 1; round <= 2; round++) {
		lines.push(`--- ${round}周目 ---`)
		lines.push(
			await timed('① 単体 getDoc（自分のユーザー文書）', async () => {
				await getDocFromServer(doc(db, 'users_random', myUserId))
			}),
		)
		lines.push(
			await timed('② コレクション全件 getDocs（users_random）', async () => {
				const snap = await getDocsFromServer(collection(db, 'users_random'))
				ids = snap.docs.map((d) => d.id).slice(0, 9)
				return `${snap.size}件`
			}),
		)
		lines.push(
			await timed(`③ "in" クエリ（${ids.length}件）`, async () => {
				if (ids.length === 0) return '対象なし'
				await getDocsFromServer(query(collection(db, 'users_random'), where(documentId(), 'in', ids)))
			}),
		)
		lines.push(
			await timed(`④ getDoc を並列（${ids.length}件）`, async () => {
				await Promise.all(ids.map((id) => getDocFromServer(doc(db, 'users_random', id))))
			}),
		)
		lines.push(
			await timed('⑤ count集計（SDK内のREST通信）', async () => {
				const s = await getCountFromServer(collection(db, 'users_random'))
				return `${s.data().count}件`
			}),
		)
		lines.push(await timed('⑥ 素のHTTPS(REST)でユーザー一覧取得（SDKを使わない）', restFetchUsers))
	}
	return lines
}
