// Unit tests for the recommendation engine: deterministic rules, stage/IO
// inference, AI payload parsing and AI result normalization. No dependencies.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANALYSIS_STAGES,
  analyzeRules,
  buildAiMessages,
  detectStage,
  normalizeAiResult,
  parseAiPayload,
} from '../analyze.js'

const TONES = [
  { id: 'grice', name: '格赖斯·高效' },
  { id: 'audit', name: '严谨审阅' },
  { id: 'coach', name: '教练引导' },
  { id: 'creative', name: '创意发散' },
  { id: 'minimal', name: '极简结论' },
  { id: 'socratic', name: '苏格拉底追问' },
  { id: 'balanced', name: '均衡自然' },
]

const OUTPUTS = [
  { id: 'code', name: '代码实现' },
  { id: 'analysis', name: '数据分析' },
  { id: 'doc', name: '文档写作' },
  { id: 'translate', name: '翻译' },
  { id: 'summary', name: '总结提炼' },
  { id: 'tutorial', name: '教学解释' },
  { id: 'options', name: '方案对比' },
]

const FORM = { content: '', stage: '', inputs: '', outputs: '', audience: '', constraints: '' }

test('stage detection: explicit stage wins, otherwise keywords infer the SOP stage', () => {
  const explicit = detectStage({ ...FORM, stage: 'design', content: '随便写点' })
  assert.equal(explicit.stage.id, 'design')
  assert.equal(explicit.inferred, false)

  const inferred = detectStage({ ...FORM, content: '先复盘这次上线，总结经验和改进项' })
  assert.equal(inferred.stage.id, 'review')
  assert.equal(inferred.inferred, true)

  assert.equal(detectStage({ ...FORM, content: '帮我写个脚本修复这个 bug' }).stage.id, 'execute')
  assert.equal(detectStage({ ...FORM, content: '没有明显关键词' }).stage.id, 'general')
})

test('rules layer recommends an explainable tone and output form with stage/IO', () => {
  const result = analyzeRules({
    ...FORM,
    content: '把上季度退款数据做归因分析，找出三个主因，周五给运营负责人一份两页报告',
    outputs: '报告',
    audience: '运营负责人',
    constraints: '两页以内',
  }, TONES, OUTPUTS)

  assert.equal(result.source, 'rules')
  assert.equal(result.stage.id, 'research')
  assert.ok(result.stageRole.length > 0)
  assert.ok(result.io.input.length > 0)
  assert.ok(result.io.output.length > 0)
  assert.equal(result.tone.recommended.id, 'audit', `unexpected tone ${result.tone.recommended.id}`)
  assert.match(result.tone.recommended.reason, /风险|证据/)
  assert.equal(result.output.recommended.id, 'analysis')
  assert.ok(Array.isArray(result.tone.alternatives))
  assert.ok(Array.isArray(result.notes) && result.notes.length > 0)
})

test('rules layer maps length constraints to the minimal tone and code work to code output', () => {
  const minimal = analyzeRules({ ...FORM, content: '一句话总结这个需求', constraints: '30 字以内' }, TONES, OUTPUTS)
  assert.equal(minimal.tone.recommended.id, 'minimal')

  const coding = analyzeRules({ ...FORM, content: '实现一个 Node 脚本，解析日志并修复报错的 bug' }, TONES, OUTPUTS)
  assert.equal(coding.output.recommended.id, 'code')
})

test('AI prompt embeds the guide, the preset catalog and the rules prior', () => {
  const form = { ...FORM, content: '给新人写一份上手教程', outputs: '教程' }
  const fallback = analyzeRules(form, TONES, OUTPUTS)
  const messages = buildAiMessages(form, '# 内置指南\n任务分析三步', TONES, OUTPUTS, fallback)
  assert.match(messages.system, /任务分析三步/)
  assert.match(messages.system, /audit — 严谨审阅/)
  assert.match(messages.system, /"stage"/)
  assert.match(messages.user, /给新人写一份上手教程/)
  assert.match(messages.user, /教程/)
})

test('AI payload parsing tolerates fences and rejects non-JSON', () => {
  const good = parseAiPayload('```json\n{"tone":{"id":"audit","reason":"x"}}\n```')
  assert.equal(good.tone.id, 'audit')
  assert.equal(typeof parseAiPayload('{"tone":{"id":"audit"}}'), 'object', 'missing fields are rejected by normalization, not by parsing')
  assert.equal(parseAiPayload('no json here'), undefined)
  assert.equal(parseAiPayload('{broken'), undefined)
})

test('AI result normalization keeps the shared shape and drops unknown preset ids', () => {
  const form = { ...FORM, content: '分析数据' }
  const fallback = analyzeRules(form, TONES, OUTPUTS)
  const payload = {
    stage: { id: 'research', label: '调研收集', inferred: true },
    stageRole: '为决策提供证据',
    io: { input: '原始数据', output: '结论' },
    tone: { id: 'audit', reason: '需要审慎结论' },
    toneAlternatives: [{ id: 'grice', reason: '时间紧时用' }],
    output: { id: 'analysis', reason: '以数据结论为主' },
    outputAlternatives: [{ id: 'nope', reason: '未知 id 应被丢弃' }],
    notes: ['补充数据口径'],
  }
  const result = normalizeAiResult(payload, TONES, OUTPUTS, fallback)
  assert.equal(result.source, 'ai')
  assert.equal(result.tone.recommended.id, 'audit')
  assert.equal(result.tone.recommended.name, '严谨审阅')
  assert.equal(result.tone.alternatives[0].id, 'grice')
  assert.equal(result.output.recommended.id, 'analysis')
  assert.deepEqual(result.output.alternatives, [])
  assert.deepEqual(result.notes, ['补充数据口径'])

  const invalid = normalizeAiResult({ tone: { id: 'nope' }, output: { id: 'doc' } }, TONES, OUTPUTS, fallback)
  assert.equal(invalid, undefined)
})

test('the stage catalog is complete and id-stable', () => {
  assert.deepEqual(ANALYSIS_STAGES.map((stage) => stage.id), [
    'requirement', 'research', 'design', 'execute', 'deliver', 'review', 'collaborate', 'general',
  ])
})
