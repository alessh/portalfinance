<#
.SYNOPSIS
    Chained infra gates for Phase 01.1 (PowerShell port of validate-phase-01.1.sh).

.DESCRIPTION
    Local file/manifest gates always run. Remote AWS + Cloudflare gates require
    an active SSO session: `aws sso login --profile portalfinance-prod`.

    Exits 0 on all-pass, 1 on first failure.

.PARAMETER SkipRemote
    Skip the live AWS + Cloudflare round-trip checks. Equivalent to the bash
    version's SKIP_REMOTE=1 env var.

.PARAMETER Profile
    AWS profile name. Defaults to $env:AWS_PROFILE or 'portalfinance-prod'.

.EXAMPLE
    pwsh ./scripts/validate-phase-01.1.ps1 -SkipRemote
    Runs only the local file + manifest gates.

.EXAMPLE
    pwsh ./scripts/validate-phase-01.1.ps1
    Runs the full local + remote suite (requires SSO session).

.NOTES
    Windows PowerShell 5.1 compatible: no &&/||, no ternary, no null-coalescing.
#>

[CmdletBinding()]
param(
    [switch] $SkipRemote,
    [string] $Profile = $(if ($env:AWS_PROFILE) { $env:AWS_PROFILE } else { 'portalfinance-prod' })
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Honour the bash-style env var too, so callers can do `$env:SKIP_REMOTE='1'; ./script.ps1`.
if (-not $SkipRemote -and $env:SKIP_REMOTE -eq '1') {
    $SkipRemote = $true
}

$App     = 'portalfinance'
$EnvName = 'prod'
$Region  = 'sa-east-1'

function Write-Pass([string] $message) {
    Write-Host ('  [PASS] {0}' -f $message)
}

function Invoke-Fail([string] $message) {
    [Console]::Error.WriteLine(('  [FAIL] {0}' -f $message))
    exit 1
}

function Test-FilePresent([string] $path, [string] $label) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Invoke-Fail "$label missing"
    }
}

function Test-FileAbsent([string] $path, [string] $message) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Invoke-Fail $message
    }
}

function Test-FileMatches([string] $path, [string] $pattern, [string] $message) {
    if (-not (Select-String -LiteralPath $path -Pattern $pattern -Quiet)) {
        Invoke-Fail $message
    }
}

function Invoke-AwsQuery {
    # Run aws.exe and return stdout as a single trimmed string. Returns
    # the literal 'ERROR' on any failure so callers can match the bash
    # script's `|| echo "ERROR"` fallback.
    #
    # NOTE: We use Start-Process rather than the call operator `&`. In
    # Windows PowerShell 5.1, ANY native-command stderr write inside the
    # PS pipeline is wrapped as a NativeCommandError ErrorRecord BEFORE
    # `2>` redirection takes effect; combined with $ErrorActionPreference
    # = 'Stop', a benign aws.exe stderr line (deprecation warnings, SSO
    # token refresh notes, etc.) would terminate the script. Start-Process
    # spawns the child in its own process so PS never touches its streams.
    #
    # CAUTION: do NOT name the parameter `$Args` -- that shadows the
    # PowerShell automatic variable and the binding silently produces an
    # empty array, which Start-Process -ArgumentList then rejects.
    param([Parameter(Mandatory)] [string[]] $Arguments)

    $outFile = [System.IO.Path]::GetTempFileName()
    $errFile = [System.IO.Path]::GetTempFileName()
    try {
        # Start-Process -ArgumentList joins string[] with single spaces and
        # does NOT quote elements containing whitespace/quotes itself, so we
        # must do it. JMESPath queries like
        #   "CertificateSummaryList[?DomainName=='portalfinance.app'].Status | [0]"
        # contain spaces and would otherwise be split across argv entries.
        $quoted = foreach ($a in $Arguments) {
            if ($a -match '[\s"]') { '"' + ($a -replace '"', '\"') + '"' } else { $a }
        }
        $proc = Start-Process -FilePath 'aws.exe' `
            -ArgumentList $quoted `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $outFile `
            -RedirectStandardError  $errFile
        if ($proc.ExitCode -ne 0) {
            return 'ERROR'
        }
        $content = Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue
        if ($null -eq $content) { return '' }
        return $content.Trim()
    } finally {
        Remove-Item -LiteralPath $outFile -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $errFile -ErrorAction SilentlyContinue
    }
}

Write-Host '== Phase 01.1 validation =='

# --- Local file gates (safe without AWS access) ---
Write-Host 'Checking local files...'

Test-FilePresent 'Dockerfile'                                       'Dockerfile'
Test-FilePresent '.dockerignore'                                    '.dockerignore'
Test-FilePresent 'scripts/entrypoint.sh'                            'scripts/entrypoint.sh'
Test-FilePresent 'copilot/.workspace'                               'copilot/.workspace'
Test-FilePresent 'copilot/environments/prod/manifest.yml'           'prod env manifest'
Test-FilePresent 'copilot/environments/addons/rds-postgres.yml'     'RDS addon'
Test-FilePresent 'copilot/web/manifest.yml'                         'web manifest'
Test-FilePresent 'copilot/worker/manifest.yml'                      'worker manifest'
Test-FilePresent 'copilot/migrate/manifest.yml'                     'migrate manifest'
Test-FilePresent 'src/app/api/health/route.ts'                      'health route'
Test-FilePresent 'tsup.config.ts'                                   'tsup config'
Test-FilePresent 'docs/ops/aws-copilot-setup.md'                    'AWS runbook'

# Plan 01.1-08 removed docs/ops/railway-setup.md. Its presence now indicates
# someone has restored a legacy file or merged a stale branch -- hard fail.
Test-FileAbsent 'docs/ops/railway-setup.md' `
    'docs/ops/railway-setup.md MUST be deleted (Railway is deprecated; see docs/ops/aws-copilot-setup.md)'

# Note: the bash script also asserts entrypoint.sh is executable (`[ -x ]`).
# On Windows the FS does not carry a +x bit; the in-tree git index mode is what
# matters and is guarded by .gitattributes. Skipped here.

Write-Pass 'all local files present'

# --- Manifest invariant greps (cheap, pre-deploy) ---
Test-FileMatches 'copilot/environments/addons/rds-postgres.yml' 'PubliclyAccessible:\s*false' `
    'RDS addon MUST declare PubliclyAccessible: false'
Write-Pass 'RDS PubliclyAccessible: false'

Test-FileMatches 'copilot/web/manifest.yml'     'placement:\s*private' 'web manifest MUST place tasks in private subnets'
Test-FileMatches 'copilot/worker/manifest.yml'  'placement:\s*private' 'worker manifest MUST place tasks in private subnets'
Test-FileMatches 'copilot/migrate/manifest.yml' 'placement:\s*private' 'migrate manifest MUST place tasks in private subnets'
Write-Pass 'all services in private subnets'

Test-FileMatches 'copilot/migrate/manifest.yml' 'schedule:\s*"none"' 'migrate job MUST have schedule: none (manual-only)'
Write-Pass 'migrate is manual-only'

Test-FileMatches 'copilot/web/manifest.yml'     'retention:\s*30' 'web manifest MUST set log retention: 30'
Test-FileMatches 'copilot/worker/manifest.yml'  'retention:\s*30' 'worker manifest MUST set log retention: 30'
Test-FileMatches 'copilot/migrate/manifest.yml' 'retention:\s*30' 'migrate manifest MUST set log retention: 30'
Write-Pass 'CloudWatch retention 30 days declared'

if ($SkipRemote) {
    Write-Host 'SKIP_REMOTE=1 -- skipping AWS-side gates'
    Write-Host 'All local gates PASSED'
    exit 0
}

# --- Remote AWS gates ---
Write-Host 'Checking live AWS infrastructure...'

# 1. RDS PubliclyAccessible must be false on the prod DB instance.
$dbPublic = Invoke-AwsQuery @(
    'rds', 'describe-db-instances',
    '--db-instance-identifier', "$App-$EnvName-db",
    '--profile', $Profile, '--region', $Region,
    '--query', 'DBInstances[0].PubliclyAccessible', '--output', 'text'
)
if ($dbPublic -ne 'False') {
    Invoke-Fail "RDS instance is publicly accessible (got: $dbPublic)"
}
Write-Pass 'RDS PubliclyAccessible=false'

# 2. CloudWatch log groups for web / worker / migrate exist with 30-day retention.
foreach ($svc in @('web', 'worker', 'migrate')) {
    $retention = Invoke-AwsQuery @(
        'logs', 'describe-log-groups',
        '--log-group-name-prefix', "/copilot/$App-$EnvName-$svc",
        '--profile', $Profile, '--region', $Region,
        '--query', 'logGroups[0].retentionInDays', '--output', 'text'
    )
    if ($retention -ne '30') {
        Invoke-Fail "log group /copilot/$App-$EnvName-$svc retention != 30 (got: $retention)"
    }
}
Write-Pass 'CloudWatch log retention 30 days for web + worker + migrate'

# 3. SSM secrets backing the Copilot manifests are all SecureString.
$secrets = @('NEXTAUTH_SECRET', 'ENCRYPTION_KEY', 'CPF_HASH_PEPPER', 'SENTRY_DSN', 'TURNSTILE_SECRET_KEY')
foreach ($name in $secrets) {
    $type = Invoke-AwsQuery @(
        'ssm', 'describe-parameters',
        '--parameter-filters', "Key=Name,Values=/copilot/$App/$EnvName/secrets/$name",
        '--profile', $Profile, '--region', $Region,
        '--query', 'Parameters[0].Type', '--output', 'text'
    )
    if ($type -ne 'SecureString') {
        Invoke-Fail "/copilot/$App/$EnvName/secrets/$name is not SecureString (got: $type)"
    }
}
Write-Pass 'SSM secrets are SecureString'

# 4. ACM cert covering portalfinance.app is ISSUED in sa-east-1.
$certStatus = Invoke-AwsQuery @(
    'acm', 'list-certificates',
    '--profile', $Profile, '--region', $Region,
    '--query', "CertificateSummaryList[?DomainName=='portalfinance.app'].Status | [0]",
    '--output', 'text'
)
if ($certStatus -ne 'ISSUED') {
    Invoke-Fail "ACM cert for portalfinance.app is not ISSUED (got: $certStatus)"
}
Write-Pass 'ACM cert ISSUED for portalfinance.app'

# 5. Edge round-trip: apex + www return 200 via Cloudflare.
function Invoke-EdgeStatus([string] $url) {
    try {
        $response = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        return [pscustomobject]@{ Status = [int] $response.StatusCode; Headers = $response.Headers }
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            return [pscustomobject]@{ Status = [int] $_.Exception.Response.StatusCode; Headers = $_.Exception.Response.Headers }
        }
        return [pscustomobject]@{ Status = 0; Headers = $null }
    } catch {
        return [pscustomobject]@{ Status = 0; Headers = $null }
    }
}

$apex = Invoke-EdgeStatus 'https://portalfinance.app/api/health'
if ($apex.Status -ne 200) {
    Invoke-Fail "https://portalfinance.app/api/health did not return 200 (got: $($apex.Status))"
}
Write-Pass 'edge round-trip portalfinance.app/api/health = 200'

$www = Invoke-EdgeStatus 'https://www.portalfinance.app/api/health'
if ($www.Status -ne 200) {
    Invoke-Fail "https://www.portalfinance.app/api/health did not return 200 (got: $($www.Status))"
}
Write-Pass 'edge round-trip www.portalfinance.app/api/health = 200'

# 6. Confirm Cloudflare is fronting the edge (Server: cloudflare header present).
$serverHeader = $null
if ($apex.Headers) {
    # Invoke-WebRequest header values can be string or string[]; normalise.
    $raw = $apex.Headers['Server']
    if ($raw -is [System.Array]) { $raw = $raw[0] }
    if ($raw) { $serverHeader = $raw.ToString().ToLowerInvariant() }
}
if ($serverHeader -ne 'cloudflare') {
    $shown = if ($serverHeader) { $serverHeader } else { '<missing>' }
    Invoke-Fail "expected Server: cloudflare, got: $shown"
}
Write-Pass 'Cloudflare proxy present (Server: cloudflare)'

Write-Host 'All gates PASSED.'
