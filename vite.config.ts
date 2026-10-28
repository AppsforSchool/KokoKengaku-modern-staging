import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { scopeCssPlugin } from './build/scopeCss'

// ★ base は、公開先のパスに合わせる。
//   検証用  https://appsforschool.github.io/KokoKengaku-modern-staging/  → '/KokoKengaku-modern-staging/'（既定）
//   本番    https://appsforschool.github.io/KokoKengaku-modern-/         → '/KokoKengaku-modern-/'
//   本番用にビルドするときは、環境変数 VITE_BASE=/KokoKengaku-modern-/ を付ける（リポジトリ名の末尾の「-」に注意）。
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '')
	const base = env.VITE_BASE || '/KokoKengaku-modern-staging/'
	return {
		base,
		plugins: [scopeCssPlugin(), react()],
	}
})
