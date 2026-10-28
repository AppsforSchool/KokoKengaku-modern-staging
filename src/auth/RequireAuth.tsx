import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { LoadingOverlay } from '../components/LoadingOverlay'
import { PageShell } from '../components/PageShell'
import { useAuth } from './AuthProvider'

/**
 * ログインしていない人を、ログイン画面（#/login）に送る。ログイン後は、元の画面に戻る。
 * ログイン状態が確定するまでの間は、読み込み画面を出す。
 * page … 読み込み画面の見た目に使うCSS（ページ名）。各ページのCSSを移したら、そのページ名に変える。
 */
export function RequireAuth({ page, children }: { page: string; children: ReactNode }) {
	const { user, loading } = useAuth()
	const location = useLocation()

	if (loading) {
		return (
			<PageShell name={page}>
				<LoadingOverlay text="システムの読み込みに時間がかかる場合があります｡" watchStall />
			</PageShell>
		)
	}
	if (!user) {
		// 元の場所（パスと検索パラメータ）を覚えておき、ログイン後に戻す
		return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
	}
	return <>{children}</>
}
