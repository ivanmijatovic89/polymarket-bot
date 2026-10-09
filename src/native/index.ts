/**
 * `src/native/`: the one TS module shared by the parity harness,
 * `--sequential` and the worker shim (01 §3.1, §6 M1 step 6): EngineJob
 * construction (21 §5, §9), ModelConfig resolution (21 §6.3), result
 * validation and mapping (21 §11, §19) and the protocol-v2 runner (20).
 * The generated contract lives in `./contract/` (21 §3).
 */
export {
  JOB_SCHEMA_VERSION,
  NATIVE_SLUG_RE,
  TELONEX_DELTA_FORMAT,
  absolutizeJobPaths,
  assertEngineJob,
  buildEngineJob,
  defaultBudget,
  resolveUnderDataRoot,
  verifyJobFiles,
  type BuildEngineJobOptions,
  type BuiltEngineJob,
  type DataRoots,
  type NativeInputRef,
  type NativeJobFields,
  type NativeMarketJobData,
  type R2Download,
} from './buildEngineJob.js'
export {
  NativeError,
  classOfExitCode,
  exitCodesOfClass,
  reasonText,
  retryActionFor,
  type RetryAction,
} from './errors.js'
export {
  FEED_ENGINE_CONSTANTS,
  feedDayFiles,
  resolvePriceToBeatAvailability,
  type FeedDayFile,
} from './feeds.js'
export {
  COMPAT_LATENCY_FALLBACK,
  applyMergePatch,
  ignoredNativeEnvKnobs,
  numberToDecimalString,
  resolveModelConfig,
  validateModelConfig,
  type ModelConfigFlags,
  type ResolveModelConfigArgs,
  type ResolvedModelConfig,
} from './modelConfig.js'
export { toNativeMarketJob, type NativeJobExtras } from './nativeJob.js'
export {
  mapEngineResult,
  shortCircuitOutput,
  toRunSingleMarketOutput,
  validateEngineResult,
  type CandidateOutcome,
  type MappingContext,
} from './result.js'
export {
  NATIVE_PROTOCOL_VERSION,
  checkedInContractSha256,
  describeNative,
  describeProblems,
  ensureNativeArtifact,
  nativeArtifactCachePath,
  nativeArtifactR2Key,
  nativeChildEnv,
  runArgs,
  runNativeJob,
  type NativeArtifactRef,
  type NativeDescribe,
  type NativeRunOutcome,
  type RunNativeJobOptions,
} from './runner.js'
