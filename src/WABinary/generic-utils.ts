import { Boom } from '@hapi/boom'
import { proto } from '../../WAProto/index.js'
import { unixTimestampSeconds } from '../Utils/generics'
import { type BinaryNode } from './types'

// some extra useful utilities

const indexCache = new WeakMap<BinaryNode, Map<string, BinaryNode[]>>()

export const getBinaryNodeChildren = (node: BinaryNode | undefined, childTag: string) => {
	if (!node || !Array.isArray(node.content)) return []

	let index = indexCache.get(node)

	// Build the index once per node
	if (!index) {
		index = new Map<string, BinaryNode[]>()

		for (const child of node.content) {
			let arr = index.get(child.tag)
			if (!arr) index.set(child.tag, (arr = []))
			arr.push(child)
		}

		indexCache.set(node, index)
	}

	// Return first matching child
	return index.get(childTag) || []
}

export const getBinaryNodeChild = (node: BinaryNode | undefined, childTag: string) => {
	return getBinaryNodeChildren(node, childTag)[0]
}

export const getAllBinaryNodeChildren = ({ content }: BinaryNode) => {
	if (Array.isArray(content)) {
		return content
	}

	return []
}

export const getBinaryNodeChildBuffer = (node: BinaryNode | undefined, childTag: string) => {
	const child = getBinaryNodeChild(node, childTag)?.content
	if (Buffer.isBuffer(child) || child instanceof Uint8Array) {
		return child
	}
}

export const getBinaryNodeChildString = (node: BinaryNode | undefined, childTag: string) => {
	const child = getBinaryNodeChild(node, childTag)?.content
	if (Buffer.isBuffer(child) || child instanceof Uint8Array) {
		return Buffer.from(child).toString('utf-8')
	} else if (typeof child === 'string') {
		return child
	}
}

export const getBinaryNodeChildUInt = (node: BinaryNode, childTag: string, length: number) => {
	const buff = getBinaryNodeChildBuffer(node, childTag)
	if (buff) {
		return bufferToUInt(buff, length)
	}
}

export const assertNodeErrorFree = (node: BinaryNode) => {
	const errNode = getBinaryNodeChild(node, 'error')
	if (errNode) {
		throw new Boom(errNode.attrs.text || 'Unknown error', { data: +errNode.attrs.code! })
	}
}

export const reduceBinaryNodeToDictionary = (node: BinaryNode, tag: string) => {
	const nodes = getBinaryNodeChildren(node, tag)
	const dict = nodes.reduce(
		(dict, { attrs }) => {
			if (typeof attrs.name === 'string') {
				dict[attrs.name] = attrs.value! || attrs.config_value!
			} else {
				dict[attrs.config_code!] = attrs.value! || attrs.config_value!
			}

			return dict
		},
		{} as { [_: string]: string }
	)
	return dict
}

export const getBinaryNodeMessages = ({ content }: BinaryNode) => {
	const msgs: proto.WebMessageInfo[] = []
	if (Array.isArray(content)) {
		for (const item of content) {
			if (item.tag === 'message') {
				msgs.push(proto.WebMessageInfo.decode(item.content as Buffer).toJSON() as proto.WebMessageInfo)
			}
		}
	}

	return msgs
}

function bufferToUInt(e: Uint8Array | Buffer, t: number) {
	let a = 0
	for (let i = 0; i < t; i++) {
		a = 256 * a + e[i]!
	}

	return a
}

const tabs = (n: number) => '\t'.repeat(n)

export function binaryNodeToString(node: BinaryNode | BinaryNode['content'], i = 0): string {
	if (!node) {
		return node!
	}

	if (typeof node === 'string') {
		return tabs(i) + node
	}

	if (node instanceof Uint8Array) {
		return tabs(i) + Buffer.from(node).toString('hex')
	}

	if (Array.isArray(node)) {
		return node.map(x => tabs(i + 1) + binaryNodeToString(x, i + 1)).join('\n')
	}

	const children = binaryNodeToString(node.content, i + 1)

	const tag = `<${node.tag} ${Object.entries(node.attrs || {})
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `${k}='${v}'`)
		.join(' ')}`

	const content: string = children ? `>\n${children}\n${tabs(i)}</${node.tag}>` : '/>'

	return tag + content
}

export const getBinaryNodeFilter = (node: BinaryNode[] | undefined): boolean => {
	if (!Array.isArray(node)) return false

	return node.some(item => {
		const content = item.content as BinaryNode[] | undefined
		const innerContent = content?.[0]?.content as BinaryNode[] | undefined
		return (
			(innerContent?.[0]?.tag && ['native_flow'].includes(innerContent[0].tag)) ||
			(content?.[0]?.tag && ['interactive', 'buttons', 'list'].includes(content[0].tag)) ||
			['hsm', 'biz'].includes(item.tag) ||
			(item.tag === 'bot' && item.attrs?.biz_bot === '1')
		)
	})
}

export const getButtonType = (message: proto.IMessage): string | undefined => {
	if (message.listMessage) {
		return 'list'
	} else if (message.buttonsMessage) {
		return 'buttons'
	} else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'review_and_pay') {
		return 'review_and_pay'
	} else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'review_order') {
		return 'review_order'
	} else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'payment_info') {
		return 'payment_info'
	} else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'payment_status') {
		return 'payment_status'
	} else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'payment_method') {
		return 'payment_method'
	} else if (message.interactiveMessage && message.interactiveMessage?.nativeFlowMessage) {
		return 'interactive'
	}

	return undefined
}

export const getAdditionalNode = (name: string): BinaryNode[] => {
	name = name.toLowerCase()
	const ts = unixTimestampSeconds(new Date()) - 77980457

	const orderResponseName: Record<string, string> = {
		review_and_pay: 'order_details',
		review_order: 'order_status',
		payment_info: 'payment_info',
		payment_status: 'payment_status',
		payment_method: 'payment_method'
	}

	const flowName: Record<string, string> = {
		cta_catalog: 'cta_catalog',
		mpm: 'mpm',
		call_request: 'call_permission_request',
		view_catalog: 'automated_greeting_message_view_catalog',
		wa_pay_detail: 'wa_payment_transaction_details',
		send_location: 'send_location'
	}

	if (orderResponseName[name]) {
		return [
			{
				tag: 'biz',
				attrs: {
					native_flow_name: orderResponseName[name]!
				},
				content: []
			}
		]
	} else if (flowName[name] || name === 'interactive' || name === 'buttons') {
		return [
			{
				tag: 'biz',
				attrs: {
					actual_actors: '2',
					host_storage: '2',
					privacy_mode_ts: `${ts}`
				},
				content: [
					{
						tag: 'engagement',
						attrs: {
							customer_service_state: 'open',
							conversation_state: 'open'
						}
					},
					{
						tag: 'interactive',
						attrs: {
							type: 'native_flow',
							v: '1'
						},
						content: [
							{
								tag: 'native_flow',
								attrs: {
									v: '9',
									name: flowName[name] ?? 'mixed'
								},
								content: []
							}
						]
					}
				]
			}
		]
	} else {
		return [
			{
				tag: 'biz',
				attrs: {
					actual_actors: '2',
					host_storage: '2',
					privacy_mode_ts: `${ts}`
				},
				content: [
					{
						tag: 'engagement',
						attrs: {
							customer_service_state: 'open',
							conversation_state: 'open'
						}
					}
				]
			}
		]
	}
}
