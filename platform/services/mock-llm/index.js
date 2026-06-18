const express = require('express');

const app = express();
app.use(express.json({ limit: '2mb' }));
const PORT = Number(process.env.PORT || 3060);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// model-gateway sends prompt_text = JSON.stringify({ task_kind, inputs }) as the user message.
app.post('/v1/messages', (req, res) => {
  let task_kind = '';
  let inputs = {};
  try {
    const content = req.body?.messages?.[0]?.content ?? '{}';
    const parsed = JSON.parse(content);
    task_kind = parsed.task_kind || '';
    inputs = parsed.inputs || {};
  } catch { /* leave defaults */ }

  let output;
  if (task_kind === 'extract_entities') {
    const span = (inputs.document_span_refs || [])[0] || 'span-1';
    output = { entities: [{ resource_type: 'Condition', raw_text: 'osteoarthritis of knee', coding_hint: null, span_ref: span }] };
  } else if (task_kind === 'summarize') {
    const refs = inputs.document_span_refs || [];
    // Input-aware: cite a real span at page 1 so summarizeGrounded's isCitationValid passes.
    const assertions = refs.length
      ? [{ id: 'a1', text: 'Conservative therapy documented over 6 months.', confidence: 0.9,
           citations: [{ document_ref: refs[0], page: 1, region: [0, 0, 0, 0], excerpt_hash: 'h1' }] }]
      : [];
    output = { assertions };
  } else if (task_kind === 'triage_advise') {
    output = { suggestion: 'likely_meets', confidence: 0.9, rationale_assertion_ids: ['a1'] };
  } else {
    output = {};
  }

  res.json({
    content: [{ text: JSON.stringify(output) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
});

app.listen(PORT, () => console.log(`mock-llm listening on :${PORT}`));
