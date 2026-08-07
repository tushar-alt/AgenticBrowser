$models = (Get-Content "$env:TEMP\requesty_models.json" -Raw | ConvertFrom-Json).data
$output = @{}
foreach ($m in $models) {
    $id = $m.id
    $ctx = [Math]::Min([int]$m.context_window, 1048576)
    $out = [Math]::Min([int]$m.max_output_tokens, 384000)
    $entry = @{
        name = $id
        limit = @{ context = $ctx; output = $out }
        modalities = @{
            input = if ($m.supports_vision) { @('text','image') } else { @('text') }
            output = @('text')
        }
    }
    if ($m.supports_reasoning) {
        $entry['reasoning'] = @{
            enabled = $true
            variants = @('off','high','max')
            defaultVariant = 'max'
        }
    }
    $output[$id] = $entry
}
$output | ConvertTo-Json -Depth 5 | Out-File -FilePath "$env:TEMP\requesty_models_formatted.json" -Encoding UTF8
Write-Host "Done. Generated entries for" $output.Count "models"
