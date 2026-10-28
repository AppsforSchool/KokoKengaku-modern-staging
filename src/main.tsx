import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import './styles' // すべてのCSS（順序が大切なので、1か所で読み込む）
import { DialogProvider } from './ui/DialogProvider'
import { UiModeProvider } from './ui/UiModeProvider'
import { perfMark } from './lib/perf'

perfMark('JSモジュールの読み込み・実行開始（HTML解析・Firebase等の取得）')

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<UiModeProvider>
			<AuthProvider>
				<DialogProvider>
					<HashRouter>
						<App />
					</HashRouter>
				</DialogProvider>
			</AuthProvider>
		</UiModeProvider>
	</StrictMode>,
)
