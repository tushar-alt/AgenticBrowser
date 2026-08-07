const fs = require('fs');
const path = require('path');

const modelsRaw = JSON.parse(fs.readFileSync(process.env.TEMP + '\\requesty_models.json', 'utf-8'));
const models = modelsRaw.data;

const output = {};
for (const m of models) {
    const id = m.id;
    const ctx = Math.min(m.context_window || 200000, 1048576);
    const out = Math.min(m.max_output_tokens || 16384, 384000);
    const entry = {
        name: id,
        limit: { context: ctx, output: out },
        modalities: {
            input: m.supports_vision ? ['text', 'image'] : ['text'],
            output: ['text']
        }
    };
    if (m.supports_reasoning) {
        entry.reasoning = {
            enabled: true,
            variants: ['off', 'high', 'max'],
            defaultVariant: 'max'
        };
    }
    output[id] = entry;
}

fs.writeFileSync(process.env.TEMP + '\\requesty_models_formatted.json', JSON.stringify(output, null, 2));
console.log('Done. Generated entries for', Object.keys(output).length, 'models');
