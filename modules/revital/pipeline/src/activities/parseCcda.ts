import { XMLParser } from 'fast-xml-parser'
import crypto from 'node:crypto'
import type { DocMeta } from './fetchDocuments.js'
import type { SpanMap, Span } from './parseSegment.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (_name, _jpath, _isLeafNode, isAttribute) => !isAttribute,
})

function extractText(node: unknown): string {
  if (typeof node === 'string') return node.trim()
  if (typeof node !== 'object' || node === null) return ''
  const n = node as Record<string, unknown>
  const obs = n['observation'] ?? n['act'] ?? n['procedure'] ?? n['substanceAdministration']
  if (obs) {
    const inner = Array.isArray(obs) ? obs[0] : obs
    if (typeof inner === 'object' && inner !== null) {
      const o = inner as Record<string, unknown>
      const codeArr = o['code']
      const codeEl = Array.isArray(codeArr) ? codeArr[0] : codeArr
      const codeDisplay = (codeEl as Record<string, string> | undefined)?.['@_displayName'] ?? ''
      const valueArr = o['value']
      const valueEl = Array.isArray(valueArr) ? valueArr[0] : valueArr
      const valueText = (valueEl as Record<string, string> | undefined)?.['#text'] ?? (typeof valueEl === 'string' ? valueEl : '')
      return [codeDisplay, valueText].filter(Boolean).join(': ')
    }
  }
  const textField = n['#text']
  if (typeof textField === 'string') return textField.trim()
  return ''
}

function toSpan(text: string): Span {
  return {
    page: 0,
    region: [0, 0, 0, 0],
    text,
    hash: crypto.createHash('sha256').update(text).digest('hex'),
  }
}

export async function parseCcdaImpl(
  docs: DocMeta[],
  docServiceUrl: string,
  tenantId: string,
): Promise<SpanMap> {
  const spanMap: SpanMap = {}

  for (const doc of docs) {
    try {
      const res = await fetch(`${docServiceUrl}/documents/${doc.doc_id}/span`, {
        headers: { 'x-sim-tenant-id': tenantId },
      })
      if (!res.ok) { spanMap[doc.doc_id] = []; continue }
      const xml = await res.text()
      spanMap[doc.doc_id] = extractSpans(xml)
    } catch {
      spanMap[doc.doc_id] = []
    }
  }
  return spanMap
}

function extractSpans(xml: string): Span[] {
  let root: unknown
  try {
    root = xmlParser.parse(xml)
  } catch {
    return []
  }

  const spans: Span[] = []
  const bodyArr = (root as Record<string, unknown>)?.['ClinicalDocument']
  if (!bodyArr) return spans
  const body = Array.isArray(bodyArr) ? bodyArr[0] : bodyArr
  if (typeof body !== 'object' || body === null) return spans

  // Walk all component/section/entry elements regardless of namespace nesting
  const docEl = body as Record<string, unknown>
  const topComponent = docEl['component']
  if (!topComponent) return spans

  const topArr = Array.isArray(topComponent) ? topComponent : [topComponent]
  for (const top of topArr) {
    const structuredBodyArr = (top as Record<string, unknown>)['structuredBody']
    if (!structuredBodyArr) continue
    const structuredBody = Array.isArray(structuredBodyArr) ? structuredBodyArr[0] : structuredBodyArr
    if (typeof structuredBody !== 'object' || structuredBody === null) continue
    const sb = structuredBody as Record<string, unknown>
    const sectionComponents = sb['component']
    if (!sectionComponents) continue
    const comps = Array.isArray(sectionComponents) ? sectionComponents : [sectionComponents]
    for (const comp of comps) {
      const sectionArr = (comp as Record<string, unknown>)['section']
      if (!sectionArr) continue
      const section = Array.isArray(sectionArr) ? sectionArr[0] : sectionArr
      if (typeof section !== 'object' || section === null) continue
      const s = section as Record<string, unknown>

      // Include section narrative text
      const narrative = s['text']
      const narrativeText = Array.isArray(narrative)
        ? typeof narrative[0] === 'string' ? narrative[0] : ''
        : typeof narrative === 'string' ? narrative : ''
      if (narrativeText.trim()) spans.push(toSpan(narrativeText.trim()))

      // Include individual entries
      const entries = s['entry']
      if (!entries) continue
      const entryArr = Array.isArray(entries) ? entries : [entries]
      for (const entry of entryArr) {
        const text = extractText(entry)
        if (text) spans.push(toSpan(text))
      }
    }
  }
  return spans
}

const DOC_SERVICE_URL = process.env['DOCUMENT_SERVICE_URL'] ?? 'http://localhost:4070'

export async function parseCcda(docs: DocMeta[], tenantId: string): Promise<SpanMap> {
  return parseCcdaImpl(docs, DOC_SERVICE_URL, tenantId)
}
