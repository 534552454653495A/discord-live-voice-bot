# Chatterbox local TTS setup (Windows).
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/setup-chatterbox.ps1
#
# What it does: the .venv-chatterbox virtual environment + chatterbox-tts + torch with CUDA.
# The model weights are downloaded from Hugging Face on the first run (~1-2 GB).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv-chatterbox'
$py = Join-Path $venv 'Scripts\python.exe'

$sysPy = (& python -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null)
if ($sysPy -and ([version]$sysPy -lt [version]'3.10' -or [version]$sysPy -ge [version]'3.13')) {
	Write-Host "Warning: system python is $sysPy; 3.10-3.12 is recommended for chatterbox-tts/torch (you can install with py -3.11)."
}
if (-not (Test-Path $py)) {
	Write-Host 'creating the virtual environment...'
	python -m venv $venv
}

& $py -m pip install --upgrade pip --no-cache-dir
Write-Host 'installing chatterbox-tts...'
& $py -m pip install chatterbox-tts --no-cache-dir
Write-Host 'installing faster-whisper (local speech recognition) + the CUDA runtime libraries...'
& $py -m pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12 --no-cache-dir

$torchRaw = (& $py -c "import torch; print(torch.__version__)").Trim()
# PyPI wheels report the version as something like "2.6.0+cpu"; on the CUDA index there is no "+cpu" suffix.
$torch = $torchRaw -replace '\+.*$', ''
Write-Host "installed torch: $torchRaw -> replacing it with the CUDA wheels: torch==$torch (stays on CPU when they are missing)"
& $py -m pip install --force-reinstall "torch==$torch" torchaudio --index-url https://download.pytorch.org/whl/cu124
if ($LASTEXITCODE -ne 0) {
	Write-Host "Could not install the CUDA wheels (exit code $LASTEXITCODE); continuing on CPU."
}

& $py (Join-Path $PSScriptRoot 'check-chatterbox.py')
Write-Host 'setup complete. Start the server:'
Write-Host '  tools\run-chatterbox.cmd'
