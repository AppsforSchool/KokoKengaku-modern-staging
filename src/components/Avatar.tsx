import { useEffect, useRef } from 'react'
import type { ImageGroupTracker } from '../lib/statusBadge'

/** アバターの頭文字を安全に取り出す（既存の getInitial と同じ）。 */
export function getInitial(name: string | undefined | null): string {
	if (!name) return '?'
	return Array.from(name.trim())[0] || '?'
}

interface Props {
	name?: string
	/** "small" | "large" | 省略で通常サイズ */
	size?: 'small' | 'large'
	imageUrl?: string
	/** 画像の読み込み状況を数える部品（statusBadge の createImageGroupTracker）。画像があるときだけ数える。 */
	tracker?: ImageGroupTracker
	/** 追加のクラス（例：clickable-user）。 */
	extraClassName?: string
	onClick?: () => void
}

/** 頭文字アバター、または画像アバター（既存の createAvatar と同じHTML構造・クラス）。 */
export function Avatar({ name, size, imageUrl, tracker, extraClassName, onClick }: Props) {
	const className = ['avatar-circle', size, extraClassName].filter(Boolean).join(' ')
	const imgRef = useRef<HTMLImageElement>(null)

	// 画像は、作った時点で数える（読み込み画面を閉じたあとに作られたものは、tracker 側が数えない）
	useEffect(() => {
		if (tracker && imgRef.current) tracker.track(imgRef.current)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	if (imageUrl) return <img ref={imgRef} className={className} src={imageUrl} alt={name || ''} onClick={onClick} />
	return (
		<div className={className} onClick={onClick}>
			{getInitial(name)}
		</div>
	)
}
