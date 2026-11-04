// dsh-output-style - recommendation engine (settings page "智能推荐").
//
// Two layers share one result shape:
//   * rules: deterministic keyword/stage scoring, runs offline and always
//     returns an explainable recommendation (matched evidence terms);
//   * ai: an optional single LLM call that embeds the shipped task-analysis
//     guide plus the SOP stage/input/output analysis, with the rules result as
//     a prior. A failed or malformed AI answer falls back to the rules result.
//
// The result never writes session state: applying a suggestion is a normal
// `/style` command executed by the browser.

/** The work stages the analysis distinguishes (SOP position). */
export const ANALYSIS_STAGES = [
  { id: 'requirement', label: '需求澄清', role: '把模糊诉求转成可验证的目标、边界与验收标准', input: '用户诉求、背景、痛点', output: '需求说明、验收标准、问题清单' },
  { id: 'research', label: '调研收集', role: '收集并压缩证据，降低后续决策的不确定性', input: '问题清单、来源、既有资料', output: '证据表、结论摘要、待验证假设' },
  { id: 'design', label: '方案设计', role: '在约束下比较可行路径并给出取舍', input: '需求、约束、证据', output: '方案对比、推荐方案、风险清单' },
  { id: 'execute', label: '执行实现', role: '把方案落成可运行、可检查的产物', input: '方案、规格、环境', output: '代码/产物、验证结果、已知缺陷' },
  { id: 'deliver', label: '交付汇报', role: '把结果转成面向具体受众的交付物', input: '结果、数据、过程记录', output: '报告、演示、说明文档' },
  { id: 'review', label: '复盘改进', role: '提炼可复用经验与下一步改进项', input: '过程记录、结果、偏差', output: '复盘报告、改进清单、经验条目' },
  { id: 'collaborate', label: '协作沟通', role: '对齐信息、责任与下一步行动', input: '议题、当前状态、相关人', output: '纪要、行动项、通知' },
  { id: 'general', label: '通用任务', role: '按当前描述直接完成用户目标', input: '用户描述', output: '用户需要的直接结果' },
]

const STAGE_HINTS = [
  ['requirement', ['需求', '目标', '痛点', '诉求', '验收', '范围', '模糊', '想要什么']],
  ['research', ['调研', '检索', '文献', '竞品', '访谈', '问卷', '收集', '证据', '综述', '资料', '分析', '归因', '统计', '数据']],
  ['design', ['方案', '设计', '选型', '架构', '流程', '取舍', '对比方案', '评估方案', '技术路线']],
  ['execute', ['实现', '开发', '编码', '写代码', '脚本', '调试', '修复', '部署', '执行', '制作']],
  ['deliver', ['交付', '汇报', '报告', '汇报材料', 'ppt', '演示', '文档', '发给', '提交', '宣讲']],
  ['review', ['复盘', '回顾', '总结', '改进', '经验', '教训', '偏差']],
  ['collaborate', ['沟通', '协调', '对齐', '会议', '纪要', '通知', '同步', '协作']],
]

/** Tone scoring rules: keyword hits plus a stage prior. */
const TONE_RULES = [
  { id: 'minimal', words: ['简短', '简洁', '少说', '一句话', '结论先行', '极简', '别废话', '控制在', '字以内'], reason: '要求短、结论先行' },
  { id: 'audit', words: ['风险', '合规', '审查', '审核', '校验', '漏洞', '质量', '严谨', '证据', '假设', '边界', '反例', '归因', '主因', '验证'], reason: '涉及风险与证据校验' },
  { id: 'coach', words: ['教我', '学习', '入门', '不懂', '培训', '新人', '讲解', '带我', '辅导'], reason: '以学习/上手为目标' },
  { id: 'creative', words: ['创意', '头脑风暴', '发散', '创新', '点子', '灵感', '新想法'], reason: '需要发散与创意' },
  { id: 'socratic', words: ['为什么', '反思', '假设', '推理', '思辨', '质疑', '推演'], reason: '需要追问与推理' },
  { id: 'balanced', words: ['自然', '正常', '均衡', '随便聊聊', '保持自然'], reason: '希望自然均衡的表达' },
  { id: 'grice', words: ['高效', '直接', '废话少', '信息密度', '省时间'], reason: '要求信息效率' },
]

/** Output-form scoring rules. */
const OUTPUT_RULES = [
  { id: 'code', words: ['代码', '脚本', '函数', '接口', 'bug', '调试', '实现', '仓库', '编译', '报错'], reason: '交付物是可运行代码/改动' },
  { id: 'analysis', words: ['数据', '指标', '统计', '分析', '评估', '判断', '对比', '趋势', '归因', '结论'], reason: '核心是数据分析与判断' },
  { id: 'doc', words: ['文档', '报告', '说明', '方案书', '纪要', '汇报材料', 'ppt', '手册', '规范'], reason: '交付物是文档/报告' },
  { id: 'translate', words: ['翻译', '英文', '中译', '英译', '术语对照', 'localization', '本地化'], reason: '涉及翻译或双语交付' },
  { id: 'summary', words: ['总结', '摘要', '提炼', '要点', '概览', '太长不看', 'tl;dr'], reason: '需要压缩提炼' },
  { id: 'tutorial', words: ['教程', '步骤', '怎么用', '操作指引', '教学', '示例', '手把手'], reason: '需要可跟随的步骤说明' },
  { id: 'options', words: ['方案对比', '选型', '权衡', '几个方案', '备选', '利弊', '决策'], reason: '需要并列比较多个选项' },
]

/** Stage priors: [toneId, outputId] with a small score boost. */
const STAGE_PRIOR = {
  requirement: ['socratic', 'doc'],
  research: ['audit', 'analysis'],
  design: ['audit', 'options'],
  execute: ['grice', 'code'],
  deliver: ['balanced', 'doc'],
  review: ['socratic', 'summary'],
  collaborate: ['grice', 'doc'],
  general: ['balanced', null],
}

/** Cheap normalization used for keyword matching. */
function normalize(text) {
  return String(text === undefined || text === null ? '' : text).toLowerCase()
}

/** Count keyword hits and remember the matched words for the explanation. */
function scoreWords(text, words) {
  const hits = []
  for (const word of words) {
    if (word !== '' && text.includes(word.toLowerCase())) hits.push(word)
  }
  return hits
}

/** Detect the SOP stage from the user's description; an explicit stage wins. */
export function detectStage(input) {
  const explicit = typeof input.stage === 'string' ? input.stage.trim() : ''
  if (explicit !== '') {
    const matched = ANALYSIS_STAGES.find((stage) => stage.id === explicit || stage.label === explicit)
    if (matched !== undefined) return { stage: matched, inferred: false }
  }
  const text = normalize([input.content, input.inputs, input.outputs, input.constraints].filter(Boolean).join(' '))
  let best = { stage: ANALYSIS_STAGES[ANALYSIS_STAGES.length - 1], score: 0 }
  for (const [id, words] of STAGE_HINTS) {
    const hits = scoreWords(text, words)
    if (hits.length > best.score) {
      best = { stage: ANALYSIS_STAGES.find((entry) => entry.id === id), score: hits.length }
    }
  }
  return { stage: best.stage, inferred: true }
}

/**
 * Score one preset kind against the description and the stage prior.
 * @param presets - the live compact preset list (`{id,name}` entries).
 * @param rules - the rule table for this kind.
 * @param text - normalized user description.
 * @param stagePrior - the stage's preferred preset id (or null).
 */
function rank(presets, rules, text, stagePrior) {
  const list = Array.isArray(presets) ? presets : []
  const scores = new Map()
  const reasons = new Map()
  for (const preset of list) {
    scores.set(preset.id, 0)
    reasons.set(preset.id, [])
  }
  for (const rule of rules) {
    if (!scores.has(rule.id)) continue
    const hits = scoreWords(text, rule.words)
    if (hits.length === 0) continue
    scores.set(rule.id, scores.get(rule.id) + hits.length * 2)
    reasons.get(rule.id).push(`${rule.reason}（命中：${hits.slice(0, 3).join('、')}）`)
  }
  if (stagePrior !== null && scores.has(stagePrior)) {
    scores.set(stagePrior, scores.get(stagePrior) + 1)
    reasons.get(stagePrior).push('与工作阶段匹配')
  }
  const ranked = list
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      score: scores.get(preset.id) ?? 0,
      reasons: reasons.get(preset.id) ?? [],
    }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
  const recommended = ranked[0]
  return {
    recommended: {
      ...recommended,
      reason: recommended.reasons.length > 0 ? recommended.reasons[0] : '与当前工作描述没有明显冲突，作为默认风格',
      allReasons: recommended.reasons,
    },
    alternatives: ranked.slice(1, 3),
    ranked,
  }
}

/** Evidence notes: what the recommendation is based on and what is missing. */
function buildNotes(input, stageInfo, text) {
  const notes = []
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  if (content.length === 0) notes.push('没有填写工作内容，结果只能按阶段与产出物推断')
  else if (content.length < 20) notes.push('工作内容较短，补充目标/交付物/受众会让推荐更准确')
  if (stageInfo.inferred) notes.push(`未指定阶段，按描述推断为「${stageInfo.stage.label}」；可在下发选择框纠正`)
  if (typeof input.outputs !== 'string' || input.outputs.trim() === '') notes.push('没有填写预期产出物，产出形态建议仅供参考')
  if (typeof input.audience !== 'string' || input.audience.trim() === '') notes.push('没有填写受众/下游，语气与详细程度可能偏保守')
  if (typeof input.constraints !== 'string' || input.constraints.trim() === '') notes.push('没有填写约束（长度/格式/时效/风险），未做针对性权衡')
  const constraintText = normalize(input.constraints)
  if (constraintText.includes('字') || constraintText.includes('长度') || constraintText.includes('简短')) {
    notes.push('约束提到长度，已提高「极简结论」的权重')
  }
  if (constraintText.includes('风险') || constraintText.includes('合规')) {
    notes.push('约束提到风险/合规，已提高「严谨审阅」的权重')
  }
  return notes
}

/**
 * Deterministic recommendation (layer A).
 * @param input - the settings-page analysis form.
 * @param tones - live compact tone presets.
 * @param outputs - live compact output presets.
 * @returns one explainable recommendation.
 */
export function analyzeRules(input, tones, outputs) {
  const stageInfo = detectStage(input)
  const text = normalize([
    input.content,
    input.inputs,
    input.outputs,
    input.audience,
    input.constraints,
    stageInfo.stage.label,
  ].filter(Boolean).join(' '))
  const prior = STAGE_PRIOR[stageInfo.stage.id] ?? [null, null]
  const tone = rank(tones, TONE_RULES, text, prior[0])
  const output = rank(outputs, OUTPUT_RULES, text, prior[1])
  return {
    source: 'rules',
    stage: { id: stageInfo.stage.id, label: stageInfo.stage.label, inferred: stageInfo.inferred },
    stageRole: stageInfo.stage.role,
    io: { input: stageInfo.stage.input, output: stageInfo.stage.output },
    tone: { recommended: tone.recommended, alternatives: tone.alternatives },
    output: { recommended: output.recommended, alternatives: output.alternatives },
    notes: buildNotes(input, stageInfo, text),
  }
}

/** Map a stage id or Chinese label to the canonical stage entry. */
function resolveStage(value) {
  const rawId = typeof value === 'string' ? value.trim() : ''
  const rawLabel = value !== null && typeof value === 'object' && typeof value.label === 'string' ? value.label.trim() : ''
  const found = ANALYSIS_STAGES.find((stage) => stage.id === rawId || stage.label === rawId || (rawLabel !== '' && stage.label === rawLabel))
  return found
}

/**
 * Validate a parsed AI payload into the shared result shape. Preset references
 * are accepted by id or by name (models sometimes echo the label), unknown ids
 * are dropped, and missing prose falls back to the rules result.
 */
export function normalizeAiResult(payload, tones, outputs, fallback) {
  if (payload === null || typeof payload !== 'object') return undefined
  const index = (list) => new Map((list ?? []).map((preset) => [preset.id, preset]))
  const byName = (list) => new Map((list ?? []).map((preset) => [String(preset.name).toLowerCase(), preset]))
  const resolve = (value, list) => {
    if (typeof value === 'string') {
      const text = value.trim()
      if (text === '') return undefined
      const preset = index(list).get(text) ?? byName(list).get(text.toLowerCase())
      return preset === undefined ? undefined : { preset, reason: '模型未给出理由' }
    }
    if (value === null || typeof value !== 'object') return undefined
    const idText = typeof value.id === 'string' ? value.id.trim() : ''
    const nameText = typeof value.name === 'string' ? value.name.trim() : ''
    const preset = (idText === '' ? undefined : index(list).get(idText))
      ?? (nameText === '' ? undefined : index(list).get(nameText) ?? byName(list).get(nameText.toLowerCase()))
      ?? (idText === '' ? undefined : byName(list).get(idText.toLowerCase()))
    if (preset === undefined) return undefined
    const reason = typeof value.reason === 'string' && value.reason.trim() !== '' ? value.reason.trim() : '模型未给出理由'
    return { preset, reason }
  }
  const tone = resolve(payload.tone, tones)
  const output = resolve(payload.output, outputs)
  if (tone === undefined || output === undefined) return undefined
  const alternatives = (value, list) => (Array.isArray(value) ? value : [])
    .map((entry) => resolve(entry, list))
    .filter((entry) => entry !== undefined)
    .slice(0, 2)
    .map((entry) => ({ id: entry.preset.id, name: entry.preset.name, reason: entry.reason }))
  const rawStage = payload.stage
  const stageInfo = resolveStage(rawStage) ?? fallback.stage
  const stageLabel = rawStage !== null && typeof rawStage === 'object' && typeof rawStage.label === 'string' && rawStage.label.trim() !== ''
    ? rawStage.label.trim()
    : stageInfo.label
  const rawIo = payload.io !== null && typeof payload.io === 'object' ? payload.io : {}
  return {
    source: 'ai',
    stage: {
      id: stageInfo.id,
      label: stageLabel,
      inferred: rawStage !== null && typeof rawStage === 'object' && typeof rawStage.inferred === 'boolean' ? rawStage.inferred : fallback.stage.inferred,
    },
    stageRole: typeof payload.stageRole === 'string' && payload.stageRole.trim() !== '' ? payload.stageRole.trim() : fallback.stageRole,
    io: {
      input: typeof rawIo.input === 'string' && rawIo.input.trim() !== '' ? rawIo.input.trim() : fallback.io.input,
      output: typeof rawIo.output === 'string' && rawIo.output.trim() !== '' ? rawIo.output.trim() : fallback.io.output,
    },
    tone: {
      recommended: { id: tone.preset.id, name: tone.preset.name, reason: tone.reason, allReasons: [] },
      alternatives: alternatives(payload.toneAlternatives, tones),
    },
    output: {
      recommended: { id: output.preset.id, name: output.preset.name, reason: output.reason, allReasons: [] },
      alternatives: alternatives(payload.outputAlternatives, outputs),
    },
    notes: Array.isArray(payload.notes)
      ? payload.notes.filter((note) => typeof note === 'string').slice(0, 6)
      : fallback.notes,
  }
}

/**
 * Build the messages for the AI layer (layer B).
 * @param input - the settings-page analysis form.
 * @param guide - the shipped task-analysis guide text (markdown).
 * @param tones - live compact tone presets.
 * @param outputs - live compact output presets.
 * @param fallback - the rules result, used as prior and as the fallback.
 * @returns `{system, user}` strings.
 */
export function buildAiMessages(input, guide, tones, outputs, fallback) {
  const presetLines = (list) => (list ?? []).map((preset) => `- ${preset.id} — ${preset.name}`).join('\n')
  const system = [
    '你是「输出风格分析器」，服务于 DeepSeek Harness 的 dsh-output-style 插件。',
    '任务：根据用户给出的工作内容、SOP 阶段、输入、输出、受众与约束，判断这次工作最合适的「沟通基调」与「产出形态」，并给出可核查的理由。',
    '',
    '必须遵守任务分析方法论（下方指南）：先确认任务边界与 SOP 位置，再分析输入/输出、受众与约束，最后才做选择；不确定就写明不确定，不要编造用户没有提供的信息。',
    '',
    '# 任务分析指南（内置）',
    guide,
    '',
    '# 可选沟通基调（只能从中选 id）',
    presetLines(tones),
    '',
    '# 可选产出形态（只能从中选 id）',
    presetLines(outputs),
    '',
    '# 初步规则分析（作为先验，可推翻，但需说明理由）',
    JSON.stringify({
      stage: fallback.stage,
      stageRole: fallback.stageRole,
      io: fallback.io,
      tone: fallback.tone.recommended,
      output: fallback.output.recommended,
      notes: fallback.notes,
    }, null, 2),
    '',
    '# 输出要求',
    '只输出一个 JSON 对象，不要 Markdown、不要代码围栏、不要解释文字。字段：',
    '{',
    '  "stage": {"id": "需求澄清|调研收集|方案设计|执行实现|交付汇报|复盘改进|协作沟通|通用任务 的英文 id", "label": "中文阶段名", "inferred": true},',
    '  "stageRole": "该阶段在整个 SOP 中的作用（一句话）",',
    '  "io": {"input": "上游输入归纳", "output": "本阶段产出物归纳"},',
    '  "tone": {"id": "基调 id", "reason": "为什么这个基调适合（引用用户提供的事实）"},',
    '  "toneAlternatives": [{"id": "备选 id", "reason": "何时改用"}],',
    '  "output": {"id": "产出形态 id", "reason": "为什么这种呈现适合"},',
    '  "outputAlternatives": [{"id": "备选 id", "reason": "何时改用"}],',
    '  "notes": ["还需要用户补充什么 / 风险提示，最多 4 条"]',
    '}',
    '',
    '硬性要求：输出必须是完整合法的单个 JSON 对象（不要注释/不要省略）；reason 每条不超过 60 字；notes 最多 3 条；总输出不超过 600 字。',
  ].join('\n')
  const user = [
    '工作内容与目标：',
    typeof input.content === 'string' && input.content.trim() !== '' ? input.content.trim() : '（未填写）',
    '',
    'SOP 阶段（用户选择）：',
    typeof input.stage === 'string' && input.stage.trim() !== '' ? input.stage.trim() : '（未选择，请推断）',
    '',
    '上游输入：',
    typeof input.inputs === 'string' && input.inputs.trim() !== '' ? input.inputs.trim() : '（未填写）',
    '',
    '预期产出物：',
    typeof input.outputs === 'string' && input.outputs.trim() !== '' ? input.outputs.trim() : '（未填写）',
    '',
    '受众/下游：',
    typeof input.audience === 'string' && input.audience.trim() !== '' ? input.audience.trim() : '（未填写）',
    '',
    '约束（长度/格式/时效/风险等）：',
    typeof input.constraints === 'string' && input.constraints.trim() !== '' ? input.constraints.trim() : '（未填写）',
  ].join('\n')
  return { system, user }
}

/** Extract the first JSON object from a model answer and parse it. */
export function parseAiPayload(text) {
  const source = typeof text === 'string' ? text : ''
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced !== null ? fenced[1] : source
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const payload = JSON.parse(candidate.slice(start, end + 1))
    return payload !== null && typeof payload === 'object' ? payload : undefined
  } catch {
    return undefined
  }
}
