'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const projectRoot = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'App.tsx'), 'utf8');
const workshopQuerySource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'hooks', 'useWorkshopQuery.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'main.tsx'), 'utf8');
const gateSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'StartupGate.tsx'), 'utf8');
const onboardingSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'StartupOnboarding.tsx'), 'utf8');
const stepsSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'StartupSteps.tsx'), 'utf8');
const controllerSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'useStartupOnboardingController.ts'), 'utf8');
const networkDeadlineSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'startupNetworkDeadline.ts'), 'utf8');
const accountStepSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'AccountStep.tsx'), 'utf8');
const networkStepSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'NetworkStep.tsx'), 'utf8');
const readyStepSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'ReadyStep.tsx'), 'utf8');
const enhancedSettingsSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'EnhancedSettings.tsx'), 'utf8');
const copySource = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'startupCopy.ts'), 'utf8');
const onboardingHandlerSource = fs.readFileSync(path.join(projectRoot, 'src', 'app', 'handlers', 'onboarding.js'), 'utf8');

test('home Workshop queries wait until startup onboarding is complete', () => {
  assert.match(mainSource, /<App workshopQueryEnabled=\{ready\} \/>/);
  assert.match(appSource, /enabled: workshopQueryEnabled/);
  assert.match(workshopQuerySource, /const loadItems = React\.useCallback\(async \(\) => \{\s*if \(!enabled\) return;/);
  assert.match(workshopQuerySource, /if \(enabled\) return;\s*cancelActiveQuery\(\);/);
  assert.match(gateSource, /children\(!!status\?\.completed && !unavailable\)/);
});

test('startup onboarding no longer describes a per-restart test mode', () => {
  assert.doesNotMatch(`${gateSource}\n${onboardingSource}\n${stepsSource}\n${copySource}`, /每次重启|every server restart|testMode/);
});

test('startup onboarding asks about built-in enhancement before Steam login', () => {
  assert.match(onboardingSource, /useState<StartupStep>\('network'\)/);
  assert.match(onboardingSource, /step === 'network'[\s\S]*?setStep\('account'\)/);
  assert.match(controllerSource, /const continueAccount[\s\S]*?setStep\('ready'\)/);
  assert.ok(stepsSource.indexOf('{ label: copy.network') < stepsSource.indexOf('{ label: copy.account'));
});

test('startup gate delegates onboarding copy and step UI to focused modules', () => {
  assert.match(gateSource, /import \{ STARTUP_COPY \} from '\.\/startupCopy';/);
  assert.match(gateSource, /import \{ StartupOnboarding \} from '\.\/StartupOnboarding';/);
  assert.match(onboardingSource, /useStartupOnboardingController/);
  assert.match(onboardingSource, /<AccountStep/);
  assert.match(onboardingSource, /<NetworkStep/);
  assert.match(onboardingSource, /<ReadyStep/);
  assert.match(onboardingSource, /from '\.\/StartupSteps';/);
  assert.match(networkStepSource, /<EnhancedSettings/);
  assert.doesNotMatch(onboardingSource, /checkStartupAccount|checkStartupNetwork|completeStartupOnboarding|getStartupOnboardingStatus/);
  assert.match(controllerSource, /checkStartupAccount/);
  assert.match(controllerSource, /checkStartupNetwork/);
  assert.match(controllerSource, /completeStartupOnboarding/);
  assert.doesNotMatch(gateSource, /function EnhancedNetworkSettings|accountTitle:/);
});

test('startup onboarding modules stay focused and below the size budget', () => {
  for (const [name, source] of Object.entries({
    StartupOnboarding: onboardingSource,
    StartupSteps: stepsSource,
    AccountStep: accountStepSource,
    NetworkStep: networkStepSource,
    ReadyStep: readyStepSource,
    EnhancedSettings: enhancedSettingsSource,
    useStartupOnboardingController: controllerSource,
  })) {
    assert.ok(source.split(/\r?\n/).length <= 250, `${name} exceeds 250 lines`);
  }
});

test('startup onboarding ignores stale status responses after completion', () => {
  assert.match(gateSource, /const requestId = \+\+refreshRequestRef\.current;/);
  assert.match(gateSource, /if \(requestId !== refreshRequestRef\.current\) return;/);
  assert.match(gateSource, /refreshRequestRef\.current \+= 1;[\s\S]*?setStatus\(value\);/);
});

test('enhanced onboarding probes use the extracted gateway handler before persistence', () => {
  assert.match(onboardingHandlerSource, /createOnboardingSteamAccessGateway\(testedNetworkSettings,/);
  assert.match(onboardingHandlerSource, /onboardingGateway\.ensureReady\('onboarding-community', Math\.min\(12000, timeoutMs\),/);
  assert.match(onboardingHandlerSource, /onboardingGateway\.request\(\{/);
  assert.match(onboardingHandlerSource, /onboardingGateway\?\.clear\(\);/);
  assert.doesNotMatch(onboardingHandlerSource, /applyPatch\(\{ wallhubSteamAccessEnhance: true \}\)/);
});

test('Steam Community onboarding checks have a fifteen second overall deadline', () => {
  assert.match(onboardingHandlerSource, /ONBOARDING_NETWORK_CHECK_TIMEOUT_MS = 15000/);
  assert.match(onboardingHandlerSource, /Promise\.race\(\[operation, deadline\]\)/);
  assert.match(onboardingHandlerSource, /checkController\.abort\(\)/);
  assert.match(copySource, /连接检测失败或超过 15 秒/);
  assert.match(networkDeadlineSource, /STARTUP_NETWORK_CHECK_TIMEOUT_MS = 15000/);
  assert.match(networkDeadlineSource, /controller\.abort\(\)/);
  assert.match(networkDeadlineSource, /timedOutRef\.current = true/);
  assert.match(networkDeadlineSource, /STARTUP_NETWORK_CHECK_TIMEOUT_MS - \(Date\.now\(\) - progress\.startedAt\)/);
});
