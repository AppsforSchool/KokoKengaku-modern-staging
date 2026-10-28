import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { perfBeginPage } from '../lib/perf'

/**
 * 画面を移ったとき、新しい画面の計測を始める（lib/perf.ts の perfBeginPage）。画面には何も出さない。
 * 既存のサイトは、画面ごとにページを読み込み直していたため、計測も画面ごとに0から始まっていた。それを再現する。
 */
export function PerfRouteWatcher() {
	const location = useLocation()
	useEffect(() => {
		perfBeginPage(location.key)
	}, [location.key])
	return null
}
