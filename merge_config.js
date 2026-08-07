const fs = require('fs');

const configPath = process.env.USERPROFILE + '\\.zcode\\v2\\config.json';
const modelsPath = process.env.TEMP + '\\requesty_models_formatted.json';

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const newModels = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));

// Update requesty provider models
for (const [providerId, provider] of Object.entries(config.provider)) {
    if (provider.name === 'requesty') {
        provider.models = newModels;
        console.log('Updated requesty provider with', Object.keys(newModels).length, 'models');
    }
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Config updated successfully!');
