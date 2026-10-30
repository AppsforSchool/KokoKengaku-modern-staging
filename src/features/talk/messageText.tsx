import { Fragment, type ReactNode } from 'react'

// ★ メッセージ本文の表示（既存の talkScript.js の sanitizeHtmlToOnlyLinks 一式と同じ挙動）。
//   本文は、許可したタグだけを残して表示する。それ以外のタグは取り除き、中身の文字だけを表示する。
//   ・<link>URL</link> … リンクにする（http(s) 以外の形式は、リンクにせず文字だけ）
//   ・<a href>        … 安全なリンク先（isSafeHref）のときだけ、リンクにする
//   ・<underline> <large> <maincolor> <small> <emoji> … それぞれの装飾
//   既存は DOM を直接作っていたが、ここでは同じ構造の React の要素を作る（文字は、React が自動でエスケープする）。

/** 引用元などに使う、タグを除いたプレーンテキスト。 */
export function stripTagsToPlainText(htmlString: string): string {
	const doc = new DOMParser().parseFromString(htmlString, 'text/html')
	return (doc.body.textContent || '').trim()
}

/** <link> の中身の文字を、リンク先のURLにする。リンクにできないときは null。 */
export function normalizeLinkUrl(text: string): string | null {
	const url = String(text || '').trim()
	if (!url || /\s/.test(url)) return null
	if (/^https?:\/\//i.test(url)) return url
	if (/^[a-z][a-z0-9+.\-]*:(?!\d)/i.test(url)) return null // javascript: など（example.com:8080 のようなポート指定は除く）
	return 'https://' + url.replace(/^\/\//, '')
}

/**
 * <a href="..."> のリンク先として許可してよいかを判定する。
 * ・許可：http: / https: / mailto: / tel: と、スキームのない相対リンク
 * ・不許可：javascript: / data: / vbscript: など
 * ブラウザは、スキームの途中の空白・改行・制御文字を無視して解釈するため、判定の前に取り除く。
 */
export function isSafeHref(rawHref: string | null | undefined): boolean {
	// eslint-disable-next-line no-control-regex
	const compact = String(rawHref || '').replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
	const scheme = compact.match(/^([a-z][a-z0-9+.\-]*):/i)
	if (!scheme) return true // スキームなし＝相対リンク
	return ['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase())
}

/**
 * <link>URL</link> の記法を、<a href="URL">URL</a> に展開する（パースの前処理）。
 * <link> は HTML では「中身を持たない特別なタグ」で、そのままパースすると脱落してしまうため、文字列の段階で置き換える。
 */
export function expandLinkTags(rawMessage: string): string {
	return String(rawMessage).replace(/<link>([\s\S]*?)<\/link>/gi, (_whole, inner: string) => {
		const url = normalizeLinkUrl(stripTagsToPlainText(inner))
		if (!url) return inner // リンクにできないときは、<link> だけを取り除く
		const safeHref = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		return `<a href="${safeHref}">${inner}</a>`
	})
}

const SPAN_CLASS_BY_TAG: Record<string, string> = {
	UNDERLINE: 'underline',
	LARGE: 'large',
	MAINCOLOR: 'main-color',
	SMALL: 'small',
	EMOJI: 'emoji',
}

function processChildren(node: Node): ReactNode[] {
	const result: ReactNode[] = []
	node.childNodes.forEach((child, index) => {
		const processed = processNode(child)
		if (processed !== null) result.push(<Fragment key={index}>{processed}</Fragment>)
	})
	return result
}

function processNode(node: Node): ReactNode {
	// 1. テキストノード：そのまま文字
	if (node.nodeType === Node.TEXT_NODE) return node.textContent

	// 2. 要素ノード
	if (node.nodeType === Node.ELEMENT_NODE) {
		const element = node as Element
		const tagName = element.tagName.toUpperCase()

		if (tagName === 'A') {
			const rawHref = element.getAttribute('href') || '#'
			if (isSafeHref(rawHref)) {
				return (
					<a className="chat-link" href={rawHref} target="_blank" rel="noopener noreferrer">
						{processChildren(element)}
					</a>
				)
			}
			// javascript: など危険なリンク先は、リンクにせず、文字だけを表示する
			return <span>{processChildren(element)}</span>
		}
		const spanClass = SPAN_CLASS_BY_TAG[tagName]
		if (spanClass) return <span className={spanClass}>{processChildren(element)}</span>

		// 許可されていない未知のタグ（<div>・<p> など）：タグ自体は無視し、中身だけを平坦化して返す
		return <>{processChildren(element)}</>
	}
	return null
}

/** メッセージ本文（タグ入りの文字列）を、表示用の要素にする。 */
export function renderMessageText(message: string): ReactNode {
	const doc = new DOMParser().parseFromString(expandLinkTags(message), 'text/html')
	return <>{processChildren(doc.body)}</>
}
