// ★★ このファイルの Auth の初期化は、既存サイト（問題投稿・T-each・旧チャット）の firebase.js と同じにしてある。
//   同じオリジン（appsforschool.github.io）で動くサイトは、Authの初期化設定とSDKのバージョンを揃えないと、
//   片方を開いただけで全サイトがログアウトになる。変更するときは、必ず全サイト同時に変更すること。
//   ・SDKのバージョン：12.14.0（package.json で固定）
//   ・アプリ名は付けない（既定の "[DEFAULT]"）
//   ・getAuth() ではなく initializeAuth()。保存先は localStorage →（無理なら）sessionStorage → メモリ
//     （IndexedDB は候補に入れない。Safariで最初のアクセスが約10秒止まることがあるため）
//   ・Firestoreは、ロングポーリング固定・永続キャッシュなし（学校のネットワークで読み取りが止まる対策）
//   ※ 既存の firebase.js にあった ?fs=（通信方式の切り替え）と ?cache=（永続キャッシュ）は、テスト用の機能のため、移していない。
import { getApp, getApps, initializeApp } from 'firebase/app'
import {
	browserLocalPersistence,
	browserSessionPersistence,
	getAuth,
	inMemoryPersistence,
	initializeAuth,
	onAuthStateChanged,
	signInWithEmailAndPassword,
	signOut,
	type Auth,
} from 'firebase/auth'
import {
	Timestamp,
	addDoc,
	arrayRemove,
	arrayUnion,
	collection,
	doc,
	documentId,
	getCountFromServer,
	getDoc,
	getDocFromServer,
	getDocs,
	getDocsFromServer,
	getFirestore,
	initializeFirestore,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	where,
	writeBatch,
	type Firestore,
} from 'firebase/firestore'
import { firebaseConfig } from './firebaseConfig'

// ★ アプリ名は付けない（既定の "[DEFAULT]"）。
//   ログイン情報の保存キーは "firebase:authUser:<APIキー>:[DEFAULT]" になり、同じ appsforschool.github.io の下にある
//   すべてのサイトで同じキーを使う ＝ どれか1つのサイトでログインすれば、全サイトでログイン状態になる。
//   開発中のホットリロードで、この初期化が2回走っても落ちないようにしている。
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)

// ★ ログイン情報の保存先は、全ブラウザで localStorage にする（既存サイトと同じ）。
//   ※ ログアウトすると、全サイトで同時にログアウトになる（保存キーを共有しているため。仕様）。
export const authStorageMode = 'local' as const

// ★ 診断用：「しばらくしてから開くと再ログインになる」原因を切り分けるための記録（既存サイトと同じ）。
//   端末の localStorage（キー authDebugLog、直近30件）に残す。
//   確認方法：URLに ?authdebug=1 を付けて開くと、記録が表示される（ログアウト状態でも可）。
//   例）…/KokoKengaku-modern-staging/?authdebug=1#/login
const AUTH_STORAGE_KEY = `firebase:authUser:${firebaseConfig.apiKey}:[DEFAULT]`
const AUTH_DEBUG_LOG_KEY = 'authDebugLog'

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

function appendAuthDebug(entry: Record<string, unknown>): void {
	try {
		const log = JSON.parse(localStorage.getItem(AUTH_DEBUG_LOG_KEY) || '[]') as unknown[]
		log.push({ at: new Date().toISOString(), page: location.pathname.split('/').pop() || '/', hash: location.hash, ...entry })
		localStorage.setItem(AUTH_DEBUG_LOG_KEY, JSON.stringify(log.slice(-30)))
	} catch {
		/* 診断用なので失敗しても何もしない */
	}
}

function readStoredAuthInfo(): Record<string, unknown> {
	try {
		const raw = localStorage.getItem(AUTH_STORAGE_KEY)
		if (raw === null) return { stored: false }
		const user = JSON.parse(raw) as {
			stsTokenManager?: { refreshToken?: string; expirationTime?: number | string }
			lastLoginAt?: number | string
		}
		const tm = user.stsTokenManager || {}
		return {
			stored: true,
			hasRefreshToken: !!tm.refreshToken,
			tokenExpiresAt: tm.expirationTime ? new Date(Number(tm.expirationTime)).toISOString() : null,
			lastLoginAt: user.lastLoginAt ? new Date(Number(user.lastLoginAt)).toISOString() : null,
		}
	} catch (e) {
		return { stored: null, error: errorText(e) } // localStorageが読めない
	}
}

function listFirebaseKeys(): string[] | null {
	try {
		return Object.keys(localStorage)
			.filter((k) => k.startsWith('firebase:'))
			.map((k) => k.replace(/^firebase:authUser:[^:]+:/, 'authUser:'))
	} catch {
		return null
	}
}

// ★ initializeAuth より前に記録する（SDKが書き換える前の状態）
appendAuthDebug({
	event: '起動時',
	mode: authStorageMode,
	usingKey: AUTH_STORAGE_KEY.replace(/^firebase:authUser:[^:]+:/, 'authUser:'),
	firebaseKeysInLocalStorage: listFirebaseKeys(),
	...readStoredAuthInfo(),
})

// ★ Auth は getAuth() ではなく initializeAuth() で初期化する（理由は、このファイルの先頭と、既存の firebase.js のとおり）。
//   getAuth() が呼ばれるのは、すでに初期化済みのとき（開発中のホットリロード）だけ。
function createAuth(): Auth {
	try {
		return initializeAuth(app, {
			persistence: [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
		})
	} catch {
		return getAuth(app)
	}
}
export const auth = createAuth()

onAuthStateChanged(auth, (user) => {
	appendAuthDebug({ event: 'Auth判定', mode: authStorageMode, loggedIn: !!user })
	if (user) {
		// ログイン済みのとき、情報が実際にどの保存先に書かれたか（localStorage / sessionStorage）を少し後で確認する。
		// localStorageに無くsessionStorageにある場合は、localStorageが使えず、タブを閉じると消える状態になっている。
		setTimeout(() => {
			try {
				appendAuthDebug({
					event: '保存先の確認',
					inLocalStorage: localStorage.getItem(AUTH_STORAGE_KEY) !== null,
					inSessionStorage: sessionStorage.getItem(AUTH_STORAGE_KEY) !== null,
				})
			} catch (e) {
				appendAuthDebug({ event: '保存先の確認', error: errorText(e) })
			}
		}, 1500)
	}
})

// ★ このページを開いたまま、他のページ（別タブ・別サイト）が localStorage を変更したら記録する。
//   ・key が null のとき ＝ 他のページが localStorage.clear() を呼んだ（保存内容がすべて消える）
//   ・Firebase のログイン情報のキーが変更/削除されたとき ＝ どのキーで、どのページ(url)からかを記録する（値は記録しない）
window.addEventListener('storage', (e) => {
	if (e.storageArea !== localStorage) return
	if (e.key === null) {
		appendAuthDebug({ event: '他のページが localStorage.clear() を実行した', fromUrl: e.url || '' })
	} else if (e.key.startsWith('firebase:')) {
		appendAuthDebug({
			event: e.newValue === null ? '他のページがFirebaseのキーを削除した' : '他のページがFirebaseのキーを書き換えた',
			key: e.key.replace(/^firebase:authUser:[^:]+:/, 'authUser:'),
			isOurKey: e.key === AUTH_STORAGE_KEY,
			fromUrl: e.url || '',
		})
	}
})

try {
	if (new URLSearchParams(location.search).get('authdebug')) {
		window.addEventListener('load', () =>
			setTimeout(() => {
				const log = JSON.parse(localStorage.getItem(AUTH_DEBUG_LOG_KEY) || '[]') as unknown[]
				alert(
					'【ログイン状態の記録（新しい順）】\n' +
						log
							.slice()
							.reverse()
							.map((e) => JSON.stringify(e))
							.join('\n'),
				)
			}, 1500),
		)
	}
} catch {
	/* 無視 */
}

// ★ Firestoreの通信方式：常にロングポーリング。
//   学校などのネットワークでは、通常の方式（WebChannel）の読み取りだけが数十秒止まることがあったため。
//   永続キャッシュ（IndexedDB）は、スマホ（特にiOS）で読み込みが止まる例があったため、使わない。
export const firestoreTransport = 'long' as const
export const firestoreCacheMode = 'off' as const

function createDb(): Firestore {
	try {
		return initializeFirestore(app, { experimentalForceLongPolling: true })
	} catch (e) {
		console.warn('Firestoreの初期化設定に失敗しました:', e) // すでに初期化済み（開発中のホットリロード）など
		return getFirestore(app)
	}
}
export const db = createDb()

export { hedged } from './lib/hedged'

export {
	onAuthStateChanged,
	signInWithEmailAndPassword,
	signOut,
	collection,
	doc,
	getDoc,
	getDocs,
	addDoc,
	setDoc,
	updateDoc,
	query,
	where,
	orderBy,
	onSnapshot,
	writeBatch,
	getCountFromServer,
	serverTimestamp,
	arrayUnion,
	arrayRemove,
	Timestamp,
	documentId,
	getDocFromServer,
	getDocsFromServer,
}
