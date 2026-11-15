// Typed frontend client for the bundled `oracle-runner` helper plugin:
// auto-installs/enables `oracle-runner` on first use and wraps `api.pluginHelper`.
import { api } from "./api";
import { loadPlugins, pluginOn, plugins, setPluginOn } from "./plugins.svelte";

const PLUGIN_ID = "oracle-runner";

export type JupyterKernelChoice = "auto" | "jupyter" | "jupyter314";

export interface JupyterDisplayItem {
  mime: string;
  data: string;
}

export interface JupyterCellError {
  ename: string;
  evalue: string;
  traceback: string;
}

export interface JupyterCellRunResult {
  index: number;
  execution_count: number | null;
  stdout: string;
  stderr: string;
  result_text: string | null;
  displays: JupyterDisplayItem[];
  error: JupyterCellError | null;
  ms: number;
}

export interface JupyterNotebookRunResponse {
  ok: boolean;
  kernel: string;
  pythonExe?: string;
  error?: string;
  results: JupyterCellRunResult[];
}

export interface WolframRunResponse {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
}

export interface CLintIssue {
  line?: number;
  code?: string;
  message: string;
  severity?: string;
}

export interface CLintResponse {
  clean: boolean;
  pass?: boolean;
  issues: CLintIssue[];
  checks?: Record<string, unknown> | null;
  raw: string;
}

export type OracleWikiPageType = "concept" | "question" | "comparison" | "entity" | "source" | "session";

export interface FileToWikiParams {
  problem: string;
  computation: string;
  dest: string;
  title: string;
  summary: string;
  acceptedWords: string;
  acceptedDate: string;
  dateConfirmed: boolean;
  type?: OracleWikiPageType;
  replace?: boolean;
  notePath?: string;
}

export interface FileToWikiResponse {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  destPath?: string;
}

let ensuring: Promise<void> | null = null;

/** Ensure `oracle-runner` is installed in the vault and switched on before calling its helper. */
export async function ensureOracleRunner(): Promise<void> {
  const ready = plugins.list.find((p) => p.id === PLUGIN_ID);
  if (ready && pluginOn(ready)) return;
  if (ensuring) return ensuring;

  ensuring = (async () => {
    if (!plugins.loaded) await loadPlugins();
    const existing = plugins.list.find((p) => p.id === PLUGIN_ID);
    if (existing) {
      if (!pluginOn(existing)) {
        await setPluginOn(PLUGIN_ID, true);
        await loadPlugins();
      }
      return;
    }

    const available = await api.availablePlugins();
    const offer = available.find((o) => o.id === PLUGIN_ID);
    if (!offer) {
      throw new Error("Bundled plugin 'oracle-runner' was not found in available plugins.");
    }
    await api.installPlugin(offer.url, PLUGIN_ID);
    await loadPlugins();
    const after = plugins.list.find((p) => p.id === PLUGIN_ID);
    if (after && !pluginOn(after)) {
      await setPluginOn(PLUGIN_ID, true);
      await loadPlugins();
    }
  })().finally(() => {
    ensuring = null;
  });

  return ensuring;
}

async function callRunner<T>(method: string, params: unknown, timeoutSecs = 120): Promise<T> {
  await ensureOracleRunner();
  return (await api.pluginHelper(PLUGIN_ID, method, params, timeoutSecs)) as T;
}

export function runJupyterNotebook(opts: {
  path?: string;
  cells: Array<{ index: number; source: string }>;
  kernel?: JupyterKernelChoice;
  timeout?: number;
}): Promise<JupyterNotebookRunResponse> {
  const timeout = opts.timeout ?? 180;
  return callRunner<JupyterNotebookRunResponse>("runJupyterNotebook", opts, timeout);
}

export function runJupyterCell(opts: {
  path?: string;
  index: number;
  source: string;
  kernel?: JupyterKernelChoice;
  timeout?: number;
}): Promise<JupyterNotebookRunResponse> {
  const timeout = opts.timeout ?? 120;
  return callRunner<JupyterNotebookRunResponse>(
    "runJupyterCell",
    { path: opts.path, cells: [{ index: opts.index, source: opts.source }], kernel: opts.kernel ?? "auto" },
    timeout,
  );
}

export function runWolfram(opts: {
  path?: string;
  code?: string;
  wlsPath?: string;
  timeout?: number;
}): Promise<WolframRunResponse> {
  const timeout = opts.timeout ?? 320;
  return callRunner<WolframRunResponse>("runWolfram", opts, timeout);
}

export function openInWljs(path: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  return callRunner<{ ok: boolean; path?: string; error?: string }>("openInWljs", { path }, 15);
}

export function runCLint(
  path: string,
  opts: { anyLayout?: boolean; strict?: boolean } = {},
): Promise<CLintResponse> {
  return callRunner<CLintResponse>("runCLint", { path, ...opts }, 60);
}

export function fileToWiki(params: FileToWikiParams): Promise<FileToWikiResponse> {
  return callRunner<FileToWikiResponse>("fileToWiki", params, 180);
}
