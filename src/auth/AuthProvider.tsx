import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { auth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from '../firebase'
import { perfMark } from '../lib/perf'

// ★ ログインIDは、内部では「ID@appsforschool.com」のメールアドレスとして扱う（既存サイトと同じ）。
const EMAIL_DOMAIN = '@appsforschool.com'

interface AuthValue {
	/** Firebaseのユーザー。ログインしていなければ null。 */
	user: User | null
	/** ログインID（メールアドレスの @ より前）。ログインしていなければ null。 */
	userId: string | null
	/** ログイン状態がまだ確定していない間は true。 */
	loading: boolean
	login: (id: string, password: string) => Promise<void>
	/** ログアウトする（全サイトで同時にログアウトになる。仕様）。通知の解除は、PushProvider を作るときに加える。 */
	logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		let first = true
		return onAuthStateChanged(auth, (next) => {
			if (first) {
				first = false
				perfMark('ログイン状態の確定（Firebase Auth）')
			}
			setUser(next)
			setLoading(false)
		})
	}, [])

	const login = useCallback(async (id: string, password: string) => {
		await signInWithEmailAndPassword(auth, `${id}${EMAIL_DOMAIN}`, password)
	}, [])

	const logout = useCallback(async () => {
		await signOut(auth)
	}, [])

	const value = useMemo<AuthValue>(
		() => ({
			user,
			userId: user && user.email ? user.email.split('@')[0] : null,
			loading,
			login,
			logout,
		}),
		[user, loading, login, logout],
	)

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
	const value = useContext(AuthContext)
	if (!value) throw new Error('useAuth は AuthProvider の中で使ってください')
	return value
}
