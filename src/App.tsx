import { Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { PerfRouteWatcher } from './components/PerfRouteWatcher'
import LoginPage from './pages/LoginPage'
import RoomListPage from './pages/RoomListPage'
import { NotFoundPlaceholder, TalkPlaceholder } from './pages/Placeholders'

// ★ ルート（仕様書 §6.1）。旧URLとの対応：
//   index.html → #/login（ログインしていれば #/ へ）  /  app.html → #/  /  talk.html?id=ID → #/talk/ID
//   旧URLは、public/ の小さなリダイレクト用ファイルが、新しいルートに変換する。
export default function App() {
	return (
		<>
			<PerfRouteWatcher />
			<Routes>
				<Route path="/login" element={<LoginPage />} />
				<Route
					path="/"
					element={
						<RequireAuth page="app">
							<RoomListPage />
						</RequireAuth>
					}
				/>
				<Route
					path="/talk/:roomId"
					element={
						<RequireAuth page="login">
							<TalkPlaceholder />
						</RequireAuth>
					}
				/>
				<Route path="*" element={<NotFoundPlaceholder />} />
			</Routes>
		</>
	)
}
